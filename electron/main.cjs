/**
 * Electron main process for PT Financial Advisor.
 *
 * Thin cloud shell: opens a desktop window that loads the app straight from the
 * cloud (Render), so it always has the latest features (no re-shipping builds)
 * and ships with NO API keys (they live server-side) — safe to distribute.
 * There is no local server here; to build a local-server variant, restore the
 * startServer path from git history and point createWindow at 127.0.0.1.
 *
 * Hardening: contextIsolation on, nodeIntegration off, sandbox on, no preload,
 * and every renderer permission request (camera/mic/geo/notifications/…) is
 * denied — remote web content is shown but granted no native capabilities.
 */
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('node:path');

// Only allow one running instance; focus the existing window otherwise.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;
  let splashWindow = null;
  let splashShownAt = 0;
  let retryTimer = null;

  // The desktop loads the app from the cloud (like the mobile app), so features
  // stay current and no keys are bundled.
  const CLOUD_URL = 'https://pt-financial-advisor-u9fr.onrender.com';

  // Shared, hardened renderer settings (no preload → sandbox is safe).
  const SECURE_WEB_PREFS = { contextIsolation: true, nodeIntegration: false, sandbox: true };

  /** Show a small branded splash window instantly while the app loads. */
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
      webPreferences: SECURE_WEB_PREFS,
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
      webPreferences: SECURE_WEB_PREFS,
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

    // Offline resilience: if the cloud URL can't load (dyno asleep, no network,
    // or the service was recreated), show a local retry page instead of raw
    // Chromium error content, and keep retrying the cloud in the background.
    mainWindow.webContents.on('did-fail-load', (e, errorCode, errorDesc, validatedURL, isMainFrame) => {
      // -3 == ERR_ABORTED: a navigation was superseded by another — not a failure.
      if (!isMainFrame || errorCode === -3) return;
      swap(); // never leave the user stuck on the splash
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.loadFile(path.join(__dirname, 'offline.html')).catch(() => {});
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(CLOUD_URL);
      }, 6000);
    });

    mainWindow.on('closed', () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      mainWindow = null;
    });
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Remote web content needs no native capabilities — deny every permission
    // request (camera/mic/geolocation/notifications/USB/…) outright.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

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
