import React, { useState, useEffect, useCallback } from 'react';
import { GlowText, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { formatError, CONFIRM_DIALOG } from '../../../messages.js';
import { T } from '../../config/terminology.js';

/**
 * JellyfinConnectionManager (v2.14.0)
 *
 * Settings component for managing Jellyfin server connections.
 *
 * Props:
 * - fetchAPI: function
 * - showToast: (msg, type) => void
 * - isMobile: boolean
 */
const JellyfinConnectionManager = ({ fetchAPI, showToast, isMobile }) => {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [testingConnection, setTestingConnection] = useState(null);
  const [deletingConnection, setDeletingConnection] = useState(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    serverUrl: '',
    username: '',
    password: '',
    apiKey: '',
  });
  const [authMode, setAuthMode] = useState('apiKey'); // 'apiKey' or 'credentials'
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI('/jellyfin/connections');
      setConnections(data.connections || []);
    } catch (err) {
      console.error('Failed to load Jellyfin connections:', err);
      showToast(formatError('Failed to load Jellyfin connections'), 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setFormError('');
  };

  const handleAddConnection = async (e) => {
    e.preventDefault();
    setFormError('');

    // Validation
    if (!formData.serverUrl.trim()) {
      setFormError('Server URL is required');
      return;
    }

    if (authMode === 'apiKey') {
      if (!formData.apiKey.trim()) {
        setFormError('API key is required');
        return;
      }
    } else {
      if (!formData.username.trim()) {
        setFormError('Username is required');
        return;
      }
      if (!formData.password.trim()) {
        setFormError('Password is required');
        return;
      }
    }

    // Normalize server URL
    let serverUrl = formData.serverUrl.trim();
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = 'https://' + serverUrl;
    }
    // Remove trailing slash
    serverUrl = serverUrl.replace(/\/+$/, '');

    setSubmitting(true);
    try {
      const body = {
        name: formData.name.trim() || serverUrl,
        serverUrl,
      };

      if (authMode === 'apiKey') {
        body.apiKey = formData.apiKey.trim();
      } else {
        body.username = formData.username.trim();
        body.password = formData.password;
      }

      await fetchAPI('/jellyfin/connections', {
        method: 'POST',
        body,
      });

      showToast('Jellyfin connection added', 'success');
      setShowAddForm(false);
      setFormData({ name: '', serverUrl: '', username: '', password: '', apiKey: '' });
      loadConnections();
    } catch (err) {
      setFormError(err.message || 'Failed to add connection');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestConnection = async (connectionId) => {
    setTestingConnection(connectionId);
    try {
      const result = await fetchAPI(`/jellyfin/connections/${connectionId}/test`, {
        method: 'POST',
      });
      if (result.success) {
        showToast('Connection successful!', 'success');
      } else {
        showToast(formatError(result.error || 'Connection failed'), 'error');
      }
    } catch (err) {
      showToast(err.message || formatError('Connection test failed'), 'error');
    } finally {
      setTestingConnection(null);
    }
  };

  const handleDeleteConnection = async (connectionId) => {
    if (!confirm(CONFIRM_DIALOG.removeConnection)) {
      return;
    }

    setDeletingConnection(connectionId);
    try {
      await fetchAPI(`/jellyfin/connections/${connectionId}`, {
        method: 'DELETE',
      });
      showToast('Connection removed', 'success');
      loadConnections();
    } catch (err) {
      showToast(err.message || formatError('Failed to remove connection'), 'error');
    } finally {
      setDeletingConnection(null);
    }
  };

  const handleSetDefault = async (connectionId) => {
    try {
      await fetchAPI(`/jellyfin/connections/${connectionId}/default`, {
        method: 'POST',
      });
      showToast('Default connection updated', 'success');
      loadConnections();
    } catch (err) {
      showToast(err.message || formatError('Failed to set default'), 'error');
    }
  };

  const styles = {
    container: {
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border-subtle)',
      padding: isMobile ? '16px' : '20px',
      marginBottom: '16px',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '16px',
    },
    connectionList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
    },
    connectionItem: {
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      padding: '12px',
    },
    connectionHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: '8px',
    },
    connectionName: {
      fontWeight: 'bold',
      color: 'var(--text-primary)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    defaultBadge: {
      fontSize: '0.65rem',
      padding: '2px 6px',
      background: 'var(--accent-color)',
      color: 'var(--bg-color)',
      fontWeight: 'bold',
    },
    connectionUrl: {
      fontSize: '0.8rem',
      color: 'var(--text-muted)',
      fontFamily: 'monospace',
    },
    connectionActions: {
      display: 'flex',
      gap: '8px',
      marginTop: '8px',
      flexWrap: 'wrap',
    },
    button: {
      padding: isMobile ? '8px 12px' : '6px 10px',
      minHeight: isMobile ? '44px' : 'auto',
      background: 'transparent',
      border: '1px solid var(--border-primary)',
      color: 'var(--text-dim)',
      cursor: 'pointer',
      fontFamily: 'monospace',
      fontSize: '0.75rem',
    },
    primaryButton: {
      background: 'var(--accent-color)',
      borderColor: 'var(--accent-color)',
      color: 'var(--bg-color)',
    },
    dangerButton: {
      borderColor: 'var(--accent-orange)',
      color: 'var(--accent-orange)',
    },
    form: {
      marginTop: '16px',
      padding: '16px',
      background: 'var(--bg-surface)',
      border: '1px solid var(--accent-color)',
    },
    formGroup: {
      marginBottom: '12px',
    },
    label: {
      display: 'block',
      fontSize: '0.75rem',
      color: 'var(--text-muted)',
      marginBottom: '4px',
      fontFamily: 'monospace',
    },
    input: {
      width: '100%',
      padding: isMobile ? '12px' : '8px',
      background: 'var(--bg-base)',
      border: '1px solid var(--border-primary)',
      color: 'var(--text-primary)',
      fontFamily: 'monospace',
      fontSize: '0.9rem',
      boxSizing: 'border-box',
    },
    error: {
      color: 'var(--accent-orange)',
      fontSize: '0.8rem',
      marginTop: '8px',
    },
    formActions: {
      display: 'flex',
      gap: '8px',
      marginTop: '16px',
    },
    emptyState: {
      textAlign: 'center',
      padding: '24px',
      color: 'var(--text-muted)',
    },
    emptyIcon: {
      fontSize: '32px',
      marginBottom: '12px',
    },
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <GlowText color="var(--accent-color)" size="0.9rem">
          JELLYFIN CONNECTIONS
        </GlowText>
        {!showAddForm && (
          <button
            style={{ ...styles.button, ...styles.primaryButton }}
            onClick={() => setShowAddForm(true)}
          >
            + ADD SERVER
          </button>
        )}
      </div>

      {connections.length === 0 && !showAddForm ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📺</div>
          <div>No Jellyfin servers connected</div>
          <div style={{ fontSize: '0.8rem', marginTop: '8px' }}>
            Connect a Jellyfin server to share media in {T.waves}
          </div>
        </div>
      ) : (
        <div style={styles.connectionList}>
          {connections.map(conn => (
            <div key={conn.id} style={styles.connectionItem}>
              <div style={styles.connectionHeader}>
                <div>
                  <div style={styles.connectionName}>
                    {conn.name}
                    {conn.isDefault && (
                      <span style={styles.defaultBadge}>DEFAULT</span>
                    )}
                  </div>
                  <div style={styles.connectionUrl}>{conn.serverUrl}</div>
                </div>
              </div>
              <div style={styles.connectionActions}>
                <button
                  style={styles.button}
                  onClick={() => handleTestConnection(conn.id)}
                  disabled={testingConnection === conn.id}
                >
                  {testingConnection === conn.id ? 'TESTING...' : 'TEST'}
                </button>
                {!conn.isDefault && (
                  <button
                    style={styles.button}
                    onClick={() => handleSetDefault(conn.id)}
                  >
                    SET DEFAULT
                  </button>
                )}
                <button
                  style={{ ...styles.button, ...styles.dangerButton }}
                  onClick={() => handleDeleteConnection(conn.id)}
                  disabled={deletingConnection === conn.id}
                >
                  {deletingConnection === conn.id ? 'REMOVING...' : 'REMOVE'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddForm && (
        <form style={styles.form} onSubmit={handleAddConnection}>
          <GlowText color="var(--accent-color)" size="0.85rem" style={{ marginBottom: '12px', display: 'block' }}>
            ADD JELLYFIN SERVER
          </GlowText>

          <div style={styles.formGroup}>
            <label style={styles.label}>Server URL</label>
            <input
              type="text"
              style={styles.input}
              value={formData.serverUrl}
              onChange={(e) => handleInputChange('serverUrl', e.target.value)}
              placeholder="https://jellyfin.example.com"
              autoFocus
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>Connection Name (optional)</label>
            <input
              type="text"
              style={styles.input}
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              placeholder="Home Server"
            />
          </div>

          {/* Auth mode toggle */}
          <div style={{ ...styles.formGroup, display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={() => setAuthMode('apiKey')}
              style={{
                ...styles.button,
                flex: 1,
                background: authMode === 'apiKey' ? 'var(--accent-color)' : 'transparent',
                color: authMode === 'apiKey' ? 'var(--bg-color)' : 'var(--text-dim)',
                borderColor: authMode === 'apiKey' ? 'var(--accent-color)' : 'var(--border-primary)',
              }}
            >
              API KEY
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('credentials')}
              style={{
                ...styles.button,
                flex: 1,
                background: authMode === 'credentials' ? 'var(--accent-color)' : 'transparent',
                color: authMode === 'credentials' ? 'var(--bg-color)' : 'var(--text-dim)',
                borderColor: authMode === 'credentials' ? 'var(--accent-color)' : 'var(--border-primary)',
              }}
            >
              LOGIN
            </button>
          </div>

          {authMode === 'apiKey' ? (
            <div style={styles.formGroup}>
              <label style={styles.label}>API Key</label>
              <input
                type="password"
                style={styles.input}
                value={formData.apiKey}
                onChange={(e) => handleInputChange('apiKey', e.target.value)}
                placeholder="Your Jellyfin API key"
              />
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Create in Jellyfin Dashboard → API Keys
              </div>
            </div>
          ) : (
            <>
              <div style={styles.formGroup}>
                <label style={styles.label}>Username</label>
                <input
                  type="text"
                  style={styles.input}
                  value={formData.username}
                  onChange={(e) => handleInputChange('username', e.target.value)}
                  placeholder="your-username"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Password</label>
                <input
                  type="password"
                  style={styles.input}
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  placeholder="your-password"
                />
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Used once to get access token, not stored
                </div>
              </div>
            </>
          )}

          {formError && <div style={styles.error}>{formError}</div>}

          <div style={styles.formActions}>
            <button
              type="submit"
              style={{ ...styles.button, ...styles.primaryButton }}
              disabled={submitting}
            >
              {submitting ? 'CONNECTING...' : 'ADD CONNECTION'}
            </button>
            <button
              type="button"
              style={styles.button}
              onClick={() => {
                setShowAddForm(false);
                setFormData({ name: '', serverUrl: '', username: '', password: '', apiKey: '' });
                setAuthMode('apiKey');
                setFormError('');
              }}
            >
              CANCEL
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default JellyfinConnectionManager;
