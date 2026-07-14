// ErrorBoundary — React 18 unmounts the entire root on an uncaught render
// error, white-screening the app. This catches those errors and shows a
// recoverable fallback instead. Two uses:
//   1. Top-level (main.jsx): wraps <App/> so any render crash offers a reload
//      with the reassurance that on-device data is untouched.
//   2. Around the lazily-loaded Forecast chunk (App.jsx): after a Render
//      redeploy the old hashed chunk 404s, and Suspense does NOT catch that
//      dynamic-import rejection — this does, and offers a reload.
import React from 'react';
import { theme } from '../lib/theme.js';
import { isChunkLoadError } from '../lib/chunkError.js';

const btnStyle = {
  marginTop: theme.space(4),
  padding: `${theme.space(2)}px ${theme.space(5)}px`,
  fontSize: 14,
  fontWeight: 600,
  color: '#fff',
  background: theme.colors.accent,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
};

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Console for now; a future rate-limited /api/log hook (task 7.7) can POST
    // { message, stack, version } from here for on-device crash visibility.
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught a render error:', error, info);
  }

  reset() {
    this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Render-prop fallback wins (used for the Forecast chunk boundary).
    if (typeof this.props.fallback === 'function') {
      return this.props.fallback(error, this.reset);
    }

    // Default: full-screen, reassuring, reloadable.
    const chunk = isChunkLoadError(error);
    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: theme.space(6),
          color: theme.colors.text,
          background: theme.colors.bg,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: theme.space(2) }}>
          {chunk ? 'A new version is available' : 'Something went wrong'}
        </div>
        <div style={{ fontSize: 14, color: theme.colors.textDim, maxWidth: 420, lineHeight: 1.5 }}>
          {chunk
            ? 'The app was updated while this tab was open. Reload to load the latest version.'
            : 'The app hit an unexpected error. Reloading fixes it — your portfolio, trades, and settings are saved on this device and are safe.'}
        </div>
        <button type="button" style={btnStyle} onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
