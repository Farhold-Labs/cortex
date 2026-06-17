import React, { useState, useEffect, useCallback, useRef } from 'react';
import { API_URL } from '../config/constants.js';
import { useWindowSize } from '../hooks/useWindowSize.js';

const isEmbed = new URLSearchParams(window.location.search).get('embed') === '1';
const preselectedWave = new URLSearchParams(window.location.search).get('wave');

const fmt = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const Initials = ({ name, size = 32 }) => (
  <div style={{
    width: size, height: size, borderRadius: '50%',
    background: 'var(--accent-teal, #00b4d8)30',
    color: 'var(--accent-teal, #00b4d8)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 'bold', fontSize: size * 0.4, flexShrink: 0,
    fontFamily: 'Courier New, monospace',
  }}>
    {(name || '?')[0].toUpperCase()}
  </div>
);

const PortalMessage = ({ msg, waveId }) => {
  const openInCortex = () => {
    window.open(`/?wave=${waveId}`, '_blank', 'noopener');
  };

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 0',
      borderBottom: '1px solid var(--border-secondary, #1a2a1a)',
    }}>
      {msg.author.avatarUrl ? (
        <img src={msg.author.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <Initials name={msg.author.displayName} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--text-primary, #e8f5e8)', fontWeight: 'bold', fontSize: '0.9rem' }}>
            {msg.author.displayName}
          </span>
          {msg.author.handle && (
            <span style={{ color: 'var(--text-muted, #4a7a4a)', fontSize: '0.8rem' }}>@{msg.author.handle}</span>
          )}
          <span style={{ color: 'var(--text-muted, #4a7a4a)', fontSize: '0.75rem', marginLeft: 'auto' }}>
            {fmt(msg.createdAt)}
          </span>
        </div>
        {msg.isEncrypted ? (
          <div style={{ color: 'var(--text-muted, #4a7a4a)', fontStyle: 'italic', fontSize: '0.85rem' }}>
            [Encrypted message — open Cortex to read]
          </div>
        ) : (
          <div
            style={{ color: 'var(--text-primary, #e8f5e8)', lineHeight: 1.6, fontSize: '0.9rem', wordBreak: 'break-word' }}
            dangerouslySetInnerHTML={{ __html: msg.content || '' }}
          />
        )}
        <button
          onClick={openInCortex}
          style={{
            marginTop: 8, padding: '4px 10px', fontSize: '0.75rem',
            background: 'transparent', border: '1px solid var(--accent-green, #0ead69)',
            color: 'var(--accent-green, #0ead69)', cursor: 'pointer',
            fontFamily: 'Courier New, monospace', borderRadius: 2,
          }}
        >
          ↩ Reply in Cortex
        </button>
      </div>
    </div>
  );
};

const WavePane = ({ wave, appUrl }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMessages = useCallback(async (before = null) => {
    const url = `${API_URL}/public/portal/${wave.waveId}/messages?limit=50${before ? `&before=${before}` : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    return data;
  }, [wave.waveId]);

  useEffect(() => {
    setLoading(true);
    loadMessages().then(data => {
      const sorted = (data.messages || []).slice().reverse();
      setMessages(sorted);
      setHasMore(data.hasMore || false);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [loadMessages]);

  const loadMore = async () => {
    if (!messages.length) return;
    const oldest = messages[0];
    setLoadingMore(true);
    try {
      const data = await loadMessages(oldest.id);
      const sorted = (data.messages || []).slice().reverse();
      setMessages(prev => [...sorted, ...prev]);
      setHasMore(data.hasMore || false);
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return <div style={{ color: 'var(--accent-green, #0ead69)', padding: 20 }}>Loading...</div>;
  }

  return (
    <div>
      {hasMore && (
        <div style={{ textAlign: 'center', padding: '12px 0' }}>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              padding: '6px 16px', background: 'transparent',
              border: '1px solid var(--border-primary, #1e3a1e)',
              color: 'var(--text-secondary, #7aad7a)', cursor: 'pointer',
              fontFamily: 'Courier New, monospace', fontSize: '0.8rem',
            }}
          >
            {loadingMore ? 'Loading...' : 'Load earlier messages'}
          </button>
        </div>
      )}
      {messages.length === 0 ? (
        <div style={{ color: 'var(--text-muted, #4a7a4a)', padding: '20px 0', textAlign: 'center', fontStyle: 'italic' }}>
          No messages yet.
        </div>
      ) : (
        messages.map(msg => <PortalMessage key={msg.id} msg={msg} waveId={wave.waveId} />)
      )}
      <div style={{ textAlign: 'center', paddingTop: 20, borderTop: '1px solid var(--border-secondary, #1a2a1a)', marginTop: 8 }}>
        <a
          href={`/?wave=${wave.waveId}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block', padding: '10px 24px',
            background: 'var(--accent-green, #0ead69)', color: '#000',
            textDecoration: 'none', fontFamily: 'Courier New, monospace',
            fontWeight: 'bold', fontSize: '0.9rem',
          }}
        >
          Open in Cortex →
        </a>
      </div>
    </div>
  );
};

