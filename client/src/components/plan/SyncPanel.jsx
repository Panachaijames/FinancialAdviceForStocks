import React, { useEffect, useState } from 'react';
import { ArrowLeftRight, Copy, Check, Download, Send } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { getHealth } from '../../api/client.js';
import { sendTransfer, receiveTransfer } from '../../lib/sync.js';
import { PanelHeader } from './SavingsPanel.jsx';

/**
 * One-time cross-device transfer. "Send" uploads this device's data and shows a
 * code; "Receive" pulls a code's data into this device (replacing local) and
 * then deletes the cloud copy. Devices are NOT kept in sync — each keeps its own
 * copy afterward, and nothing lingers in the cloud.
 */
export default function SyncPanel() {
  const [serverReady, setServerReady] = useState(null); // null=loading
  const [sentCode, setSentCode] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  useEffect(() => {
    let ok = true;
    getHealth()
      .then((h) => ok && setServerReady(!!(h && h.providers && h.providers.sync)))
      .catch(() => ok && setServerReady(false));
    return () => {
      ok = false;
    };
  }, []);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const code = await sendTransfer();
      setSentCode(code);
    } catch {
      setMsg({ ok: false, text: 'Could not reach the transfer server. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  async function receive() {
    setBusy(true);
    setMsg(null);
    try {
      const { counts } = await receiveTransfer(input);
      setInput('');
      setMsg({ ok: true, text: `Received — imported ${counts.holdings} holdings, ${counts.funds} funds, ${counts.savings} cash entries.` });
    } catch (e) {
      setMsg({ ok: false, text: e && e.message ? e.message : 'Receive failed.' });
    } finally {
      setBusy(false);
    }
  }

  function copyCode() {
    try {
      navigator.clipboard.writeText(sentCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const label = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.colors.textDim, fontWeight: 600 };

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader icon={<ArrowLeftRight size={16} />} title="Move data to another device" />

      {serverReady === false ? (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim, lineHeight: 1.6, background: theme.colors.bgElev, borderRadius: theme.radius.sm, padding: theme.space(2), borderLeft: `3px solid ${theme.colors.warn}` }}>
          <b style={{ color: theme.colors.text }}>Transfer server not set up.</b> Add a free Upstash Redis DB's REST
          credentials to Render as <code style={{ color: theme.colors.accent }}>UPSTASH_REDIS_REST_URL</code> and{' '}
          <code style={{ color: theme.colors.accent }}>UPSTASH_REDIS_REST_TOKEN</code>.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: theme.colors.textDim }}>
            Copy your holdings, cash &amp; funds to another device. It's a <b>one-time</b> transfer — each device keeps
            its own copy, and the cloud copy is deleted as soon as it's received (nothing stays online).
          </div>

          {/* Send */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2), padding: theme.space(2), background: theme.colors.bgElev, borderRadius: theme.radius.md }}>
            <div style={label}>Send from this device</div>
            {sentCode ? (
              <>
                <div style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: theme.mono, fontSize: 22, fontWeight: 800, color: theme.colors.accent, letterSpacing: 1 }}>{sentCode}</span>
                  <button type="button" className="btn-ghost" onClick={copyCode} style={{ display: 'flex', alignItems: 'center', gap: 4, color: theme.colors.accent, fontSize: 12 }}>
                    {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: theme.colors.textFaint }}>
                  On your other device, open this panel → <b>Receive</b> → enter this code. It works <b>once</b> and expires in 24h.
                  Re-send if you change data here later.
                </div>
              </>
            ) : (
              <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || serverReady === null} onClick={send}>
                <Send size={15} /> Create a transfer code
              </button>
            )}
          </div>

          {/* Receive */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2), padding: theme.space(2), background: theme.colors.bgElev, borderRadius: theme.radius.md }}>
            <div style={label}>Receive on this device</div>
            <div style={{ display: 'flex', gap: theme.space(2), alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: '1 1 160px' }} placeholder="PT-XXXX-XXXX" value={input} onChange={(e) => setInput(e.target.value)} />
              <button type="button" className="btn" disabled={busy || !input.trim()} onClick={receive}>
                <Download size={15} /> Receive
              </button>
            </div>
            <div style={{ fontSize: 11, color: theme.colors.textFaint }}>
              ⚠️ Receiving <b>replaces this device's</b> current holdings, cash &amp; funds with the transferred set.
            </div>
          </div>

          {msg ? (
            <div style={{ fontSize: 12.5, color: msg.ok ? theme.colors.up : theme.colors.down }}>{msg.text}</div>
          ) : null}
        </>
      )}
    </div>
  );
}
