import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Copy, Check, Download, Send, Upload, Save } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { getHealth } from '../../api/client.js';
import { sendTransfer, receiveTransfer, snapshot, applySnapshot, counts } from '../../lib/sync.js';
import { backupFilename, serializeBackup, parseBackup, downloadTextFile } from '../../lib/backup.js';
import { PanelHeader } from './SavingsPanel.jsx';
import { useT } from '../../lib/i18n.js';

/**
 * One-time cross-device transfer. "Send" uploads this device's data and shows a
 * code; "Receive" pulls a code's data into this device (replacing local) and
 * then deletes the cloud copy. Devices are NOT kept in sync — each keeps its own
 * copy afterward, and nothing lingers in the cloud.
 */
export default function SyncPanel() {
  const t = useT();
  const [serverReady, setServerReady] = useState(null); // null=loading
  const [sentCode, setSentCode] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }
  const [restoreMsg, setRestoreMsg] = useState(null); // { ok, text }
  const fileRef = useRef(null);

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
      setMsg({ ok: false, text: t('sync.sendError') });
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
      setMsg({ ok: true, text: t('sync.receiveSuccess', { holdings: counts.holdings, funds: counts.funds, savings: counts.savings }) });
    } catch (e) {
      setMsg({ ok: false, text: e && e.message ? e.message : t('sync.receiveError') });
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

  function downloadBackup() {
    try {
      downloadTextFile(backupFilename(), serializeBackup(snapshot(), new Date().toISOString()));
      setRestoreMsg({ ok: true, text: t('sync.backupDownloaded') });
    } catch {
      setRestoreMsg({ ok: false, text: t('sync.backupError') });
    }
  }

  function onRestoreFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow picking the same file again
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const snap = parseBackup(String(reader.result || ''));
        applySnapshot(snap);
        const c = counts(snap);
        setRestoreMsg({
          ok: true,
          text: t('sync.restoreSuccess', { holdings: c.holdings, funds: c.funds, savings: c.savings }),
        });
      } catch (err) {
        setRestoreMsg({ ok: false, text: err && err.message ? err.message : t('sync.restoreError') });
      }
    };
    reader.onerror = () => setRestoreMsg({ ok: false, text: t('sync.fileReadError') });
    reader.readAsText(file);
  }

  const label = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.colors.textDim, fontWeight: 600 };

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader icon={<ArrowLeftRight size={16} />} title={t('sync.title')} />

      {/* Local backup — always available; needs no server (your data is on-device). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2), padding: theme.space(2), background: theme.colors.bgElev, borderRadius: theme.radius.md }}>
        <div style={label}>{t('sync.backupLabel')}</div>
        <div style={{ fontSize: 13, color: theme.colors.textDim }}>
          {t('sync.backupIntroPre')} <b>.json</b> {t('sync.backupIntroPost')}
        </div>
        <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={downloadBackup}>
            <Save size={15} /> {t('sync.downloadBtn')}
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current && fileRef.current.click()}>
            <Upload size={15} /> {t('sync.restoreBtn')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onRestoreFile}
            style={{ display: 'none' }}
          />
        </div>
        <div style={{ fontSize: 11, color: theme.colors.textFaint }}>
          ⚠️ {t('sync.restoreWarnPre')} <b>{t('sync.replaces')}</b> {t('sync.restoreWarnPost')}
        </div>
        {restoreMsg ? (
          <div style={{ fontSize: 12.5, color: restoreMsg.ok ? theme.colors.up : theme.colors.down }}>{restoreMsg.text}</div>
        ) : null}
      </div>

      {serverReady === false ? (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim, lineHeight: 1.6, background: theme.colors.bgElev, borderRadius: theme.radius.sm, padding: theme.space(2), borderLeft: `3px solid ${theme.colors.warn}` }}>
          <b style={{ color: theme.colors.text }}>{t('sync.serverNotSetTitle')}</b> {t('sync.serverNotSetPre')} <code style={{ color: theme.colors.accent }}>UPSTASH_REDIS_REST_URL</code> {t('sync.and')}{' '}
          <code style={{ color: theme.colors.accent }}>UPSTASH_REDIS_REST_TOKEN</code>{t('sync.serverNotSetPost')}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: theme.colors.textDim }}>
            {t('sync.transferIntroPre')} <b>{t('sync.oneTime')}</b> {t('sync.transferIntroPost')}
          </div>

          {/* Send */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2), padding: theme.space(2), background: theme.colors.bgElev, borderRadius: theme.radius.md }}>
            <div style={label}>{t('sync.sendLabel')}</div>
            {sentCode ? (
              <>
                <div style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: theme.mono, fontSize: 22, fontWeight: 800, color: theme.colors.accent, letterSpacing: 1 }}>{sentCode}</span>
                  <button type="button" className="btn-ghost" onClick={copyCode} style={{ display: 'flex', alignItems: 'center', gap: 4, color: theme.colors.accent, fontSize: 12 }}>
                    {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? t('sync.copied') : t('sync.copy')}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: theme.colors.textFaint }}>
                  {t('sync.codeHintPre')} <b>{t('sync.receiveWord')}</b> {t('sync.codeHintMid')} <b>{t('sync.once')}</b> {t('sync.codeHintPost')}
                </div>
              </>
            ) : (
              <button type="button" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy || serverReady === null} onClick={send}>
                <Send size={15} /> {t('sync.createCodeBtn')}
              </button>
            )}
          </div>

          {/* Receive */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(2), padding: theme.space(2), background: theme.colors.bgElev, borderRadius: theme.radius.md }}>
            <div style={label}>{t('sync.receiveLabel')}</div>
            <div style={{ display: 'flex', gap: theme.space(2), alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: '1 1 160px' }} placeholder="PT-XXXX-XXXX" value={input} onChange={(e) => setInput(e.target.value)} />
              <button type="button" className="btn" disabled={busy || !input.trim()} onClick={receive}>
                <Download size={15} /> {t('sync.receiveWord')}
              </button>
            </div>
            <div style={{ fontSize: 11, color: theme.colors.textFaint }}>
              ⚠️ {t('sync.receiveWarnPre')} <b>{t('sync.replacesThisDevice')}</b> {t('sync.receiveWarnPost')}
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
