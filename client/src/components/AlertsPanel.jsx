import React, { useEffect, useMemo } from 'react';
import { Bell, BellRing, RotateCcw, Trash2 } from 'lucide-react';
import { theme } from '../lib/theme.js';
import { useAlertsStore } from '../store/alertsStore.js';
import useQuotes from '../hooks/useQuotes.js';
import { evaluateAlert, describeAlert } from '../lib/alerts.js';
import { putAlerts } from '../api/client.js';
import { useT } from '../lib/i18n.js';

/**
 * Price-alert watcher + list. Watches the live quotes the app already polls;
 * when an alert's condition is met it fires ONCE — highlighted here and, when
 * the user granted permission, as a browser/desktop notification. Fired alerts
 * can be re-armed or deleted. Renders nothing until an alert exists (add one
 * from the bell on an asset card).
 */
export default function AlertsPanel() {
  const t = useT();
  const alerts = useAlertsStore((s) => s.alerts);
  const markTriggered = useAlertsStore((s) => s.markTriggered);
  const rearmAlert = useAlertsStore((s) => s.rearmAlert);
  const removeAlert = useAlertsStore((s) => s.removeAlert);
  const deviceId = useAlertsStore((s) => s.deviceId);
  const pushTopic = useAlertsStore((s) => s.pushTopic);
  const pushEnabled = useAlertsStore((s) => s.pushEnabled);
  const setPushEnabled = useAlertsStore((s) => s.setPushEnabled);

  const symbols = useMemo(() => Array.from(new Set(alerts.map((a) => a.symbol))), [alerts]);
  const { quotes } = useQuotes(symbols);

  // Mirror alerts to the server watcher so they fire when the app is closed.
  // When push is off we send an empty list to stop server-side watching.
  useEffect(() => {
    if (!deviceId) return;
    putAlerts({
      deviceId,
      topic: pushEnabled ? pushTopic : null,
      alerts: pushEnabled ? alerts : [],
    }).catch(() => {
      /* best-effort; the in-app watcher still runs */
    });
  }, [deviceId, pushTopic, pushEnabled, alerts]);

  // The watcher — evaluate every active alert whenever fresh quotes arrive.
  useEffect(() => {
    for (const a of alerts) {
      const q = quotes[a.symbol];
      if (!evaluateAlert(a, q)) continue;
      markTriggered(a.id, q && q.price);
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          // eslint-disable-next-line no-new
          new Notification(`📈 ${describeAlert(a)}`, {
            body: q && Number(q.price) > 0 ? t('alerts.notifBody', { symbol: a.symbol, price: q.price }) : a.symbol,
          });
        }
      } catch {
        /* notification blocked — the in-app banner below still shows it */
      }
    }
  }, [alerts, quotes, markTriggered]);

  if (alerts.length === 0) return null;

  const fired = alerts.filter((a) => a.triggeredAt);
  const active = alerts.filter((a) => !a.triggeredAt);

  const row = { display: 'flex', alignItems: 'center', gap: theme.space(2), fontSize: 12.5 };
  const iconBtn = { padding: 4, lineHeight: 0 };

  return (
    <div
      className="panel"
      style={{
        padding: theme.space(3),
        display: 'flex',
        flexDirection: 'column',
        gap: theme.space(2),
        ...(fired.length > 0 ? { borderLeft: `3px solid ${theme.colors.warn}` } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(1), fontWeight: 700, fontSize: 13, color: theme.colors.text }}>
        {fired.length > 0 ? (
          <BellRing size={15} style={{ color: theme.colors.warn }} />
        ) : (
          <Bell size={15} style={{ color: theme.colors.accent }} />
        )}
        {t('alerts.title')}
        {fired.length > 0 && (
          <span className="badge" style={{ background: theme.colors.warn + '22', color: theme.colors.warn, fontWeight: 700 }}>
            {t('alerts.firedCount', { count: fired.length })}
          </span>
        )}
      </div>

      {fired.map((a) => (
        <div key={a.id} style={{ ...row, background: theme.colors.bgElev, borderRadius: theme.radius.sm, padding: theme.space(2) }}>
          <span style={{ fontWeight: 700, color: theme.colors.warn }}>🔔 {describeAlert(a)}</span>
          <span style={{ color: theme.colors.textDim, fontSize: 11.5 }}>
            {t('alerts.hitAt', { time: String(a.triggeredAt).slice(0, 16).replace('T', ' ') })}
            {a.triggeredPrice != null ? ` @ ${a.triggeredPrice}` : ''}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            <button type="button" className="btn-ghost" style={iconBtn} title={t('alerts.rearm')} onClick={() => rearmAlert(a.id)}>
              <RotateCcw size={14} />
            </button>
            <button type="button" className="btn-ghost" style={{ ...iconBtn, color: theme.colors.down }} title={t('alerts.delete')} onClick={() => removeAlert(a.id)}>
              <Trash2 size={14} />
            </button>
          </span>
        </div>
      ))}

      {active.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(1) }}>
          {active.map((a) => (
            <span key={a.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
              {describeAlert(a)}
              <button type="button" className="btn-ghost" style={{ padding: 0, lineHeight: 0, color: theme.colors.textFaint }} title={t('alerts.delete')} onClick={() => removeAlert(a.id)}>
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Closed-app delivery via a server-side watcher + ntfy.sh */}
      <div
        style={{
          borderTop: `1px solid ${theme.colors.border}`,
          paddingTop: theme.space(2),
          display: 'flex',
          flexDirection: 'column',
          gap: theme.space(1),
        }}
      >
        <label style={{ display: 'flex', alignItems: 'center', gap: theme.space(2), cursor: 'pointer', fontSize: 12.5, color: theme.colors.text }}>
          <input type="checkbox" checked={pushEnabled} onChange={(e) => setPushEnabled(e.target.checked)} />
          <span style={{ fontWeight: 600 }}>{t('alerts.notifyClosed')}</span>
        </label>
        {pushEnabled && (
          <div style={{ fontSize: 11.5, color: theme.colors.textDim, lineHeight: 1.6 }}>
            {t('alerts.subscribePrefix')}{' '}
            <a href="https://ntfy.sh/" target="_blank" rel="noopener noreferrer" style={{ color: theme.colors.accent }}>
              ntfy
            </a>{' '}
            {t('alerts.subscribeSuffix')}
            <div style={{ display: 'flex', alignItems: 'center', gap: theme.space(2), marginTop: 4 }}>
              <code style={{ fontFamily: theme.mono, color: theme.colors.text, background: theme.colors.bgElev, padding: '2px 6px', borderRadius: theme.radius.sm }}>
                {pushTopic}
              </code>
              <a
                href={`https://ntfy.sh/${pushTopic}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 11, fontWeight: 600, color: theme.colors.accent }}
              >
                {t('alerts.openNtfy', { topic: pushTopic })}
              </a>
            </div>
            <div style={{ color: theme.colors.warn, marginTop: 4 }}>
              ⚠ {t('alerts.bestEffort')}
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: 10.5, color: theme.colors.textFaint }}>
        {t('alerts.footer')}
      </div>
    </div>
  );
}
