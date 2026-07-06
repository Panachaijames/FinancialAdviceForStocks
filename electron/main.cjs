/**
 * Electron main process for PT Financial Advisor.
 *
 * Thin shell: opens a desktop window that loads the app straight from the cloud
 * (Render). So it always has the latest features (no re-shipping builds), ships
 * with NO API keys (they live server-side), and is safe to distribute. The
 * legacy in-process local-server code (startServer/pickPort/…) is kept below but
 * unused — flip createWindow back to the local port to revert to a local build.
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

  // The desktop loads the app from the cloud (like the mobile app), so features
  // stay current and no keys are bundled.
  const CLOUD_URL = 'https://pt-financial-advisor-u9fr.onrender.com';

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
    // Short — the boot splash just covers server start; the in-app cinematic
    // intro (IntroOverlay) takes over once the window content loads.
    const MIN_MS = 300;
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
    mainWindow.loadURL(CLOUD_URL);

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
    // Longer fallback: the cloud can cold-start on the free tier (the splash
    // stays up meanwhile); did-finish-load normally wins well before this.
    setTimeout(swap, 45000);

    // Open external links (e.g. news articles) in the user's default browser.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(CLOUD_URL)) {
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
    createWindow(); // loads CLOUD_URL — no local server to start

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
