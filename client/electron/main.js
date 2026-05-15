import { app, BrowserWindow, ipcMain, Notification, screen, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import contextMenu from 'electron-context-menu';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

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
  } catch {}
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
  } catch {}
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
      // Navigate to the (possibly updated) server URL rather than reloading the old one
      win.loadURL(getSavedServerUrl());
    }
  }
});

// ============ CREATE WINDOW ============

let mainWindow = null;

async function createWindow() {
  const savedState = loadWindowState();

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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 14 } : undefined,
    show: false,
  });

  if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open target="_blank" links and window.open() calls in the OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Intercept in-page navigation to external origins and open in OS browser
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const appOrigin = new URL(isDev ? 'http://localhost:3000' : getSavedServerUrl()).origin;
      if (new URL(url).origin !== appOrigin) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));

  // Load app: dev server in development, configured server URL in production
  if (isDev) {
    await mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    await mainWindow.loadURL(getSavedServerUrl());
  }
}

// ============ APP LIFECYCLE ============

app.whenReady().then(async () => {
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Auto-updater (production only)
  // if (!isDev) {
  //   autoUpdater.autoDownload = false;
  //   autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  // }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============ AUTO-UPDATER EVENTS ============

autoUpdater.on('update-available', (info) => {
  console.log('[Updater] Update available:', info.version);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-available', info.version);
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[Updater] Update downloaded:', info.version);
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send('update-downloaded', info.version);
});

autoUpdater.on('error', (err) => {
  console.error('[Updater] Error:', err.message);
});
