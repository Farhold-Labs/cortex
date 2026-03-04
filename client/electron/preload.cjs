// Preload script — runs in renderer context with Node.js access
// Exposes a minimal API surface to the React app via contextBridge
// NOTE: Must be CommonJS (.cjs) — Electron preload scripts don't support ESM

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Platform identifier
  platform: process.platform,

  // Show native OS notification
  showNotification: (title, body) => {
    ipcRenderer.send('show-notification', { title, body });
  },

  // Get app version from package.json
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Listen for deep link URLs (cortex:// protocol)
  onDeepLink: (callback) => {
    ipcRenderer.on('deep-link', (_event, url) => callback(url));
  },

  // Server URL persistence (stored in Electron userData, survives origin changes)
  setServerUrl: (url) => ipcRenderer.send('set-server-url', url),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  removeServerUrl: () => ipcRenderer.send('remove-server-url'),

  // Clear cache and hard-reload (for version mismatch refresh)
  clearCacheAndReload: () => ipcRenderer.send('clear-cache-and-reload'),

  // Listen for auto-update events
  onUpdateAvailable: (callback) => {
    ipcRenderer.on('update-available', (_event, version) => callback(version));
  },
  onUpdateDownloaded: (callback) => {
    ipcRenderer.on('update-downloaded', (_event, version) => callback(version));
  },
});
