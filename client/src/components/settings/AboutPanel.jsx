import React, { useEffect, useState } from 'react';
import { VERSION, API_URL, hostname } from '../../config/constants.js';

const PROJECT_SITE = 'https://farhold.com';
const PROJECT_REPO = 'https://github.com/Farhold-Labs/cortex';

/**
 * The installed app, when there is one (v2.114.0).
 *
 * The native apps load the web app from the server, so VERSION is always the
 * server's build. Only the shell knows what was actually installed — which is
 * what tells you whether someone is still on an old APK.
 * Reached through window.Capacitor, never `import '@capacitor/core'` (which
 * stubs window.Capacitor in a plain browser).
 */
async function getInstalledApp() {
  const cap = window.Capacitor;
  if (cap?.isNativePlatform?.()) {
    const platform = cap.getPlatform?.() === 'ios' ? 'iOS' : 'Android';
    const App = cap.Plugins?.App;
    if (!App?.getInfo) return { platform, version: null };
    try {
      const info = await App.getInfo();
      return { platform, version: info.version, build: info.build };
    } catch {
      return { platform, version: null };
    }
  }
  if (window.electronAPI?.getAppVersion) {
    const platform = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[window.electronAPI.platform] || 'Desktop';
    try {
      return { platform: `Desktop (${platform})`, version: await window.electronAPI.getAppVersion() };
    } catch {
      return { platform: `Desktop (${platform})`, version: null };
    }
  }
  return null; // a browser
}

const AboutPanel = ({ showToast, isMobile }) => {
  const [app, setApp] = useState(undefined); // undefined = still asking
  const [server, setServer] = useState(null);

  useEffect(() => {
    let live = true;
    getInstalledApp().then(a => { if (live) setApp(a); });
    fetch(`${API_URL}/server/info`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (live) setServer(d || { error: true }); })
      .catch(() => { if (live) setServer({ error: true }); });
    return () => { live = false; };
  }, []);

  const appLine = app === undefined ? '…'
    : app === null ? 'Web browser'
    : app.version ? `${app.version}${app.build ? ` (build ${app.build})` : ''}` : 'unknown';
  const serverLine = !server ? '…' : server.error ? 'unreachable' : server.version;
  const serverName = server?.name || hostname;

  const rows = [
    ['WEB APP', VERSION],
    [app ? `${app.platform.toUpperCase()} APP` : 'APP', appLine],
    ['SERVER', serverLine],
    ['NODE', serverName],
  ];

  const copy = async () => {
    const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n${navigator.userAgent}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast?.('Copied', 'success');
    } catch {
      showToast?.('Could not copy', 'error');
    }
  };

  const openNodeInfo = (e) => {
    e.preventDefault();
    window.history.pushState({}, '', '/about');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const link = { color: 'var(--accent-teal)', textDecoration: 'none' };
  const button = {
    padding: isMobile ? '10px 14px' : '8px 14px', minHeight: isMobile ? 44 : 'auto',
    background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)',
    fontFamily: 'monospace', fontSize: '0.75rem', cursor: 'pointer',
  };

  return (
    <div style={{ fontFamily: 'monospace' }}>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: 0, fontSize: '0.8rem' }}>
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt style={{ color: 'var(--text-dim)', letterSpacing: '0.05em' }}>{k}</dt>
            <dd style={{ margin: 0, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{v}</dd>
          </React.Fragment>
        ))}
      </dl>

      {app?.version && app.version !== VERSION && (
        <div style={{ marginTop: 12, color: 'var(--text-dim)', fontSize: '0.72rem', lineHeight: 1.5 }}>
          The app loads its screens from the server, so the web app version follows the server.
          The {app.platform} app version only changes when you install a new build.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, fontSize: '0.8rem' }}>
        <a href="/about" onClick={openNodeInfo} style={link}>About this node →</a>
        <a href={PROJECT_SITE} target="_blank" rel="noopener noreferrer" style={link}>Cortex website ↗</a>
        <a href={PROJECT_REPO} target="_blank" rel="noopener noreferrer" style={link}>Source code on GitHub ↗</a>
        <a href={`${PROJECT_REPO}/releases`} target="_blank" rel="noopener noreferrer" style={link}>Release notes ↗</a>
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="button" onClick={copy} style={button}>COPY FOR SUPPORT</button>
      </div>
    </div>
  );
};

export default AboutPanel;
