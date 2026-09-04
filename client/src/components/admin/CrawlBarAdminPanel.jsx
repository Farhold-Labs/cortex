import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { formatError } from '../../../messages.js';

const CrawlBarAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stockSymbols, setStockSymbols] = useState('');
  const [defaultLocation, setDefaultLocation] = useState('');
  // Feeds and keys became editable here in v2.80.0. Key inputs start empty and
  // are write-only: the server never sends the real values back, so an empty
  // box means "leave this one alone", not "clear it".
  const [feeds, setFeeds] = useState([]);
  const [newFeed, setNewFeed] = useState('');
  const [keyDrafts, setKeyDrafts] = useState({});
  // Results of the TEST buttons, keyed by provider name or feed URL. Moving the
  // keys into this panel took the feedback with them — a wrong key showed as a
  // confident `set ••••7252` while every request failed.
  const [testing, setTesting] = useState({});
  const [testResults, setTestResults] = useState({});

  const runTest = async (id, body) => {
    setTesting(t => ({ ...t, [id]: true }));
    setTestResults(r => ({ ...r, [id]: null }));
    try {
      const res = await fetchAPI('/admin/crawl/test', { method: 'POST', body });
      setTestResults(r => ({ ...r, [id]: res }));
    } catch (err) {
      setTestResults(r => ({ ...r, [id]: { ok: false, detail: err.message || 'Test failed' } }));
    }
    setTesting(t => ({ ...t, [id]: false }));
  };

  const TestResult = ({ id }) => {
    if (testing[id]) return <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>testing…</span>;
    const r = testResults[id];
    if (!r) return null;
    return (
      <span style={{ fontSize: '0.65rem', color: r.ok ? 'var(--accent-green)' : 'var(--accent-orange)' }}>
        {r.ok ? '✓' : '✗'} {r.detail}{r.feedTitle ? ` — feed calls itself "${r.feedTitle}"` : ''}
      </span>
    );
  };

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI('/admin/crawl/config');
      setConfig(data.config);
      setStockSymbols((data.config?.stock_symbols || []).join(', '));
      setDefaultLocation(data.config?.default_location?.name || '');
      setFeeds(data.config?.news_sources || []);
      setKeyDrafts({});
    } catch (err) {
      if (!err.message?.includes('401')) {
        showToast(err.message || formatError('Failed to load crawl config'), 'error');
      }
    }
    setLoading(false);
  }, [fetchAPI, showToast]);

  useEffect(() => {
    if (isOpen && !config) {
      loadConfig();
    }
  }, [isOpen, config, loadConfig]);

  const handleSave = async (updates) => {
    setSaving(true);
    try {
      const data = await fetchAPI('/admin/crawl/config', {
        method: 'PUT',
        body: updates
      });
      setConfig(data.config);
      showToast('Crawl bar configuration updated', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to update config'), 'error');
    }
    setSaving(false);
  };

  const handleSaveSymbols = async () => {
    const symbols = stockSymbols
      .split(',')
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0);
    await handleSave({ stock_symbols: symbols });
    setStockSymbols(symbols.join(', '));
  };

  const handleSaveLocation = async () => {
    // Simple location parsing - just store the name and let backend resolve coordinates
    if (defaultLocation.trim()) {
      await handleSave({
        default_location: { name: defaultLocation.trim(), lat: null, lon: null }
      });
    } else {
      await handleSave({
        default_location: { name: 'New York, NY', lat: 40.7128, lon: -74.0060 }
      });
      setDefaultLocation('New York, NY');
    }
  };

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-teal)40',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', fontWeight: 500 }}>📊 CRAWL BAR CONFIG</div>
        <button
          onClick={onToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? 'var(--accent-teal)20' : 'transparent',
            border: `1px solid ${isOpen ? 'var(--accent-teal)' : 'var(--border-primary)'}`,
            color: isOpen ? 'var(--accent-teal)' : 'var(--text-dim)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '0.7rem',
          }}
        >
          {isOpen ? '▼ HIDE' : '▶ SHOW'}
        </button>
      </div>

      {isOpen && (
        <div style={{ marginTop: '16px' }}>
          {loading ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>Loading...</div>
          ) : (
            <>
              {/* Feature Toggles */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>ENABLED FEATURES</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleSave({ stocks_enabled: !config?.stocks_enabled })}
                    disabled={saving}
                    style={{
                      padding: isMobile ? '10px 16px' : '8px 16px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: config?.stocks_enabled ? 'var(--accent-green)20' : 'transparent',
                      border: `1px solid ${config?.stocks_enabled ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                      color: config?.stocks_enabled ? 'var(--accent-green)' : 'var(--text-dim)',
                      cursor: saving ? 'wait' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    📈 STOCKS
                  </button>
                  <button
                    onClick={() => handleSave({ weather_enabled: !config?.weather_enabled })}
                    disabled={saving}
                    style={{
                      padding: isMobile ? '10px 16px' : '8px 16px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: config?.weather_enabled ? 'var(--accent-teal)20' : 'transparent',
                      border: `1px solid ${config?.weather_enabled ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
                      color: config?.weather_enabled ? 'var(--accent-teal)' : 'var(--text-dim)',
                      cursor: saving ? 'wait' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    🌡️ WEATHER
                  </button>
                  <button
                    onClick={() => handleSave({ news_enabled: !config?.news_enabled })}
                    disabled={saving}
                    style={{
                      padding: isMobile ? '10px 16px' : '8px 16px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: config?.news_enabled ? 'var(--accent-purple)20' : 'transparent',
                      border: `1px solid ${config?.news_enabled ? 'var(--accent-purple)' : 'var(--border-subtle)'}`,
                      color: config?.news_enabled ? 'var(--accent-purple)' : 'var(--text-dim)',
                      cursor: saving ? 'wait' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    ◆ NEWS
                  </button>
                </div>
              </div>

              {/* Stock Symbols */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>STOCK SYMBOLS</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="AAPL, GOOGL, MSFT, AMZN, TSLA"
                    value={stockSymbols}
                    onChange={(e) => setStockSymbols(e.target.value)}
                    style={{
                      flex: 1,
                      padding: isMobile ? '12px' : '10px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                    }}
                  />
                  <button
                    onClick={handleSaveSymbols}
                    disabled={saving}
                    style={{
                      padding: isMobile ? '12px 16px' : '10px 16px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'var(--accent-amber)20',
                      border: '1px solid var(--accent-amber)',
                      color: 'var(--accent-amber)',
                      cursor: saving ? 'wait' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    SAVE
                  </button>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
                  Comma-separated list of stock ticker symbols
                </div>
              </div>

              {/* Default Location */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>DEFAULT LOCATION</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="New York, NY"
                    value={defaultLocation}
                    onChange={(e) => setDefaultLocation(e.target.value)}
                    style={{
                      flex: 1,
                      padding: isMobile ? '12px' : '10px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                    }}
                  />
                  <button
                    onClick={handleSaveLocation}
                    disabled={saving}
                    style={{
                      padding: isMobile ? '12px 16px' : '10px 16px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'var(--accent-amber)20',
                      border: '1px solid var(--accent-amber)',
                      color: 'var(--accent-amber)',
                      cursor: saving ? 'wait' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.9rem' : '0.85rem',
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    SAVE
                  </button>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
                  Default location for weather when user location is unavailable
                </div>
              </div>

              {/* Refresh Intervals */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>REFRESH INTERVALS (SECONDS)</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginBottom: '4px' }}>Stocks</div>
                    <input
                      type="number"
                      min="30"
                      max="600"
                      value={config?.stock_refresh_interval || 60}
                      onChange={(e) => handleSave({ stock_refresh_interval: parseInt(e.target.value, 10) || 60 })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                      }}
                    />
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginBottom: '4px' }}>Weather</div>
                    <input
                      type="number"
                      min="60"
                      max="1800"
                      value={config?.weather_refresh_interval || 300}
                      onChange={(e) => handleSave({ weather_refresh_interval: parseInt(e.target.value, 10) || 300 })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                      }}
                    />
                  </div>
                  <div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginBottom: '4px' }}>News</div>
                    <input
                      type="number"
                      min="60"
                      max="1800"
                      value={config?.news_refresh_interval || 180}
                      onChange={(e) => handleSave({ news_refresh_interval: parseInt(e.target.value, 10) || 180 })}
                      style={{
                        width: '100%',
                        padding: '8px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        fontFamily: 'monospace',
                        fontSize: '0.85rem',
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* ===== NEWS FEEDS (v2.80.0) ===== */}
              <div style={{ padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginTop: '12px' }}>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>NEWS FEEDS (RSS)</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginBottom: '10px', lineHeight: 1.5 }}>
                  Headlines shown in the crawl bar. Before v2.80.0 these lived in <code>NEWS_RSS_FEEDS</code> and
                  anything set here was silently ignored; they are now what the server actually fetches.
                </div>

                {feeds.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: '8px' }}>No feeds configured.</div>
                )}
                {feeds.map((f, i) => (
                  <div key={f.url + i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--text-secondary)', fontSize: '0.72rem',
                                   fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name ? `${f.name} — ` : ''}{f.url}
                    </span>
                    <button
                      disabled={!!testing[f.url]}
                      onClick={() => runTest(f.url, { feedUrl: f.url })}
                      style={{ background: 'none', border: '1px solid var(--accent-teal)', color: 'var(--accent-teal)',
                               cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.65rem', padding: '3px 8px' }}
                    >TEST</button>
                    <button
                      disabled={saving}
                      onClick={() => {
                        const next = feeds.filter((_, j) => j !== i);
                        setFeeds(next);
                        handleSave({ news_sources: next });
                      }}
                      style={{ background: 'none', border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)',
                               cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.65rem', padding: '3px 8px' }}
                    >REMOVE</button>
                  </div>
                ))}
                {feeds.map((f, i) => (
                  testResults[f.url] || testing[f.url]
                    ? <div key={'res-' + f.url + i} style={{ margin: '-2px 0 6px 2px' }}><TestResult id={f.url} /></div>
                    : null
                ))}

                <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                  <input
                    type="url"
                    value={newFeed}
                    placeholder="https://example.com/feed.xml"
                    onChange={(e) => setNewFeed(e.target.value)}
                    style={{ flex: 1, minWidth: 0, padding: '6px 8px', background: 'var(--bg-surface)',
                             border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
                             fontFamily: 'monospace', fontSize: '0.75rem' }}
                  />
                  <button
                    disabled={saving || !newFeed.trim()}
                    onClick={() => {
                      const url = newFeed.trim();
                      let name = url;
                      try { name = new URL(url).hostname; } catch { /* keep the raw string */ }
                      const next = [...feeds, { type: 'rss', url, name }];
                      setFeeds(next);
                      setNewFeed('');
                      handleSave({ news_sources: next });
                    }}
                    style={{ background: 'var(--accent-green)20', border: '1px solid var(--accent-green)',
                             color: 'var(--accent-green)', cursor: 'pointer', fontFamily: 'monospace',
                             fontSize: '0.7rem', padding: '6px 14px' }}
                  >ADD</button>
                </div>
              </div>

              {/* ===== PROVIDER API KEYS (v2.80.0) ===== */}
              <div style={{ padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginTop: '12px' }}>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>PROVIDER API KEYS</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginBottom: '10px', lineHeight: 1.5 }}>
                  Stored encrypted in the database. The server never sends a key back, so these boxes stay
                  empty — type to replace one, leave blank to keep it as it is.
                </div>

                {config?.secretStorage && !config.secretStorage.available && (
                  <div style={{ padding: '8px 10px', marginBottom: '10px', border: '1px solid var(--accent-orange)',
                                color: 'var(--accent-orange)', fontSize: '0.68rem', lineHeight: 1.5 }}>
                    ⚠️ {config.secretStorage.reason} Until then keys are read from <code>.env</code> and cannot be edited here.
                  </div>
                )}

                {(config?.providers || []).map(p => (
                  <div key={p.name} style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '3px' }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', minWidth: 118 }}>{p.name}</span>
                      <span style={{ fontSize: '0.65rem', color: p.configured ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                        {p.configured ? `set ${p.hint}` : 'not set'}
                      </span>
                      {p.source === 'env' && (
                        <span style={{ fontSize: '0.62rem', color: 'var(--accent-amber)' }}>
                          from {p.envVar} — saving here takes over
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={keyDrafts[p.name] ?? ''}
                        placeholder={p.configured ? 'unchanged' : 'paste key'}
                        disabled={config?.secretStorage && !config.secretStorage.available}
                        onChange={(e) => setKeyDrafts(d => ({ ...d, [p.name]: e.target.value }))}
                        style={{ flex: 1, minWidth: 0, padding: '5px 8px', background: 'var(--bg-surface)',
                                 border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
                                 fontFamily: 'monospace', fontSize: '0.72rem' }}
                      />
                      {p.configured && (
                        <button
                          disabled={!!testing[p.name]}
                          onClick={() => runTest(p.name, { provider: p.name })}
                          style={{ background: 'none', border: '1px solid var(--accent-teal)', color: 'var(--accent-teal)',
                                   cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.62rem', padding: '3px 8px' }}
                        >TEST</button>
                      )}
                      {p.configured && p.source === 'database' && (
                        <button
                          disabled={saving}
                          onClick={() => handleSave({ providerKeys: { [p.name]: null } }).then(loadConfig)}
                          style={{ background: 'none', border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)',
                                   cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.62rem', padding: '3px 8px' }}
                        >CLEAR</button>
                      )}
                    </div>
                    {(testResults[p.name] || testing[p.name]) && (
                      <div style={{ marginTop: '3px' }}><TestResult id={p.name} /></div>
                    )}
                  </div>
                ))}

                <button
                  disabled={saving || Object.values(keyDrafts).every(v => !v || !v.trim())}
                  onClick={async () => {
                    // Only send what was actually typed — anything else would
                    // overwrite a stored key with an empty string.
                    const payload = {};
                    for (const [name, v] of Object.entries(keyDrafts)) {
                      if (v && v.trim()) payload[name] = v.trim();
                    }
                    await handleSave({ providerKeys: payload });
                    setKeyDrafts({});
                    loadConfig();
                  }}
                  style={{ marginTop: '6px', background: 'var(--accent-green)20', border: '1px solid var(--accent-green)',
                           color: 'var(--accent-green)', cursor: 'pointer', fontFamily: 'monospace',
                           fontSize: '0.7rem', padding: '7px 16px' }}
                >{saving ? 'SAVING…' : 'SAVE KEYS'}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ============ ALERTS ADMIN PANEL ============
export default CrawlBarAdminPanel;
