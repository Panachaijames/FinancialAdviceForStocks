import React, { useEffect, useState } from 'react';
import { RefreshCw, Copy, Check, Link2, Plus, Unlink } from 'lucide-react';
import { theme } from '../../lib/theme.js';
import { timeAgo } from '../../lib/format.js';
import { getHealth } from '../../api/client.js';
import { useSyncStore } from '../../store/syncStore.js';
import { generateCode, pushNow, pullNow } from '../../lib/sync.js';
import { PanelHeader } from './SavingsPanel.jsx';

/**
 * Cross-device sync via a private code. This device can create a code (its data
 * becomes the master) or link to an existing code (its data is replaced by the
 * synced set). After that, changes sync automatically (last write wins).
 */
export default function SyncPanel() {
  const { code, lastSyncedAt, status, error, setCode, unlink } = useSyncStore();
  const [serverReady, setServerReady] = useState(null); // null=loading
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let ok = true;
    getHealth()
      .then((h) => {
        if (ok) setServerReady(!!(h && h.providers && h.providers.sync));
      })
      .catch(() => ok && setServerReady(false));
    return () => {
      ok = false;
    };
  }, []);

  async function create() {
    setBusy(true);
    try {
      const c = generateCode();
      setCode(c);
      await pushNow(); // upload this device's data as the master copy
    } catch {
      /* status reflects error */
    } finally {
      setBusy(false);
    }
  }

  async function link() {
    const c = (input || '').trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    try {
      setCode(c);
      await pullNow({ force: true }); // replace local with the synced set
      setInput('');
    } catch {
      /* status reflects error */
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      await pushNow();
      await pullNow();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  function copyCode() {
    try {
      navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  const label = { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: theme.colors.textDim, fontWeight: 600 };

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: theme.space(3) }}>
      <PanelHeader
        icon={<RefreshCw size={16} />}
        title="Sync across devices"
        right={
          code ? (
            <span style={{ fontSize: 11, color: status === 'error' ? theme.colors.down : theme.colors.textDim }}>
              {status === 'syncing' ? 'Syncing…' : status === 'error' ? 'Offline' : lastSyncedAt ? `Synced ${timeAgo(lastSyncedAt)}` : 'Linked'}
            </span>
          ) : null
        }
      />

      {serverReady === false ? (
        <div style={{ fontSize: 12.5, color: theme.colors.textDim, lineHeight: 1.6, background: theme.colors.bgElev, borderRadius: theme.radius.sm, padding: theme.space(2), borderLeft: `3px solid ${theme.colors.warn}` }}>
          <b style={{ color: theme.colors.text }}>One-time server setup needed.</b> Create a free{' '}
          <b>Upstash Redis</b> database, then add its two REST credentials to your Render service as{' '}
          <code style={{ color: theme.colors.accent }}>UPSTASH_REDIS_REST_URL</code> and{' '}
          <code style={{ color: theme.colors.accent }}>UPSTASH_REDIS_REST_TOKEN</code>. Sync turns on automatically after the redeploy.
        </div>
      ) : !code ? (
        <>
          <div style={{ fontSize: 13, color: theme.colors.textDim }}>
            Keep your portfolio in sync on phone, desktop &amp; web. Create a code on the device that has your data,
            then link your other devices with it.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: theme.space(2), alignItems: 'flex-end' }}>
            <button type="button" className="btn btn-primary" disabled={busy || serverReady === null} onClick={create}>
              <Plus size={15} /> Create a sync code
            </button>
            <div style={{ flex: '1 1 200px', display: 'flex', gap: theme.space(2), alignItems: 'flex-end' }}>
              <label style={{ flex: 1 }}>
                <span style={{ ...label, display: 'block', marginBottom: 4 }}>Have a code?</span>
                <input className="input" placeholder="PT-XXXX-XXXX" value={input} onChange={(e) => setInput(e.target.value)} />
              </label>
              <button type="button" className="btn" disabled={busy || !input.trim()} onClick={link}>
                <Link2 size={15} /> Link
              </button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: theme.colors.textFaint }}>
            Linking <b>replaces this device's</b> portfolio with the synced one. The code is private — anyone with it can
            see your holdings (symbols &amp; amounts only), so keep it to yourself.
          </div>
        </>
      ) : (
        <>
          <div>
            <span style={{ ...label, display: 'block', marginBottom: 4 }}>Your sync code</span>
            <div style={{ display: 'flex', gap: theme.space(2), alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: theme.mono, fontSize: 20, fontWeight: 800, color: theme.colors.text, letterSpacing: 1 }}>{code}</span>
              <button type="button" className="btn-ghost" onClick={copyCode} title="Copy" style={{ display: 'flex', alignItems: 'center', gap: 4, color: theme.colors.accent, fontSize: 12 }}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: theme.colors.textFaint, marginTop: 4 }}>
              Enter this code on your other devices (Link) to sync them.
            </div>
          </div>
          {error ? <div style={{ fontSize: 12, color: theme.colors.down }}>{error}</div> : null}
          <div style={{ display: 'flex', gap: theme.space(2), flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={syncNow}>
              <RefreshCw size={15} /> Sync now
            </button>
            <button type="button" className="btn" onClick={unlink} title="Stop syncing on this device (keeps local data)">
              <Unlink size={15} /> Unlink
            </button>
          </div>
        </>
      )}
    </div>
  );
}
