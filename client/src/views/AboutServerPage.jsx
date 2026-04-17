import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VERSION, API_URL, BASE_URL, PRIVACY_LEVELS } from '../config/constants.js';
import { FEDERATION } from '../../messages.js';
import { useWindowSize } from '../hooks/useWindowSize.js';
import { LoadingSpinner, Toast, Avatar, GlowText } from '../components/ui/SimpleComponents.jsx';

const AboutServerPage = ({ onBack }) => {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { isMobile } = useWindowSize();

  useEffect(() => {
    fetch(`${API_URL}/server/info`)
      .then(res => res.json())
      .then(data => {
        setInfo(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const formatUptime = (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const containerStyle = {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, var(--bg-surface), var(--bg-base))',
    padding: isMobile ? '20px' : '40px',
  };

  const cardStyle = {
    maxWidth: '600px',
    margin: '0 auto',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-primary)',
  };

  const sectionStyle = {
    padding: isMobile ? '16px' : '20px',
    borderBottom: '1px solid var(--border-subtle)',
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>
            Loading server info...
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--status-error)' }}>
            Error: {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {/* Header */}
        <div style={{
          ...sectionStyle,
          background: 'var(--bg-elevated)',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: isMobile ? '1.5rem' : '1.8rem',
            color: 'var(--accent-teal)',
            fontFamily: 'monospace',
            marginBottom: '8px',
          }}>
            {info.federationEnabled && <span style={{ marginRight: '10px' }}>◇</span>}
            {info.name || 'Cortex Server'}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            Cortex v{info.version}
            {info.federationEnabled && (
              <span style={{
                marginLeft: '12px',
                padding: '2px 8px',
                background: 'var(--accent-purple)20',
                color: 'var(--accent-purple)',
                fontSize: '0.75rem',
              }}>
                {FEDERATION.verseConnected}
              </span>
            )}
          </div>
          {onBack && (
            <button
              onClick={onBack}
              style={{
                marginTop: '16px',
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
              }}
            >
              ← Back to Login
            </button>
          )}
        </div>

        {/* Stats */}
        <div style={sectionStyle}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '12px' }}>
            Statistics
          </div>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', color: 'var(--text-secondary)' }}>
            <span>Users: <strong style={{ color: 'var(--text-primary)' }}>{info.stats?.users || 0}</strong></span>
            <span>Waves: <strong style={{ color: 'var(--text-primary)' }}>{info.stats?.waves || 0}</strong></span>
            <span>Uptime: <strong style={{ color: 'var(--accent-green)' }}>{formatUptime(info.stats?.uptime || 0)}</strong></span>
          </div>
        </div>

        {/* Federation Partners */}
        {info.federationEnabled && info.federation?.configured && (
          <div style={sectionStyle}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '12px' }}>
              {FEDERATION.alliedPortsLabel(info.federation.partnerCount)}
            </div>
            {info.federation.partners.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {info.federation.partners.map((partner, i) => (
                  <div key={i} style={{
                    padding: '8px 12px',
                    background: 'var(--bg-elevated)',
                    color: 'var(--accent-purple)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}>
                    ◇ {partner}
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {FEDERATION.noAlliedPortsYet}
              </div>
            )}
          </div>
        )}

        {/* Privacy */}
        <div style={sectionStyle}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '12px' }}>
            Privacy
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.6' }}>
            <div style={{ marginBottom: '6px' }}>• Messages are end-to-end encrypted (ECDH P-384 + AES-256-GCM)</div>
            <div style={{ marginBottom: '6px' }}>• Emails hashed + encrypted — never stored in plaintext</div>
            <div style={{ marginBottom: '6px' }}>• IPs anonymized, user-agents truncated, timestamps rounded</div>
            <div style={{ marginBottom: '6px' }}>• Wave participation, crew membership, and push subscriptions encrypted at rest</div>
            <div style={{ marginBottom: '6px' }}>• Contact lists client-encrypted — server can't read them</div>
            <div style={{ marginBottom: '6px' }}>• No analytics, no ads, no third-party tracking</div>
            <div style={{ marginTop: '10px' }}>
              <a
                href="https://github.com/Farhold-Labs/cortex/blob/master/docs/PRIVACY.md"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-teal)', fontSize: '0.8rem' }}
              >
                Read the full privacy policy →
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.75rem',
          borderTop: '1px solid var(--border-subtle)',
        }}>
          Powered by <a href="https://github.com/Farhold-Labs/cortex" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-teal)' }}>Cortex</a>
        </div>
      </div>
    </div>
  );
};

// ============ LOGIN SCREEN ============
export default AboutServerPage;
