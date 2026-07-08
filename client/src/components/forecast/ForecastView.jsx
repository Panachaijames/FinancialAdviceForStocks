import React, { useMemo, useState } from 'react';
import { BrainCircuit, Play, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { fmtMoney } from '../../lib/format.js';
import { usePortfolioStore } from '../../store/portfolioStore.js';
import { getCandles } from '../../api/client.js';
import {
  MACRO_SERIES,
  buildDataset,
  recursiveForecast,
  evaluateOneStep,
  arimaOneStepPreds,
  nextBusinessDay,
} from '../../lib/forecast/features.js';
import { fitArima, forecastArima } from '../../lib/forecast/arima.js';
import { trainGBDT, predictGBDT } from '../../lib/forecast/gbdt.js';
import ForecastChart, { SERIES_COLORS } from './ForecastChart.jsx';

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

/** Geometric uncertainty band: path × exp(±1.96·σ·√h), σ = the model's 1-step RMSE. */
function bandFor(path, sigma) {
  return {
    lower: path.map((c, i) => c * Math.exp(-1.96 * sigma * Math.sqrt(i + 1))),
    upper: path.map((c, i) => c * Math.exp(1.96 * sigma * Math.sqrt(i + 1))),
  };
}

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

  const [symbol, setSymbol] = useState(heldSymbols[0] || 'AAPL');
  const [range, setRange] = useState('2y');
  const [horizon, setHorizon] = useState(30);
  const [models, setModels] = useState({ arima: true, gbdt: true, lstm: true });
  const [feats, setFeats] = useState({ technical: true, macro: true, calendar: true });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [params, setParams] = useState({
    arimaP: '5', arimaQ: '1',
    trees: '300', depth: '3', lr: '0.05',
    window: '30', units: '32', epochs: '60',
  });

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(null); // { label, done, total, extra }
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const setP = (k) => (e) => setParams((p) => ({ ...p, [k]: e.target.value }));
  const toggle = (setter) => (k) => setter((m) => ({ ...m, [k]: !m[k] }));

  async function run() {
    const sym = symbol.trim().toUpperCase();
    if (!sym || busy) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      // ── 1. Data ──────────────────────────────────────────────────────────
      setStatus(`Fetching ${sym} candles (${range})…`);
      const target = await getCandles(sym, range, '1d');
      let macro = null;
      if (feats.macro) {
        setStatus('Fetching macro series (S&P, VIX, rates, USD/THB, gold, oil…)…');
        const fetched = await Promise.all(
          MACRO_SERIES.map((m) => getCandles(m.symbol, range, '1d').catch(() => []))
        );
        macro = {};
        MACRO_SERIES.forEach((m, i) => {
          macro[m.key] = fetched[i] || [];
        });
      }
      setStatus('Building feature matrix…');
      await new Promise((r) => setTimeout(r, 20));
      const ds = buildDataset(target, macro, {
        technical: feats.technical,
        macro: feats.macro,
        calendar: feats.calendar,
      });

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

      // ── 2. ARIMA ─────────────────────────────────────────────────────────
      if (models.arima) {
        setStatus('Fitting ARIMA…');
        await new Promise((r) => setTimeout(r, 20));
        const p = Math.max(0, Math.round(Number(params.arimaP)) || 0);
        const q = Math.max(0, Math.round(Number(params.arimaQ)) || 0);
        const logAll = ds.closes.map(Math.log);
        const returnsAll = [];
        for (let i = 1; i < logAll.length; i += 1) returnsAll.push(logAll[i] - logAll[i - 1]);
        const mTrain = fitArima(logAll.slice(0, logAll.length - TEST_DAYS), { p, q });
        const preds = arimaOneStepPreds(mTrain, returnsAll, returnsAll.length - TEST_DAYS);
        metrics.push({ model: `ARIMA(${p},1,${q})`, color: SERIES_COLORS.arima, ...evaluateOneStep(preds, returnsAll.slice(-TEST_DAYS)) });
        const mFull = fitArima(logAll, { p, q });
        const fc = forecastArima(mFull, logAll, horizon);
        forecasts.push({
          key: 'arima',
          label: 'ARIMA',
          color: SERIES_COLORS.arima,
          dates: fDates,
          closes: fc.mean.map(Math.exp),
          band: { lower: fc.lower95.map(Math.exp), upper: fc.upper95.map(Math.exp) },
        });
      }

      // ── 3. Gradient boosting (XGBoost-style) ────────────────────────────
      if (models.gbdt) {
        const opts = {
          nTrees: Math.max(20, Math.round(Number(params.trees)) || 300),
          maxDepth: Math.max(1, Math.round(Number(params.depth)) || 3),
          learningRate: Number(params.lr) > 0 ? Number(params.lr) : 0.05,
        };
        setStatus('Training gradient boosting (holdout model)…');
        const mdl = await trainGBDT(trainRows, trainY, {
          ...opts,
          onProgress: (i, n) => setProgress({ label: 'XGBoost-style trees', done: i, total: n }),
        });
        const preds = testRows.map((r) => predictGBDT(mdl, r));
        const m = evaluateOneStep(preds, testY);
        metrics.push({ model: 'XGBoost-style GBDT', color: SERIES_COLORS.gbdt, ...m });
        setStatus('Training gradient boosting (full model) + forecasting…');
        const full = await trainGBDT(ds.rows, ds.targets, {
          ...opts,
          onProgress: (i, n) => setProgress({ label: 'XGBoost-style trees (full)', done: i, total: n }),
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
        setProgress(null);
      }

      // ── 4. LSTM (TensorFlow.js — trained in the browser) ────────────────
      if (models.lstm) {
        setStatus('Loading TensorFlow.js…');
        const tf = await import('@tensorflow/tfjs');
        await tf.ready();
        const { trainLSTM } = await import('../../lib/forecast/lstm.js');
        const lopts = {
          window: Math.max(10, Math.round(Number(params.window)) || 30),
          units: Math.max(4, Math.round(Number(params.units)) || 32),
          epochs: Math.min(500, Math.max(5, Math.round(Number(params.epochs)) || 60)),
        };
        setStatus(`Training LSTM (${lopts.units} units, window ${lopts.window}) — backend: ${tf.getBackend()}…`);
        const l = await trainLSTM(tf, trainRows, trainY, {
          ...lopts,
          onEpoch: (e, total, loss) => setProgress({ label: 'LSTM epochs', done: e, total, extra: `loss ${loss.toExponential(2)}` }),
        });
        lstmHistory = l.history;
        setStatus('Scoring LSTM on the holdout…');
        const preds = [];
        for (let i = nRows - TEST_DAYS; i < nRows; i += 1) {
          preds.push(l.predictOne(ds.rows.slice(0, i + 1)));
          if (i % 15 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        const m = evaluateOneStep(preds, testY);
        metrics.push({ model: `LSTM (${lopts.units}u × ${lopts.epochs}ep)`, color: SERIES_COLORS.lstm, ...m });
        setStatus('LSTM forecasting…');
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
        setProgress(null);
      }

      if (forecasts.length === 0) throw new Error('Enable at least one model.');

      // ── 5. Ensemble (equal-weight mean of the enabled models) ───────────
      if (forecasts.length > 1) {
        const closes = fDates.map((_, i) => {
          const vals = forecasts.map((f) => f.closes[i]).filter(Number.isFinite);
          return vals.reduce((s, v) => s + v, 0) / vals.length;
        });
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
      setStatus('');
    } catch (e) {
      setError((e && e.message) || 'Forecast failed');
      setStatus('');
      setProgress(null);
    } finally {
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
                  <input type="checkbox" checked={models[k]} onChange={() => toggle(setModels)(k)} style={{ accentColor: color }} />
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: color, display: 'inline-block' }} />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <span style={field}>Feature groups</span>
            <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
              {[['technical', 'Technical indicators (13)'], ['macro', `Macro-economic (${MACRO_SERIES.length})`], ['calendar', 'Calendar (2)']].map(([k, label]) => (
                <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: feats[k] ? theme.colors.text : theme.colors.textDim, cursor: 'pointer' }}>
                  <input type="checkbox" checked={feats[k]} onChange={() => toggle(setFeats)(k)} style={{ accentColor: theme.colors.accent }} />
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: theme.space(2) }}>
            <label><span style={field}>ARIMA p (AR lags)</span><input className="input" type="number" value={params.arimaP} onChange={setP('arimaP')} /></label>
            <label><span style={field}>ARIMA q (MA lags)</span><input className="input" type="number" value={params.arimaQ} onChange={setP('arimaQ')} /></label>
            <label><span style={field}>Boosting trees</span><input className="input" type="number" value={params.trees} onChange={setP('trees')} /></label>
            <label><span style={field}>Tree depth</span><input className="input" type="number" value={params.depth} onChange={setP('depth')} /></label>
            <label><span style={field}>Learning rate</span><input className="input" type="number" step="0.01" value={params.lr} onChange={setP('lr')} /></label>
            <label><span style={field}>LSTM window</span><input className="input" type="number" value={params.window} onChange={setP('window')} /></label>
            <label><span style={field}>LSTM units</span><input className="input" type="number" value={params.units} onChange={setP('units')} /></label>
            <label><span style={field}>LSTM epochs</span><input className="input" type="number" value={params.epochs} onChange={setP('epochs')} /></label>
          </div>
        )}

        {(status || progress) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {status && <div style={{ fontSize: 12.5, color: theme.colors.textDim }}>{status}</div>}
            {progress && (
              <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2) }}>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: theme.colors.bgElev, overflow: 'hidden' }}>
                  <div style={{ width: `${(progress.done / progress.total) * 100}%`, height: '100%', background: theme.colors.accent, transition: 'width 0.15s' }} />
                </div>
                <span style={{ fontSize: 11, fontFamily: theme.mono, color: theme.colors.textDim, whiteSpace: 'nowrap' }}>
                  {progress.label} {progress.done}/{progress.total}{progress.extra ? ` · ${progress.extra}` : ''}
                </span>
              </div>
            )}
          </div>
        )}
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
          </div>
        </>
      )}
    </div>
  );
}

/** Tiny SVG loss-curve sparkline (log-ish scaling via min/max normalize). */
function LossSparkline({ loss, valLoss }) {
  const W = 360;
  const H = 80;
  const all = [...loss, ...valLoss.filter((v) => v != null)];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const path = (arr) =>
    arr
      .map((v, i) => (v == null ? null : `${i === 0 || arr[i - 1] == null ? 'M' : 'L'} ${(i / (arr.length - 1)) * (W - 4) + 2} ${H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8)}`))
      .filter(Boolean)
      .join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 80, display: 'block' }} role="img" aria-label="LSTM loss curve">
      <path d={path(loss)} fill="none" stroke={SERIES_COLORS.lstm} strokeWidth="2" />
      {valLoss.some((v) => v != null) && <path d={path(valLoss)} fill="none" stroke={theme.colors.textDim} strokeWidth="1.5" strokeDasharray="4,3" />}
    </svg>
  );
}
