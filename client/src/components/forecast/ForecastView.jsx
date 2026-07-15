import React, { useMemo, useRef, useState } from 'react';
import { BrainCircuit, Play, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';
import { usePortfolioStore } from '../../store/portfolioStore.js';
import { useForecastStore } from '../../store/forecastStore.js';
import { getCandles, getNewsSentiment } from '../../api/client.js';
import {
  MACRO_SERIES,
  buildDataset,
  recursiveForecast,
  evaluateOneStep,
  arimaOneStepPreds,
  nextBusinessDay,
} from '../../lib/forecast/features.js';
import { fitArima, autoArima, forecastArima } from '../../lib/forecast/arima.js';
import { trainGBDT, predictGBDT } from '../../lib/forecast/gbdt.js';
import { bandFor, ensembleCloses, forecastReturnsPct } from '../../lib/forecast/ensemble.js';
import ForecastChart, { SERIES_COLORS } from './ForecastChart.jsx';
import TrainingLog from './TrainingLog.jsx';
import PastRuns from './PastRuns.jsx';
import LossSparkline from './LossSparkline.jsx';

const RANGES = ['1y', '2y', '5y'];
const HORIZONS = [7, 14, 30, 60, 90];
const TEST_DAYS = 60; // holdout used for the honest 1-step metrics

const field = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: theme.colors.textDim,
  fontWeight: 600,
  display: 'block',
  marginBottom: 4,
};

function businessDays(fromSec, n) {
  const out = [];
  let d = fromSec;
  for (let i = 0; i < n; i += 1) {
    d = nextBusinessDay(d);
    out.push(d);
  }
  return out;
}

/**
 * Forecast lab — client-side price prediction with three model families:
 * ARIMA (classical statistics), XGBoost-style gradient boosting, and an LSTM
 * neural network (TensorFlow.js, lazy-loaded, trained in YOUR browser).
 * Features: technical indicators + macro-economic series + calendar. All
 * models are scored on a 60-day holdout (1-step RMSE/MAE/direction) against a
 * naive baseline so you can see whether they beat "predict nothing".
 */
