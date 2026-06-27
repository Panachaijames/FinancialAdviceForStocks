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

  async function startServer(p) {
    process.env.PORT = String(p);
    process.env.NODE_ENV = 'production';
    // Point the server at the bundled client build (sibling of this folder).
    process.env.CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
    // The server is ESM and calls server.listen() on import.
    const entry = pathToFileURL(path.join(__dirname, '..', 'server', 'index.js')).href;
    await import(entry);
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
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    Menu.setApplicationMenu(null);
    mainWindow.loadURL(`http://127.0.0.1:${port}`);

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
    try {
      port = await pickPort(8787);
      await startServer(port);
      await waitForServer(port);
      createWindow();
    } catch (err) {
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