const PublicPortalView = ({ onLogin }) => {
  const [waves, setWaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeWave, setActiveWave] = useState(preselectedWave || null);
  const { isMobile } = useWindowSize();

  useEffect(() => {
    fetch(`${API_URL}/public/portal`)
      .then(r => r.json())
      .then(data => {
        const list = data.waves || [];
        setWaves(list);
        if (!activeWave && list.length > 0) setActiveWave(list[0].waveId);
      })
      .catch(() => setError('Failed to load portal'))
      .finally(() => setLoading(false));
  }, []);

  const appUrl = `https://${window.location.host}`;
  const currentWave = waves.find(w => w.waveId === activeWave);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-base, #050805)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Courier New, monospace' }}>
        <div style={{ color: 'var(--accent-green, #0ead69)' }}>Loading portal...</div>
      </div>
    );
  }

  if (error || waves.length === 0) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-base, #050805)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Courier New, monospace' }}>
        <div style={{ color: 'var(--text-muted, #4a7a4a)' }}>{error || 'No public waves available.'}</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-base, #050805)',
      color: 'var(--text-primary, #e8f5e8)',
      fontFamily: 'Courier New, monospace',
    }}>
      {!isEmbed && (
        <div style={{
          borderBottom: '1px solid var(--border-primary, #1e3a1e)',
          padding: isMobile ? '12px 16px' : '16px 40px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--bg-elevated, #0a140a)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: 'var(--accent-green, #0ead69)', fontSize: '1.1rem', fontWeight: 'bold' }}>
              ○ CORTEX
            </span>
            <span style={{ color: 'var(--text-muted, #4a7a4a)', fontSize: '0.8rem' }}>
              Public Portal
            </span>
          </div>
          <button
            onClick={onLogin}
            style={{
              padding: '6px 16px', background: 'var(--accent-green, #0ead69)',
              border: 'none', color: '#000', cursor: 'pointer',
              fontFamily: 'Courier New, monospace', fontSize: '0.85rem', fontWeight: 'bold',
            }}
          >
            Sign In
          </button>
        </div>
      )}

      <div style={{ maxWidth: 760, margin: '0 auto', padding: isMobile ? '16px' : '24px 40px' }}>
        {waves.length > 1 && (
          <div style={{
            display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap',
            borderBottom: '1px solid var(--border-secondary, #1a2a1a)', paddingBottom: 0,
          }}>
            {waves.map(w => (
              <button
                key={w.waveId}
                onClick={() => setActiveWave(w.waveId)}
                style={{
                  padding: '8px 16px', background: 'transparent', border: 'none',
                  borderBottom: w.waveId === activeWave ? '2px solid var(--accent-amber, #ffd23f)' : '2px solid transparent',
                  color: w.waveId === activeWave ? 'var(--accent-amber, #ffd23f)' : 'var(--text-secondary, #7aad7a)',
                  cursor: 'pointer', fontFamily: 'Courier New, monospace', fontSize: '0.85rem',
                  marginBottom: -1,
                }}
              >
                {w.title}
              </button>
            ))}
          </div>
        )}

        {currentWave && (
          <>
            {!isEmbed && (
              <h1 style={{ color: 'var(--accent-teal, #00b4d8)', fontSize: '1.1rem', margin: '0 0 4px 0' }}>
                ○ {currentWave.title}
              </h1>
            )}
            {!isEmbed && currentWave.description && (
              <p style={{ color: 'var(--text-secondary, #7aad7a)', fontSize: '0.85rem', margin: '0 0 20px 0' }}>
                {currentWave.description}
              </p>
            )}
            <WavePane wave={currentWave} appUrl={appUrl} />
          </>
        )}
      </div>
    </div>
  );
};

export default PublicPortalView;