export default function ForecastView() {
  const holdings = usePortfolioStore((s) => s.holdings);
  const heldSymbols = useMemo(() => Array.from(new Set(holdings.map((h) => h.symbol))), [holdings]);

  // Settings persist (pt-forecast) so the lab reopens as you left it; the run
  // history records what was trained (models, epochs, scores) across sessions.
  const store = useForecastStore();
  const { range, horizon, models, feats, params } = store;
  const symbol = store.symbol || heldSymbols[0] || 'AAPL';
  const setSymbol = (v) => store.setSetting('symbol', v);
  const setRange = (v) => store.setSetting('range', v);
  const setHorizon = (v) => store.setSetting('horizon', v);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const runningRef = useRef(false);

  // Training status log — one entry per stage, live-updated while running and
  // KEPT after the run so you can see exactly what was trained and for how long.
  const [log, setLog] = useState([]);
  const stageIdRef = useRef(0);
  const stageStart = (label, detail = '') => {
    const id = ++stageIdRef.current;
    setLog((l) => [...l, { id, label, detail, state: 'running', startedAt: performance.now(), ms: null, progress: null }]);
    return id;
  };
  const stagePatch = (id, patch) => setLog((l) => l.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const stageDone = (id, detail) =>
    setLog((l) =>
      l.map((e) =>
        e.id === id
          ? { ...e, state: 'done', ms: performance.now() - e.startedAt, progress: null, ...(detail != null ? { detail } : {}) }
          : e
      )
    );
  const failRunningStages = () =>
    setLog((l) => l.map((e) => (e.state === 'running' ? { ...e, state: 'error', ms: performance.now() - e.startedAt, progress: null } : e)));

  const setP = (k) => (e) => store.patchSetting('params', { [k]: e.target.value });
  const toggleModel = (k) => store.patchSetting('models', { [k]: !models[k] });
  const toggleFeat = (k) => store.patchSetting('feats', { [k]: !feats[k] });

  async function run() {
    const sym = symbol.trim().toUpperCase();
    // runningRef guards re-entry even when the `busy` state hasn't rendered
    // yet (double-click / double-fired events would otherwise train twice).
    if (!sym || busy || runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setError('');
    setResult(null);
    setLog([]);
    const t0 = performance.now();
    const runModels = []; // summaries for the persisted run history
    const runReturns = {};
    try {
      // ── 1. Data ──────────────────────────────────────────────────────────
      const dataId = stageStart('Data', `${sym} · ${range} daily candles${feats.macro ? ' + macro series' : ''}…`);
      const target = await getCandles(sym, range, '1d');
      let macro = null;
      if (feats.macro) {
        const fetched = await Promise.all(
          MACRO_SERIES.map((m) => getCandles(m.symbol, range, '1d').catch(() => []))
        );
        macro = {};
        MACRO_SERIES.forEach((m, i) => {
          macro[m.key] = fetched[i] || [];
        });
      }
      stageDone(dataId, `${target.length} candles${macro ? ` · ${Object.values(macro).filter((c) => c.length > 9).length}/${MACRO_SERIES.length} macro series` : ''}`);

      // Optional: historical daily news sentiment (US equities/ETFs only).
      let newsDaily = null;
      if (feats.news) {
        const newsId = stageStart('News sentiment', 'fetching + scoring headlines (Finnhub)…');
        try {
          const ns = await getNewsSentiment(sym, 365);
          if (ns && ns.supported && ns.daily && ns.daily.length) {
            newsDaily = ns.daily;
            stageDone(newsId, `${ns.coverageDays} days covered · ${ns.articles} articles scored`);
          } else {
            stageDone(newsId, ns && !ns.supported ? 'not available for this symbol — feature skipped' : 'no news found — feature skipped');
          }
        } catch {
          stageDone(newsId, 'unavailable — feature skipped');
        }
      }

      const featId = stageStart('Features', 'building the feature matrix…');
      await new Promise((r) => setTimeout(r, 20));
      const ds = buildDataset(
        target,
        macro,
        {
          technical: feats.technical,
          macro: feats.macro,
          calendar: feats.calendar,
          news: feats.news && !!newsDaily,
        },
        newsDaily
      );
      stageDone(featId, `${ds.names.length} features × ${ds.rows.length} samples${newsDaily ? ' (incl. news)' : ''}`);

      const nRows = ds.rows.length;
      if (nRows <= TEST_DAYS + 120) throw new Error('Not enough history after warmup — pick a longer range.');
      const trainRows = ds.rows.slice(0, nRows - TEST_DAYS);
      const trainY = ds.targets.slice(0, nRows - TEST_DAYS);
      const testRows = ds.rows.slice(nRows - TEST_DAYS);
      const testY = ds.targets.slice(nRows - TEST_DAYS);
      const lastClose = ds.closes[ds.closes.length - 1];
      const fDates = businessDays(ds.dates[ds.dates.length - 1], horizon);

      const forecasts = [];
      const metrics = [{ model: 'Naive (no change)', color: theme.colors.textFaint, ...evaluateOneStep(testY.map(() => 0), testY) }];
      let importance = null;
      let lstmHistory = null;

      // ── 2. ARIMA (optionally auto-selected order) ──────────────────────────
      if (models.arima) {
        const logAll = ds.closes.map(Math.log);
        const returnsAll = [];
        for (let i = 1; i < logAll.length; i += 1) returnsAll.push(logAll[i] - logAll[i - 1]);

        let p;
        let q;
        let selectDetail = '';
        if (params.arimaAuto) {
          const maxP = Math.max(0, Math.min(8, Math.round(Number(params.arimaMaxP)) || 5));
          const maxQ = Math.max(0, Math.min(8, Math.round(Number(params.arimaMaxQ)) || 5));
          const autoId = stageStart('Auto-ARIMA', `grid p≤${maxP}, q≤${maxQ} — selecting by AIC…`);
          await new Promise((r) => setTimeout(r, 20));
          // Search on the TRAIN portion so the order isn't chosen using holdout data.
          const auto = autoArima(logAll.slice(0, logAll.length - TEST_DAYS), { maxP, maxQ, criterion: 'aic' });
          p = auto.best.p;
          q = auto.best.q;
          selectDetail = `auto-selected (${p},1,${q}) from ${auto.table.filter((r) => r.ok).length} candidates`;
          stageDone(autoId, selectDetail);
        } else {
          p = Math.max(0, Math.round(Number(params.arimaP)) || 0);
          q = Math.max(0, Math.round(Number(params.arimaQ)) || 0);
        }

        const arimaId = stageStart(`ARIMA(${p},1,${q})`, 'fitting (Hannan–Rissanen)…');
        await new Promise((r) => setTimeout(r, 20));
        const mTrain = fitArima(logAll.slice(0, logAll.length - TEST_DAYS), { p, q });
        const preds = arimaOneStepPreds(mTrain, returnsAll, returnsAll.length - TEST_DAYS);
        const m = evaluateOneStep(preds, returnsAll.slice(-TEST_DAYS));
        metrics.push({ model: `ARIMA(${p},1,${q})`, color: SERIES_COLORS.arima, ...m });
        const mFull = fitArima(logAll, { p, q });
        const fc = forecastArima(mFull, logAll, horizon);
        forecasts.push({
          key: 'arima',
          label: params.arimaAuto ? `ARIMA(${p},1,${q})*` : 'ARIMA',
          color: SERIES_COLORS.arima,
          dates: fDates,
          closes: fc.mean.map(Math.exp),
          band: { lower: fc.lower95.map(Math.exp), upper: fc.upper95.map(Math.exp) },
        });
        stageDone(arimaId, `fitted on ${returnsAll.length} returns · holdout direction ${m.dirAcc.toFixed(0)}%`);
        runModels.push({
          key: 'arima',
          short: `ARIMA(${p},1,${q})${params.arimaAuto ? '*' : ''}`,
          detail: params.arimaAuto ? `${selectDetail}; p=${p}, q=${q}` : `p=${p}, q=${q}`,
          dirAcc: m.dirAcc,
          rmse: m.rmse,
        });
      }

      // ── 3. Gradient boosting (XGBoost-style, regularized) ───────────────
      if (models.gbdt) {
        const maxTrees = Math.max(20, Math.round(Number(params.trees)) || 300);
        const earlyStop = Math.max(0, Math.round(Number(params.earlyStop)) || 0);
        const opts = {
          nTrees: maxTrees,
          maxDepth: Math.max(1, Math.round(Number(params.depth)) || 3),
          learningRate: Number(params.lr) > 0 ? Number(params.lr) : 0.05,
          regLambda: Number(params.regLambda) >= 0 ? Number(params.regLambda) : 1,
          gamma: Number(params.gamma) >= 0 ? Number(params.gamma) : 0,
          colsample: Number(params.colsample) > 0 && Number(params.colsample) <= 1 ? Number(params.colsample) : 1,
        };
        const regDetail = `depth ${opts.maxDepth}, lr ${opts.learningRate}, λ ${opts.regLambda}, γ ${opts.gamma}, colsample ${opts.colsample}`;

        // Holdout model — early-stops on a validation tail to AUTO-PICK the
        // tree count (bestIteration), then scores the 60-day test window.
        const g1 = stageStart('XGBoost — holdout model', `${maxTrees} trees max, ${regDetail}${earlyStop ? ` · early stop ${earlyStop}` : ''}`);
        const mdl = await trainGBDT(trainRows, trainY, {
          ...opts,
          valFraction: earlyStop ? 0.15 : 0,
          earlyStoppingRounds: earlyStop,
          onProgress: (i, n) => stagePatch(g1, { progress: { done: i, total: n, unit: 'trees' } }),
        });
        const preds = testRows.map((r) => predictGBDT(mdl, r));
        const m = evaluateOneStep(preds, testY);
        metrics.push({ model: 'XGBoost-style GBDT', color: SERIES_COLORS.gbdt, ...m });
        const chosenTrees = earlyStop ? mdl.bestIteration : maxTrees;
        const valNote = earlyStop && mdl.bestScore != null ? ` · min val RMSE ${(mdl.bestScore * 100).toFixed(2)}%` : '';
        stageDone(g1, `${earlyStop ? `best ${chosenTrees}/${maxTrees} trees (early-stopped)` : `${maxTrees} trees`}${valNote} · holdout direction ${m.dirAcc.toFixed(0)}%`);

        // Full model on ALL data, using the auto-tuned tree count so the
        // forecast isn't over/under-fit.
        const g2 = stageStart('XGBoost — full model + forecast', `retraining ${chosenTrees} trees on all data…`);
        const full = await trainGBDT(ds.rows, ds.targets, {
          ...opts,
          nTrees: chosenTrees,
          onProgress: (i, n) => stagePatch(g2, { progress: { done: i, total: n, unit: 'trees' } }),
        });
        importance = full.featureImportance
          .map((v, i) => ({ name: ds.names[i] || `f${i}`, value: v }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 10);
        const path = await recursiveForecast(ds, (hist) => predictGBDT(full, hist[hist.length - 1]), horizon);
        forecasts.push({
          key: 'gbdt',
          label: 'XGBoost',
          color: SERIES_COLORS.gbdt,
          dates: path.dates,
          closes: path.closes,
          band: bandFor(path.closes, m.rmse),
        });
        stageDone(g2, `${chosenTrees} trees · top feature: ${importance[0]?.name || '—'} · ${horizon}-day path done`);
        runModels.push({
          key: 'gbdt',
          short: `XGB ${chosenTrees}t`,
          detail: `${chosenTrees}${earlyStop ? `/${maxTrees} (early-stop)` : ''} trees, ${regDetail}`,
          dirAcc: m.dirAcc,
          rmse: m.rmse,
        });
      }

      // ── 4. LSTM (TensorFlow.js — trained in the browser) ────────────────
      if (models.lstm) {
        const tfId = stageStart('TensorFlow.js', 'loading (separate chunk)…');
        const tf = await import('@tensorflow/tfjs');
        await tf.ready();
        const { trainLSTM } = await import('../../lib/forecast/lstm.js');
        stageDone(tfId, `ready · backend: ${tf.getBackend()}`);
        const lopts = {
          window: Math.max(10, Math.round(Number(params.window)) || 30),
          units: Math.max(4, Math.round(Number(params.units)) || 32),
          epochs: Math.min(500, Math.max(5, Math.round(Number(params.epochs)) || 60)),
          layers: 1, // single tuned layer — fast + reliable in-browser (see lstm.js)
        };
        const lId = stageStart('LSTM — training', `${lopts.units} units · window ${lopts.window} · ${lopts.epochs} epochs`);
        let lastLoss = null;
        const l = await trainLSTM(tf, trainRows, trainY, {
          ...lopts,
          onEpoch: (e, total, loss) => {
            lastLoss = loss;
            stagePatch(lId, { progress: { done: e, total, unit: 'epochs', extra: `loss ${loss.toExponential(2)}` } });
          },
        });
        lstmHistory = l.history;
        const ranEpochs = l.history.epochs || lopts.epochs;
        const bestNote = l.history.bestEpoch
          ? ` · kept best epoch ${l.history.bestEpoch} (val ${l.history.bestValLoss != null ? l.history.bestValLoss.toFixed(3) : '—'})`
          : '';
        const stopped = l.history.stoppedEpoch ? ' (early-stopped)' : '';
        stageDone(lId, `${ranEpochs}/${lopts.epochs} epochs${stopped}${bestNote}`);

        const sId = stageStart('LSTM — scoring + forecast', `${TEST_DAYS}-day holdout, then ${horizon}-day rollout…`);
        const preds = [];
        for (let i = nRows - TEST_DAYS; i < nRows; i += 1) {
          preds.push(l.predictOne(ds.rows.slice(0, i + 1)));
          if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        const m = evaluateOneStep(preds, testY);
        metrics.push({ model: `LSTM (${lopts.units}u × ${lopts.epochs}ep)`, color: SERIES_COLORS.lstm, ...m });
        const path = await recursiveForecast(ds, (hist) => l.predictOne(hist), horizon);
        l.dispose();
        forecasts.push({
          key: 'lstm',
          label: 'LSTM',
          color: SERIES_COLORS.lstm,
          dates: path.dates,
          closes: path.closes,
          band: bandFor(path.closes, m.rmse),
        });
        stageDone(sId, `holdout direction ${m.dirAcc.toFixed(0)}% · path done`);
        runModels.push({ key: 'lstm', short: `LSTM ${l.history.epochs || lopts.epochs}ep`, detail: `${lopts.layers >= 2 ? '2-layer ' : ''}${lopts.units} units, window ${lopts.window}, ${l.history.epochs || lopts.epochs}/${lopts.epochs} epochs${l.history.stoppedEpoch ? ' (early stop)' : ''}, final loss ${lastLoss != null ? lastLoss.toExponential(2) : '—'}`, dirAcc: m.dirAcc, rmse: m.rmse });
      }

      if (forecasts.length === 0) throw new Error('Enable at least one model.');

      // ── 5. Ensemble (equal-weight mean of the enabled models) ───────────
      if (forecasts.length > 1) {
        const closes = ensembleCloses(forecasts, fDates.length);
        forecasts.push({ key: 'ensemble', label: 'Ensemble', color: SERIES_COLORS.ensemble, dates: fDates, closes });
      }

      const histTail = 120;
      setResult({
        symbol: sym,
        currency: (target.find((c) => c) || {}).currency || (sym.endsWith('.BK') ? 'THB' : 'USD'),
        lastClose,
        historyDates: ds.dates.slice(-histTail),
        historyCloses: ds.closes.slice(-histTail),
        forecasts,
        metrics,
        importance,
        lstmHistory,
        nFeatures: ds.names.length,
        nSamples: nRows,
        horizon,
      });

      // Persist this run into the history (what was trained, how, how it scored).
      Object.assign(runReturns, forecastReturnsPct(forecasts, lastClose));
      store.addRun({
        symbol: sym,
        range,
        horizon,
        durationMs: performance.now() - t0,
        nFeatures: ds.names.length,
        nSamples: nRows,
        models: runModels,
        returns: runReturns,
      });
    } catch (e) {
      setError((e && e.message) || 'Forecast failed');
      failRunningStages();
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }

  const chip = (active) => ({
    fontWeight: 700,
    color: active ? '#fff' : theme.colors.textDim,
    background: active ? theme.colors.accent : undefined,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(5) }}>
      {/* ── Controls ── */}
      <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 13, color: theme.colors.text }}>
          <BrainCircuit size={16} style={{ color: theme.colors.accent }} />
          Forecast lab — LSTM · ARIMA · XGBoost-style boosting
          <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 400, color: theme.colors.textFaint }}>
            trains in your browser · nothing leaves your machine
          </span>
        </div>

        <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ flex: '0 0 160px' }}>
            <span style={field}>Symbol</span>
            <input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="AAPL, PTT.BK, BTC-USD…" onKeyDown={(e) => { if (e.key === 'Enter') run(); }} />
          </label>
          <div>
            <span style={field}>History</span>
            <div className="segmented" role="group">
              {RANGES.map((r) => (
                <button key={r} className={`segmented-item${r === range ? ' active' : ''}`} onClick={() => setRange(r)} style={r === range ? { color: theme.colors.text } : undefined}>{r}</button>
              ))}
            </div>
          </div>
          <div>
            <span style={field}>Horizon (days)</span>
            <div className="segmented" role="group">
              {HORIZONS.map((h) => (
                <button key={h} className={`segmented-item${h === horizon ? ' active' : ''}`} onClick={() => setHorizon(h)} style={h === horizon ? { color: theme.colors.text } : undefined}>{h}</button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={run}
            disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: busy ? 0.6 : 1, marginLeft: 'auto' }}
          >
            {busy ? <Loader2 size={15} style={{ animation: 'pulse 1s linear infinite' }} /> : <Play size={15} />}
            {busy ? 'Working…' : 'Run forecast'}
          </button>
        </div>

        {heldSymbols.length > 0 && (
          <div style={{ display: 'flex', gap: theme.space(1), flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: theme.colors.textFaint }}>Your holdings:</span>
            {heldSymbols.slice(0, 10).map((s) => (
              <button key={s} type="button" className="chip" onClick={() => setSymbol(s)} style={chip(s === symbol.trim().toUpperCase())}>{s}</button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: theme.space(4), flexWrap: 'wrap' }}>
          <div>
            <span style={field}>Models</span>
            <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
              {[['arima', 'ARIMA', SERIES_COLORS.arima], ['gbdt', 'XGBoost-style', SERIES_COLORS.gbdt], ['lstm', 'LSTM (deep learning)', SERIES_COLORS.lstm]].map(([k, label, color]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: models[k] ? theme.colors.text : theme.colors.textDim, cursor: 'pointer' }}>
                  <input type="checkbox" checked={models[k]} onChange={() => toggleModel(k)} style={{ accentColor: color }} />
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' }} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span style={field}>Feature groups</span>
            <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
              {[['technical', 'Technical indicators (13)'], ['macro', `Macro-economic (${MACRO_SERIES.length})`], ['news', 'News sentiment (3)'], ['calendar', 'Calendar (2)']].map(([k, label]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: feats[k] ? theme.colors.text : theme.colors.textDim, cursor: 'pointer' }} title={k === 'news' ? 'Historical daily headline sentiment (Finnhub) — US stocks/ETFs only, ~1 year of coverage' : undefined}>
                  <input type="checkbox" checked={!!feats[k]} onChange={() => toggleFeat(k)} style={{ accentColor: theme.colors.accent }} />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <button type="button" className="btn-ghost" onClick={() => setShowAdvanced((s) => !s)} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: theme.colors.accent }}>
          {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Hyperparameters
        </button>
        {showAdvanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: theme.colors.text, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!params.arimaAuto} onChange={(e) => store.patchSetting('params', { arimaAuto: e.target.checked })} style={{ accentColor: SERIES_COLORS.arima }} />
              Auto-ARIMA — grid-search the order and keep the best by AIC
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: theme.space(2) }}>
              {params.arimaAuto ? (
                <>
                  <label><span style={field}>Auto max p</span><input className="input" type="number" value={params.arimaMaxP} onChange={setP('arimaMaxP')} /></label>
                  <label><span style={field}>Auto max q</span><input className="input" type="number" value={params.arimaMaxQ} onChange={setP('arimaMaxQ')} /></label>
                </>
              ) : (
                <>
                  <label><span style={field}>ARIMA p (AR lags)</span><input className="input" type="number" value={params.arimaP} onChange={setP('arimaP')} /></label>
                  <label><span style={field}>ARIMA q (MA lags)</span><input className="input" type="number" value={params.arimaQ} onChange={setP('arimaQ')} /></label>
                </>
              )}
              <label><span style={field}>Boosting trees (max)</span><input className="input" type="number" value={params.trees} onChange={setP('trees')} /></label>
              <label><span style={field}>Tree depth</span><input className="input" type="number" value={params.depth} onChange={setP('depth')} /></label>
              <label><span style={field}>Learning rate</span><input className="input" type="number" step="0.01" value={params.lr} onChange={setP('lr')} /></label>
              <label title="reg_lambda — L2 penalty on leaf weights (shrinks them toward 0)"><span style={field}>XGB L2 (λ)</span><input className="input" type="number" step="0.5" value={params.regLambda} onChange={setP('regLambda')} /></label>
              <label title="gamma — minimum gain to make a split (prunes weak splits)"><span style={field}>XGB min-split (γ)</span><input className="input" type="number" step="0.01" value={params.gamma} onChange={setP('gamma')} /></label>
              <label title="colsample_bytree — fraction of features each tree may use"><span style={field}>XGB feature frac</span><input className="input" type="number" step="0.1" value={params.colsample} onChange={setP('colsample')} /></label>
              <label title="Stop adding trees when validation RMSE hasn't improved for this many rounds (0 = off). The chosen count also trains the forecast model."><span style={field}>XGB early stop</span><input className="input" type="number" value={params.earlyStop} onChange={setP('earlyStop')} /></label>
              <label><span style={field}>LSTM window</span><input className="input" type="number" value={params.window} onChange={setP('window')} /></label>
              <label><span style={field}>LSTM units</span><input className="input" type="number" value={params.units} onChange={setP('units')} /></label>
              <label><span style={field}>LSTM epochs</span><input className="input" type="number" value={params.epochs} onChange={setP('epochs')} /></label>
            </div>
          </div>
        )}

        <TrainingLog entries={log} busy={busy} />
        {error && <div style={{ fontSize: 13, color: theme.colors.down }}>{error}</div>}
      </div>

      {/* ── Results ── */}
      {result && (
        <>
          <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: theme.space(2), flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 800, fontSize: 15, fontFamily: theme.mono, color: theme.colors.text }}>{result.symbol}</span>
              <span style={{ fontSize: 12.5, color: theme.colors.textDim }}>
                {result.horizon}-day forecast · last close <b style={{ fontFamily: theme.mono, color: theme.colors.text }}>{fmtMoney(result.lastClose, result.currency)}</b>
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: theme.colors.textFaint }}>
                {result.nSamples} training days · {result.nFeatures} features
              </span>
            </div>
            <ForecastChart
              historyDates={result.historyDates}
              historyCloses={result.historyCloses}
              forecasts={result.forecasts}
              currency={result.currency}
              height={320}
            />
            <div style={{ fontSize: 10.5, color: theme.colors.textFaint }}>
              Dashed = model forecast · shaded = 95% band from each model's holdout error (uncertainty grows with √days)
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: theme.space(5) }}>
            {/* Holdout metrics */}
            <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: theme.colors.text }}>Holdout accuracy — last {TEST_DAYS} days (1-step)</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: theme.colors.bgElev }}>
                      {['Model', 'RMSE', 'MAE', 'Direction'].map((h, i) => (
                        <th key={h} style={{ padding: '4px 8px', fontSize: 11, color: theme.colors.textDim, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.metrics.map((m) => (
                      <tr key={m.model}>
                        <td style={{ padding: '4px 8px', borderTop: `1px solid ${theme.colors.border}`, fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 4, background: m.color, display: 'inline-block', marginRight: 6 }} />
                          <span style={{ color: theme.colors.text }}>{m.model}</span>
                        </td>
                        <td style={{ padding: '4px 8px', borderTop: `1px solid ${theme.colors.border}`, fontSize: 12, textAlign: 'right', fontFamily: theme.mono, color: theme.colors.text }}>{(m.rmse * 100).toFixed(2)}%</td>
                        <td style={{ padding: '4px 8px', borderTop: `1px solid ${theme.colors.border}`, fontSize: 12, textAlign: 'right', fontFamily: theme.mono, color: theme.colors.text }}>{(m.mae * 100).toFixed(2)}%</td>
                        <td style={{ padding: '4px 8px', borderTop: `1px solid ${theme.colors.border}`, fontSize: 12, textAlign: 'right', fontFamily: theme.mono, color: m.dirAcc >= 55 ? theme.colors.up : theme.colors.text }}>{m.dirAcc.toFixed(0)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: 10.5, color: theme.colors.textFaint, lineHeight: 1.5 }}>
                RMSE/MAE are on daily log returns. Direction = % of days the sign was right — ~50% is a coin
                flip; beating the naive row consistently is hard, which is the honest headline of daily-horizon
                prediction.
              </div>
            </div>

            {/* Feature importance */}
            {result.importance && (
              <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: theme.colors.text }}>What the boosting model looked at</div>
                {result.importance.map((f) => (
                  <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
                    <span style={{ flex: '0 0 120px', fontSize: 11.5, color: theme.colors.textDim, fontFamily: theme.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: theme.colors.bgElev, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, f.value * 100 / (result.importance[0].value || 1) * 1)}%`, height: '100%', background: SERIES_COLORS.gbdt, opacity: 0.85 }} />
                    </div>
                    <span style={{ flex: '0 0 44px', textAlign: 'right', fontSize: 11, fontFamily: theme.mono, color: theme.colors.text }}>{(f.value * 100).toFixed(1)}%</span>
                  </div>
                ))}
                <div style={{ fontSize: 10.5, color: theme.colors.textFaint }}>Share of total split gain (top 10 of {result.nFeatures})</div>
              </div>
            )}

            {/* LSTM training curve */}
            {result.lstmHistory && result.lstmHistory.loss.length > 1 && (
              <div className="panel" style={{ padding: theme.space(3), display: 'flex', flexDirection: 'column', gap: theme.space(2) }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: theme.colors.text }}>LSTM training curve</div>
                <LossSparkline loss={result.lstmHistory.loss} valLoss={result.lstmHistory.valLoss} />
                <div style={{ fontSize: 10.5, color: theme.colors.textFaint }}>
                  MSE per epoch — <span style={{ color: SERIES_COLORS.lstm }}>▬</span> train
                  {result.lstmHistory.valLoss.some((v) => v != null) ? <> · <span style={{ color: theme.colors.textDim }}>▬</span> validation</> : null}
                </div>
              </div>
            )}
          </div>

          <div className="panel" style={{ padding: theme.space(3), borderLeft: `3px solid ${theme.colors.warn}`, fontSize: 12, color: theme.colors.textDim, lineHeight: 1.6 }}>
            ⚠️ <b style={{ color: theme.colors.text }}>Read before believing the lines:</b> daily stock returns are
            mostly noise — even good models rarely beat ~55% directional accuracy, and multi-day paths are
            recursive guesses whose uncertainty (shaded bands) grows fast. These models know nothing about
            tomorrow's news. Treat this page as an <b>experiment lab</b> for understanding models and features —
            educational only, not financial advice, never a reason on its own to trade.
            <div style={{ marginTop: theme.space(2), color: theme.colors.textFaint }}>
              <b>On loss &amp; early stopping:</b> the loss can't fall to zero — it bottoms out near the symbol's own
              daily volatility (a ~2%/day stock floors around 2, a ~5%/day one around 5), because tomorrow's return
              is mostly unpredictable. Early stopping watches <b>validation</b> loss (unseen data), not training
              loss: it keeps the point that generalizes best, so a low <i>training</i> loss past that would just be
              memorizing noise. To fit harder anyway, raise epochs/trees and the patience (XGB early-stop), lower
              the learning rate, or set early-stop to 0 to train the full count.
            </div>
          </div>
        </>
      )}

      <PastRuns />
    </div>
  );
}
