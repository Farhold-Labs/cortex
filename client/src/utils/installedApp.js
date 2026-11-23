// What this copy of Cortex is running in (v2.114.0, shared since v2.146.0).
//
// The native apps load the web app from the server, so VERSION is always the
// server's build. Only the shell knows what was actually installed, which is
// what tells you whether someone is still on an old APK.
// Reached through window.Capacitor, never `import '@capacitor/core'` (which
// stubs window.Capacitor in a plain browser).

/** { platform, version, build } for an installed app, or null in a browser. */
export async function getInstalledApp() {
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.()) {
    const kind = cap.getPlatform?.() === 'ios' ? 'ios' : 'android';
    const platform = kind === 'ios' ? 'iOS' : 'Android';
    const App = cap.Plugins?.App;
    if (!App?.getInfo) return { kind, platform, version: null };
    try {
      const info = await App.getInfo();
      return { kind, platform, version: info.version, build: info.build };
    } catch {
      return { kind, platform, version: null };
    }
  }
  if (window.electronAPI?.getAppVersion) {
    const platform = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[window.electronAPI.platform] || 'Desktop';
    try {
      return { kind: 'desktop', platform: `Desktop (${platform})`, version: await window.electronAPI.getAppVersion() };
    } catch {
      return { kind: 'desktop', platform: `Desktop (${platform})`, version: null };
    }
  }
  return null; // a browser
}
