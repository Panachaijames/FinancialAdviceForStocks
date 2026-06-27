// Singleton market WebSocket client with auto-reconnect, resubscribe, and ref-counting.

class MarketSocket {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.connecting = false;
    this.shouldConnect = false;

    // symbol -> ref count
    this.subscriptions = new Map();

    this.quoteListeners = new Set();
    this.fxListeners = new Set();

    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
  }

  _url() {
    // Explicit WS URL wins (e.g. VITE_WS_URL=wss://your-backend/ws).
    const envWs = import.meta.env.VITE_WS_URL;
    if (envWs) return envWs;
    // Otherwise derive from the REST base if the backend is hosted elsewhere.
    const apiBase = import.meta.env.VITE_API_BASE;
    if (apiBase) {
      try {
        const u = new URL(apiBase);
        const proto = u.protocol === 'https:' ? 'wss' : 'ws';
        return `${proto}://${u.host}/ws`;
      } catch {
        /* fall through to same-origin */
      }
    }
    // Same-origin default (single-host deploy + local dev via Vite proxy).
    if (typeof window === 'undefined') return '';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/ws`;
  }

  ensureConnected() {
    this.shouldConnect = true;
    if (this.connected || this.connecting) return;
    this._connect();
  }

  _connect() {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
    if (this.connecting || this.connected) return;
    const url = this._url();
    if (!url) return;
    this.connecting = true;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.connecting = false;
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connecting = false;
      this.connected = true;
      this.reconnectAttempts = 0;
      // Re-subscribe to all active symbols.
      const symbols = Array.from(this.subscriptions.keys());
      if (symbols.length) {
        this._send({ type: 'subscribe', symbols });
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'quote' && msg.data) {
        for (const cb of this.quoteListeners) {
          try {
            cb(msg.data);
          } catch {
            /* listener errors must not break the loop */
          }
        }
      } else if (msg.type === 'fx' && msg.data) {
        for (const cb of this.fxListeners) {
          try {
            cb(msg.data);
          } catch {
            /* ignore */
          }
        }
      }
      // 'hello' and any unknown types are ignored.
    };

    ws.onerror = () => {
      // The close handler manages reconnection.
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      this.connecting = false;
      this.connected = false;
      this.ws = null;
      if (this.shouldConnect) {
        this._scheduleReconnect();
      }
    };
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (!this.shouldConnect) return;
    this.reconnectAttempts += 1;
    const base = Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempts, 5));
    const jitter = Math.floor(Math.random() * 500);
    const delay = base + jitter;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, delay);
  }

  _send(obj) {
    if (this.ws && this.connected && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(obj));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Subscribe to a list of symbols (ref-counted).
   * @param {string[]} symbols
   */
  subscribe(symbols) {
    const list = Array.isArray(symbols) ? symbols.filter(Boolean) : [];
    if (list.length === 0) return;
    this.ensureConnected();
    const toSend = [];
    for (const sym of list) {
      const prev = this.subscriptions.get(sym) || 0;
      this.subscriptions.set(sym, prev + 1);
      if (prev === 0) toSend.push(sym);
    }
    if (toSend.length) {
      this._send({ type: 'subscribe', symbols: toSend });
    }
  }

  /**
   * Unsubscribe from a list of symbols (ref-counted).
   * @param {string[]} symbols
   */
  unsubscribe(symbols) {
    const list = Array.isArray(symbols) ? symbols.filter(Boolean) : [];
    if (list.length === 0) return;
    const toSend = [];
    for (const sym of list) {
      const prev = this.subscriptions.get(sym) || 0;
      if (prev <= 1) {
        this.subscriptions.delete(sym);
        if (prev === 1) toSend.push(sym);
      } else {
        this.subscriptions.set(sym, prev - 1);
      }
    }
    if (toSend.length) {
      this._send({ type: 'unsubscribe', symbols: toSend });
    }
  }

  /**
   * Register a quote listener. Returns an unsubscribe function.
   * @param {(quote:object)=>void} cb
   */
  onQuote(cb) {
    if (typeof cb !== 'function') return () => {};
    this.quoteListeners.add(cb);
    this.ensureConnected();
    return () => {
      this.quoteListeners.delete(cb);
    };
  }

  /**
   * Register an FX listener. Returns an unsubscribe function.
   * @param {(fx:object)=>void} cb
   */
  onFx(cb) {
    if (typeof cb !== 'function') return () => {};
    this.fxListeners.add(cb);
    this.ensureConnected();
    return () => {
      this.fxListeners.delete(cb);
    };
  }
}

const marketSocket = new MarketSocket();

export default marketSocket;
