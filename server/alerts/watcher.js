// Closed-app alert watcher. On an interval it gathers every device's active
// alerts, fetches quotes for their symbols, and — for any whose condition is met
// and hasn't already been delivered — posts a notification to that device's
// ntfy.sh topic. Best-effort by nature: on Render's free tier the process only
// runs while the dyno is awake, which the UI is honest about.
import { evaluateAlert, describeAlert } from 'shared/alerts.js';
import * as store from './store.js';
import { log } from '../util/log.js';

/**
 * Publish one notification to a public ntfy.sh topic (no account needed). Uses
 * ntfy's JSON publish form so the title can carry UTF-8 (describeAlert uses ≥/≤/±,
 * which are illegal in an HTTP header's ByteString).
 */
async function notifyNtfy(topic, alert, quote) {
  const price = quote && Number(quote.price) > 0 ? Number(quote.price) : null;
  const message = price != null ? `${alert.symbol} is now ${price}` : `${alert.symbol} — condition met`;
  try {
    const res = await fetch('https://ntfy.sh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        title: `PT alert: ${describeAlert(alert)}`,
        message,
        tags: ['chart_with_upwards_trend'],
      }),
    });
    return res.ok;
  } catch (e) {
    log.warn('alerts: ntfy publish failed', e?.message);
    return false;
  }
}

/**
 * Start the watcher. Returns a stop() function.
 * @param {{ getQuotes:(symbols:string[])=>Promise<Array>, intervalMs?:number }} deps
 */
export function startAlertWatcher({ getQuotes, intervalMs = 15000 } = {}) {
  if (typeof getQuotes !== 'function') throw new Error('startAlertWatcher needs getQuotes');
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const all = await store.loadAll();
      const pending = []; // { deviceId, topic, alert }
      const symbols = new Set();
      for (const [deviceId, rec] of Object.entries(all)) {
        const fired = rec.fired || {};
        for (const a of rec.alerts || []) {
          if (a && a.enabled !== false && !a.triggeredAt && !fired[a.id]) {
            pending.push({ deviceId, topic: rec.topic, alert: a });
            symbols.add(a.symbol);
          }
        }
      }
      if (pending.length === 0) return;

      const quotes = await getQuotes(Array.from(symbols));
      const bySymbol = {};
      for (const q of Array.isArray(quotes) ? quotes : []) if (q && q.symbol) bySymbol[q.symbol] = q;

      let changed = false;
      for (const { deviceId, topic, alert } of pending) {
        const q = bySymbol[alert.symbol];
        if (!evaluateAlert(alert, q)) continue;
        // Deliver first; only mark fired if it actually went out (or there's no
        // topic to deliver to), so a transient ntfy failure retries next tick.
        const delivered = topic ? await notifyNtfy(topic, alert, q) : true;
        if (!delivered) {
          log.warn(`alerts: delivery failed, will retry: ${describeAlert(alert)}`);
          continue;
        }
        all[deviceId].fired = all[deviceId].fired || {};
        all[deviceId].fired[alert.id] = Date.now();
        changed = true;
        log.info(`alerts: fired ${describeAlert(alert)} -> ${topic ? `ntfy/${topic}` : '(no topic)'}`);
      }
      if (changed) await store.saveAll(all);
    } catch (e) {
      log.warn('alerts: watcher tick failed', e?.message);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

export default { startAlertWatcher };
