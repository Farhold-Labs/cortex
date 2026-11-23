import React, { useState, useEffect } from 'react';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import { formatError } from '../../../messages.js';

const PLATFORM_NAMES = { android: 'Android app', ios: 'iPhone app', desktop: 'Desktop app', pwa: 'Installed web app', web: 'Browser' };

/** Newer-first comparison of "2.146.0"-style versions. */
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Which builds of Cortex are in use (v2.146.0): installs seen in the last 30
 * days, by platform, installed app version and web build. Counts only; the
 * server keeps no account with a report. Installs that haven't reported since
 * v2.146.0 aren't here.
 */
const ClientVersionsPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    setLoading(true);
    fetchAPI('/admin/client-versions')
      .then(d => { if (live) setData(d); })
      .catch(err => showToast(err.message || formatError('Failed to load client versions'), 'error'))
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [isOpen]);

  const byPlatform = {};
  for (const row of data?.versions || []) (byPlatform[row.platform] ||= []).push(row);
  const order = ['android', 'ios', 'desktop', 'pwa', 'web'].filter(p => byPlatform[p]);
  const cell = { padding: '4px 8px', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8rem', textAlign: 'left' };

  return (
    <CollapsibleSection title="CLIENT VERSIONS" isOpen={isOpen} onToggle={onToggle} isMobile={isMobile}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '10px' }}>
        Installs seen in the last {data?.days || 30} days. The server runs {data?.serverVersion || '…'}; the apps load
        their web build from it, so the app version matters only for what the app does itself, such as ringing
        for calls (2.146.0 and later). Each install reports when it's opened, with no account attached.
      </div>
      {loading && !data ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Loading…</div>
      ) : !order.length ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>No reports yet.</div>
      ) : order.map(platform => {
        const rows = [...byPlatform[platform]].sort((a, b) => compareVersions(a.appVersion, b.appVersion) || compareVersions(a.webVersion, b.webVersion));
        const total = rows.reduce((n, r) => n + r.installs, 0);
        const isApp = !['web', 'pwa'].includes(platform);
        return (
          <div key={platform} style={{ marginBottom: '14px' }} data-client-platform={platform}>
            <div style={{ color: 'var(--accent-amber)', fontSize: '0.85rem', marginBottom: '4px' }}>
              {PLATFORM_NAMES[platform] || platform} · {total} install{total === 1 ? '' : 's'}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', color: 'var(--text-primary)' }}>
                <thead>
                  <tr>
                    {isApp && <th style={cell}>App</th>}
                    <th style={cell}>Web build</th>
                    <th style={cell}>Installs</th>
                    <th style={cell}>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      {isApp && <td style={cell}>{r.appVersion || 'unknown'}</td>}
                      <td style={cell}>{r.webVersion || 'unknown'}</td>
                      <td style={cell}>{r.installs}</td>
                      <td style={cell}>{r.lastSeen ? new Date(r.lastSeen).toLocaleDateString() : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </CollapsibleSection>
  );
};

export default ClientVersionsPanel;
