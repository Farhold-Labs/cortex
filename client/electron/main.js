import { app, BrowserWindow, ipcMain, Notification, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import contextMenu from 'electron-context-menu';
import serve from 'electron-serve';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

// Must be called at module level (before app is ready) so electron-serve can
// call protocol.registerSchemesAsPrivileged in time. No-op in dev mode.
if (!isDev) {
  serve({ directory: path.join(__dirname, '../dist') });
}

contextMenu({
  showSaveImageAs: true,
  showCopyImage: true,
  showCopyImageAddress: true,
  showInspectElement: isDev,
  showLookUpSelection: process.platform === 'darwin',
  showSearchWithGoogle: true,
});
const APP_PROTOCOL = 'cortex';

// ============ WINDOW STATE PERSISTENCE ============

const stateFile = path.join(app.getPath('userData'), 'window-state.json');
const serverUrlFile = path.join(app.getPath('userData'), 'server-url.txt');
const DEFAULT_SERVER_URL = 'https://cortex.farhold.com';

function getSavedServerUrl() {
  try {
    if (fs.existsSync(serverUrlFile)) {
      const url = fs.readFileSync(serverUrlFile, 'utf-8').trim();
      if (url) return url;
    }
  } catch {}
  return DEFAULT_SERVER_URL;
}

function saveServerUrl(url) {
  try { fs.writeFileSync(serverUrlFile, url); } catch {}
}

function loadWindowState() {
  try {
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    }
  } catch {
    // Ignore corrupt state file
  }
  return null;
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const state = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    isMaximized: win.isMaximized(),
  };
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state));
  } catch {
    // Non-critical — ignore write failures
  }
}

// ============ DEEP LINK PROTOCOL ============

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(APP_PROTOCOL);
}

// macOS: handle protocol URL when app is already running
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function handleDeepLink(url) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send('deep-link', url);
  }
}

// ============ SINGLE INSTANCE LOCK ============

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    // Windows/Linux: deep link URL is in argv
    const deepLinkUrl = argv.find(arg => arg.startsWith(`${APP_PROTOCOL}://`));
    if (deepLinkUrl) handleDeepLink(deepLinkUrl);
  });
}

// ============ IPC HANDLERS ============

ipcMain.on('show-notification', (_event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.on('set-server-url', (_event, url) => {
  saveServerUrl(url);
});

ipcMain.handle('get-server-url', () => getSavedServerUrl());

ipcMain.on('remove-server-url', () => {
  try { fs.unlinkSync(serverUrlFile); } catch {}
});

ipcMain.on('clear-cache-and-reload', async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    await win.webContents.session.clearCache();
    if (isDev) {
      win.webContents.reloadIgnoringCache();
    } else {
      // Reload local assets with the (possibly updated) server URL in query param
      win.loadURL(`app://-/?server=${encodeURIComponent(getSavedServerUrl())}`);
    }
  }
});

// ============ CREATE WINDOW ============

let mainWindow = null;

async function createWindow() {
  const savedState = loadWindowState();

  // Ensure saved position is still on a visible display
  let { x, y, width, height } = savedState || {};
  width = width || 1200;
  height = height || 800;

  if (x !== undefined && y !== undefined) {
    const displays = screen.getAllDisplays();
    const onScreen = displays.some(d => {
      const { x: dx, y: dy, width: dw, height: dh } = d.bounds;
      return x >= dx && y >= dy && x < dx + dw && y < dy + dh;
    });
    if (!onScreen) {
      x = undefined;
      y = undefined;
    }
  }

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 400,
    minHeight: 600,
    title: 'Cortex',
    backgroundColor: '#050805',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      spellcheck: true,
    },
    // Hide frame on macOS for native title bar integration
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  });

  // Restore maximized state
  if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  // Show when ready to avoid white flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // CORS: the app is served from app://-  but makes API calls to the remote
  // server. Inject Access-Control-Allow-Origin into API responses so the
  // browser's CORS check passes. Only applies to HTTPS responses (not local
  // app:// assets which go through electron-serve directly).
  if (!isDev) {
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Access-Control-Allow-Origin': ['app://-'],
        },
      });
    });
  }

  // Save window state on move/resize
  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));

  // Load the app
  if (isDev) {
    await mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const serverUrl = getSavedServerUrl();
    // Serve bundled React assets locally; pass API server URL as query param
    // so constants.js can read it synchronously without async IPC.
    await mainWindow.loadURL(`app://-/?server=${encodeURIComponent(serverUrl)}`);

    // Migration: if the web UI previously saved a server URL to localStorage
    // (before Electron IPC persistence existed), pick it up and save to file.
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        const storedUrl = await mainWindow.webContents.executeJavaScript(
          `localStorage.getItem('farhold_server_url')`
        );
        if (storedUrl && storedUrl !== getSavedServerUrl()) {
          saveServerUrl(storedUrl);
          mainWindow.loadURL(`app://-/?server=${encodeURIComponent(storedUrl)}`);
        }
      } catch {}
    });
  }
}

// ============ APP LIFECYCLE ============

app.whenReady().then(async () => {
  await createWindow();

  // macOS: re-create window when dock icon clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Auto-updater (production only)
  // Disabled until GitHub Releases with electron-builder artifacts are published.
  // To enable: uncomment the block below and publish a release with latest-linux.yml / latest-mac.yml etc.
  // if (!isDev) {
  //   autoUpdater.autoDownload = false;
  //   autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  // }
});

// Quit when all windows are closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============ AUTO-UPDATER EVENTS ============

autoUpdater.on('update-available', (info) => {
  console.log('[Updater] Update available:', info.version);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('update-available', info.version);
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[Updater] Update downloaded:', info.version);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.webContents.send('update-downloaded', info.version);
  }
});

autoUpdater.on('error', (err) => {
  console.error('[Updater] Error:', err.message);
});
