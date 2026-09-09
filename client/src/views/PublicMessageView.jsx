import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VERSION, API_URL, BASE_URL, PRIVACY_LEVELS } from '../config/constants.js';
import { useWindowSize } from '../hooks/useWindowSize.js';
import { LoadingSpinner, Toast, Avatar, GlowText } from '../components/ui/SimpleComponents.jsx';
import { T } from '../config/terminology.js';

const PublicMessageView = ({ messageId, onLogin, onRegister }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { isMobile } = useWindowSize();

  useEffect(() => {
    fetch(`${API_URL}/share/${messageId}`)
      .then(res => res.json())
      .then(result => {
        if (result.error) {
          setError(result.error);
        } else {
          setData(result);
        }
      })
      .catch(() => setError('Failed to load shared content'))
      .finally(() => setLoading(false));
  }, [messageId]);

  const containerStyle = {
    minHeight: '100vh',
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    fontFamily: 'Courier New, monospace',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: isMobile ? '20px' : '40px',
  };

  const cardStyle = {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-primary)',
    borderRadius: '4px',
    padding: isMobile ? '20px' : '32px',
    maxWidth: '600px',
    width: '100%',
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ color: 'var(--accent-green)' }}>{LOADING.generic}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h2 style={{ color: 'var(--accent-orange)', margin: '0 0 16px 0' }}>Not Found</h2>
          <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
          <button
            onClick={onLogin}
            style={{
              marginTop: '20px',
              padding: '12px 24px',
              background: 'var(--accent-green)',
              border: 'none',
              color: '#000',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '1rem',
            }}
          >
            LOGIN TO CORTEX
          </button>
        </div>
      </div>
    );
  }

  if (!data.isPublic) {
    return (
      <div style={containerStyle}>
        <div style={cardStyle}>
          <h2 style={{ color: 'var(--accent-amber)', margin: '0 0 16px 0' }}>Private Content</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
            This message is in a private wave.
          </p>
          <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
            Log in or create an account to view it.
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={onLogin}
              style={{
                padding: '12px 24px',
                background: 'var(--accent-green)',
                border: 'none',
                color: '#000',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '1rem',
              }}
            >
              LOGIN
            </button>
            <button
              onClick={onRegister}
              style={{
                padding: '12px 24px',
                background: 'transparent',
                border: '1px solid var(--accent-green)',
                color: 'var(--accent-green)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '1rem',
              }}
            >
              CREATE ACCOUNT
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Public message - show preview
  // Content is already sanitized by the server, render as HTML
  const messageContent = data.message?.content || '';

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        {/* Wave title */}
        <div style={{
          color: 'var(--accent-teal)',
          fontSize: '0.85rem',
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span>○</span>
          <span>{data.wave?.title || `Cortex ${T.Wave}`}</span>
        </div>

        {/* Author and content */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-secondary)',
          borderRadius: '4px',
          padding: '16px',
          marginBottom: '24px',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '12px',
          }}>
            {/* Avatar */}
            {data.author?.avatarUrl ? (
              <img
                src={data.author.avatarUrl}
                alt=""
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: 'var(--accent-teal)30',
                color: 'var(--accent-teal)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
              }}>
                {(data.author?.displayName || '?')[0].toUpperCase()}
              </div>
            )}
            <div>
              <div style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>
                {data.author?.displayName || 'Unknown'}
              </div>
              {data.author?.handle && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  @{data.author.handle}
                </div>
              )}
            </div>
          </div>
          <div
            style={{
              color: 'var(--text-primary)',
              lineHeight: '1.6',
              wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: messageContent || '<em>No content</em>' }}
            className="public-message-content"
          />
          {data.message?.createdAt && (
            <div style={{
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              marginTop: '12px',
            }}>
              {new Date(data.message.createdAt).toLocaleString()}
            </div>
          )}
        </div>

        {/* CTA */}
        <div style={{
          textAlign: 'center',
          borderTop: '1px solid var(--border-secondary)',
          paddingTop: '20px',
        }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Join the conversation on Cortex
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={onLogin}
              style={{
                padding: '12px 24px',
                background: 'var(--accent-green)',
                border: 'none',
                color: '#000',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '1rem',
              }}
            >
              LOGIN
            </button>
            <button
              onClick={onRegister}
              style={{
                padding: '12px 24px',
                background: 'transparent',
                border: '1px solid var(--accent-green)',
                color: 'var(--accent-green)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '1rem',
              }}
            >
              CREATE ACCOUNT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============ AUTH PROVIDER ============
export default PublicMessageView;
