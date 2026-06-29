/**
 * Electron main process for PT Financial Advisor.
 *
 * Starts the bundled Node/Express + WebSocket server (in-process) on a free
 * local port, then opens a desktop window pointing at it. Everything runs on the
 * user's own machine — so Yahoo Finance (which blocks cloud IPs) works, giving
 * full features (Thai stocks, dividends, realtime, news) with NO API keys.
 */
const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Only allow one running instance; focus the existing window otherwise.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;
  let splashWindow = null;
  let splashShownAt = 0;
  let port = 8787;

  /** Resolve a free port, preferring 8787, falling back to an ephemeral one. */
  function pickPort(preferred) {
    return new Promise((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => {
        const eph = net.createServer();
        eph.listen(0, '127.0.0.1', () => {
          const p = eph.address().port;
          eph.close(() => resolve(p));
        });
      });
      probe.listen(preferred, '127.0.0.1', () => {
        probe.close(() => resolve(preferred));
      });
    });
  }

  /** Wait until the server is accepting connections. */
  function waitForServer(p, timeoutMs = 25000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const sock = net.connect(p, '127.0.0.1');
        sock.once('connect', () => {
          sock.destroy();
          resolve();
        });
        sock.once('error', () => {
          sock.destroy();
          if (Date.now() - startedAt > timeoutMs) reject(new Error('Server did not start in time'));
          else setTimeout(attempt, 250);
        });
      };
      attempt();
    });
  }

  /**
   * Load environment vars (e.g. TWELVEDATA_KEY / FINNHUB_KEY) for the packaged
   * app. dotenv never overrides already-set vars, so a real OS env var always
   * wins; otherwise we read a .env next to the executable first (lets a machine
   * supply its own key without rebuilding), then the bundled .env at the app
   * root. Harmless no-op when no file exists.
   */
  function loadEnv() {
    try {
      const dotenv = require('dotenv');
      const candidates = [
        path.join(path.dirname(process.execPath), '.env'), // next to the .exe
        path.join(__dirname, '..', '.env'), // bundled at the app root
      ];
      for (const file of candidates) dotenv.config({ path: file });
    } catch {
      // dotenv missing or unreadable path — server config.js will still try.
    }
  }

  async function startServer(p) {
    loadEnv();
    process.env.PORT = String(p);
    process.env.NODE_ENV = 'production';
    // Point the server at the bundled client build (sibling of this folder).
    process.env.CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
    // The server is ESM and calls server.listen() on import.
    const entry = pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href;
    await import(entry);
  }

  /** Show a small branded splash window instantly while the server boots. */
  function createSplash() {
    splashWindow = new BrowserWindow({
      width: 460,
      height: 300,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      show: false,
      center: true,
      alwaysOnTop: true,
      backgroundColor: '#0b0e14',
      title: 'PT Financial Advisor',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    splashWindow.loadFile(path.join(__dirname, 'splash.html'));
    splashWindow.once('ready-to-show', () => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
    });
    splashShownAt = Date.now();
  }

  /** Keep the splash up a minimum time, fade it out, then destroy it. */
  function closeSplash() {
    if (!splashWindow) return;
    const win = splashWindow;
    splashWindow = null;
    const MIN_MS = 1500;
    const wait = Math.max(0, MIN_MS - (Date.now() - splashShownAt));
    setTimeout(() => {
      if (win.isDestroyed()) return;
      win.webContents.executeJavaScript("document.body.classList.add('closing')").catch(() => {});
      setTimeout(() => {
        if (!win.isDestroyed()) win.destroy();
      }, 340);
    }, wait);
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      backgroundColor: '#0b0e14',
      title: 'PT Financial Advisor',
      autoHideMenuBar: true,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    Menu.setApplicationMenu(null);
    mainWindow.loadURL(`http://127.0.0.1:${port}`);

    // Swap from splash to the real window once it's painted (with fallbacks so
    // we can never get stuck showing the splash).
    let swapped = false;
    const swap = () => {
      if (swapped) return;
      swapped = true;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
      closeSplash();
    };
    mainWindow.once('ready-to-show', swap);
    mainWindow.webContents.once('did-finish-load', swap);
    setTimeout(swap, 12000);

    // Open external links (e.g. news articles) in the user's default browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(`http://127.0.0.1:${port}`)) {
        e.preventDefault();
        shell.openExternal(url);
      }
    });

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createSplash();
    try {
      port = await pickPort(8787);
      await startServer(port);
      await waitForServer(port);
      createWindow();
    } catch (err) {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
      splashWindow = null;
      dialog.showErrorBox('PT Financial Advisor', `Failed to start:\n${err && err.message ? err.message : err}`);
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
