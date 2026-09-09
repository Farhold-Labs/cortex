import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GlowText, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { formatError, CONFIRM_DIALOG } from '../../../messages.js';
import { T } from '../../config/terminology.js';

/**
 * PlexConnectionManager (v2.15.0)
 *
 * Settings component for managing Plex server connections.
 * Supports OAuth flow with plex.tv and direct token entry.
 *
 * Props:
 * - fetchAPI: function
 * - showToast: (msg, type) => void
 * - isMobile: boolean
 */
const PlexConnectionManager = ({ fetchAPI, showToast, isMobile }) => {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [testingConnection, setTestingConnection] = useState(null);
  const [deletingConnection, setDeletingConnection] = useState(null);

  // OAuth flow state
  const [oauthState, setOauthState] = useState('idle'); // 'idle', 'waiting', 'selecting', 'complete'
  const [oauthPin, setOauthPin] = useState(null);
  const [oauthToken, setOauthToken] = useState(null);
  const [availableServers, setAvailableServers] = useState([]);
  const pollIntervalRef = useRef(null);

  // Direct token form state
  const [authMode, setAuthMode] = useState('oauth'); // 'oauth' or 'token'
  const [formData, setFormData] = useState({
    serverUrl: '',
    accessToken: '',
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI('/plex/connections');
      setConnections(data.connections || []);
    } catch (err) {
      // Silently fail - feature may not be available yet (server restart needed)
      console.debug('Failed to load Plex connections:', err.message);
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, [fetchAPI]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setFormError('');
  };

  // ---- OAuth Flow ----

  const startOAuthFlow = async () => {
    setOauthState('waiting');
    setFormError('');

    try {
      const data = await fetchAPI('/plex/auth/pin', { method: 'POST' });
      setOauthPin(data);

      // Open auth URL in new window
      const authWindow = window.open(data.authUrl, 'plex_auth', 'width=800,height=600');

      // Start polling for completion
      pollIntervalRef.current = setInterval(async () => {
        try {
          const status = await fetchAPI(`/plex/auth/pin/${data.pinId}`);

          if (status.authenticated) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setOauthToken(status.authToken);

            // Close auth window if still open
            if (authWindow && !authWindow.closed) {
              authWindow.close();
            }

            // Fetch available servers
            await fetchServers(status.authToken);
          }
        } catch (err) {
          console.error('PIN poll error:', err);
        }
      }, 2000);

      // Stop polling after 5 minutes
      setTimeout(() => {
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          if (oauthState === 'waiting') {
            setOauthState('idle');
            setFormError('Authentication timed out. Please try again.');
          }
        }
      }, 300000);

    } catch (err) {
      setOauthState('idle');
      setFormError(err.message || 'Failed to start Plex authentication');
    }
  };

  const fetchServers = async (token) => {
    try {
      const data = await fetchAPI(`/plex/auth/servers?token=${encodeURIComponent(token)}`);
      setAvailableServers(data.servers || []);
      setOauthState('selecting');
    } catch (err) {
      setFormError(err.message || 'Failed to fetch servers');
      setOauthState('idle');
    }
  };

  const selectServer = async (server) => {
    setSubmitting(true);
    try {
      await fetchAPI('/plex/connections', {
        method: 'POST',
        body: {
          serverUrl: server.connection.uri,
          accessToken: server.accessToken,
          serverName: server.name,
          machineIdentifier: server.machineIdentifier,
        },
      });

      showToast(`Connected to ${server.name}`, 'success');
      resetForm();
      loadConnections();
    } catch (err) {
      setFormError(err.message || 'Failed to add server');
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Direct Token Flow ----

  const handleAddConnection = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!formData.serverUrl.trim()) {
      setFormError('Server URL is required');
      return;
    }
    if (!formData.accessToken.trim()) {
      setFormError('Access token is required');
      return;
    }

    // Normalize server URL
    let serverUrl = formData.serverUrl.trim();
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = 'https://' + serverUrl;
    }
    serverUrl = serverUrl.replace(/\/+$/, '');

    setSubmitting(true);
    try {
      await fetchAPI('/plex/connections', {
        method: 'POST',
        body: {
          serverUrl,
          accessToken: formData.accessToken.trim(),
        },
      });

      showToast('Plex connection added', 'success');
      resetForm();
      loadConnections();
    } catch (err) {
      setFormError(err.message || 'Failed to add connection');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setShowAddForm(false);
    setOauthState('idle');
    setOauthPin(null);
    setOauthToken(null);
    setAvailableServers([]);
    setFormData({ serverUrl: '', accessToken: '' });
    setFormError('');
    setAuthMode('oauth');
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const handleTestConnection = async (connectionId) => {
    setTestingConnection(connectionId);
    try {
      const result = await fetchAPI(`/plex/connections/${connectionId}/test`, {
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
      await fetchAPI(`/plex/connections/${connectionId}`, {
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
      background: '#e5a00d', // Plex orange
      borderColor: '#e5a00d',
      color: '#000',
    },
    dangerButton: {
      borderColor: 'var(--accent-orange)',
      color: 'var(--accent-orange)',
    },
    form: {
      marginTop: '16px',
      padding: '16px',
      background: 'var(--bg-surface)',
      border: '1px solid #e5a00d',
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
    serverList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      marginTop: '12px',
    },
    serverItem: {
      padding: '12px',
      background: 'var(--bg-base)',
      border: '1px solid var(--border-subtle)',
      cursor: 'pointer',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    serverInfo: {
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
    },
    serverName: {
      fontWeight: 'bold',
      color: 'var(--text-primary)',
    },
    serverUri: {
      fontSize: '0.75rem',
      color: 'var(--text-muted)',
      fontFamily: 'monospace',
    },
    oauthWaiting: {
      textAlign: 'center',
      padding: '20px',
    },
    oauthCode: {
      fontSize: '1.5rem',
      fontFamily: 'monospace',
      letterSpacing: '0.2em',
      color: '#e5a00d',
      margin: '16px 0',
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
        <GlowText color="#e5a00d" size="0.9rem">
          PLEX CONNECTIONS
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
          <div>No Plex servers connected</div>
          <div style={{ fontSize: '0.8rem', marginTop: '8px' }}>
            Connect a Plex server to share media in {T.waves}
          </div>
        </div>
      ) : (
        <div style={styles.connectionList}>
          {connections.map(conn => (
            <div key={conn.id} style={styles.connectionItem}>
              <div style={styles.connectionHeader}>
                <div>
                  <div style={styles.connectionName}>
                    <span style={{ color: '#e5a00d' }}>▶</span>
                    {conn.serverName || 'Plex Server'}
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
        <div style={styles.form}>
          <GlowText color="#e5a00d" size="0.85rem" style={{ marginBottom: '12px', display: 'block' }}>
            ADD PLEX SERVER
          </GlowText>

          {/* Auth mode toggle */}
          <div style={{ ...styles.formGroup, display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <button
              type="button"
              onClick={() => setAuthMode('oauth')}
              style={{
                ...styles.button,
                flex: 1,
                background: authMode === 'oauth' ? '#e5a00d' : 'transparent',
                color: authMode === 'oauth' ? '#000' : 'var(--text-dim)',
                borderColor: authMode === 'oauth' ? '#e5a00d' : 'var(--border-primary)',
              }}
            >
              SIGN IN WITH PLEX
            </button>
            <button
              type="button"
              onClick={() => setAuthMode('token')}
              style={{
                ...styles.button,
                flex: 1,
                background: authMode === 'token' ? '#e5a00d' : 'transparent',
                color: authMode === 'token' ? '#000' : 'var(--text-dim)',
                borderColor: authMode === 'token' ? '#e5a00d' : 'var(--border-primary)',
              }}
            >
              DIRECT TOKEN
            </button>
          </div>

          {authMode === 'oauth' ? (
            <>
              {oauthState === 'idle' && (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
                    Sign in with your Plex account to automatically discover and connect your servers.
                  </p>
                  <button
                    type="button"
                    style={{ ...styles.button, ...styles.primaryButton }}
                    onClick={startOAuthFlow}
                  >
                    SIGN IN WITH PLEX
                  </button>
                </div>
              )}

              {oauthState === 'waiting' && oauthPin && (
                <div style={styles.oauthWaiting}>
                  <LoadingSpinner />
                  <p style={{ color: 'var(--text-muted)', margin: '16px 0 8px' }}>
                    Waiting for Plex authentication...
                  </p>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                    Complete sign-in in the popup window
                  </p>
                  <div style={styles.oauthCode}>
                    {oauthPin.code}
                  </div>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                    Or enter this code at{' '}
                    <a href="https://plex.tv/link" target="_blank" rel="noopener noreferrer" style={{ color: '#e5a00d' }}>
                      plex.tv/link
                    </a>
                  </p>
                </div>
              )}

              {oauthState === 'selecting' && (
                <div>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '12px' }}>
                    Select a server to connect:
                  </p>
                  <div style={styles.serverList}>
                    {availableServers.length === 0 ? (
                      <div style={{ color: 'var(--text-dim)', padding: '12px', textAlign: 'center' }}>
                        No servers found. Make sure your Plex server is online.
                      </div>
                    ) : (
                      availableServers.map((server, idx) => (
                        <div
                          key={idx}
                          style={styles.serverItem}
                          onClick={() => !submitting && selectServer(server)}
                        >
                          <div style={styles.serverInfo}>
                            <div style={styles.serverName}>{server.name}</div>
                            <div style={styles.serverUri}>
                              {server.connection?.uri}
                              {server.connection?.local && ' (local)'}
                              {server.connection?.relay && ' (relay)'}
                            </div>
                          </div>
                          <button
                            style={{ ...styles.button, ...styles.primaryButton }}
                            onClick={(e) => {
                              e.stopPropagation();
                              selectServer(server);
                            }}
                            disabled={submitting}
                          >
                            {submitting ? '...' : 'SELECT'}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <form onSubmit={handleAddConnection}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Server URL</label>
                <input
                  type="text"
                  style={styles.input}
                  value={formData.serverUrl}
                  onChange={(e) => handleInputChange('serverUrl', e.target.value)}
                  placeholder="https://your-plex-server:32400"
                  autoFocus
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>X-Plex-Token</label>
                <input
                  type="password"
                  style={styles.input}
                  value={formData.accessToken}
                  onChange={(e) => handleInputChange('accessToken', e.target.value)}
                  placeholder="Your Plex token"
                />
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Find your token in Plex Web → any media → Get Info → View XML → X-Plex-Token in URL
                </div>
              </div>

              <div style={styles.formActions}>
                <button
                  type="submit"
                  style={{ ...styles.button, ...styles.primaryButton }}
                  disabled={submitting}
                >
                  {submitting ? 'CONNECTING...' : 'ADD CONNECTION'}
                </button>
              </div>
            </form>
          )}

          {formError && <div style={styles.error}>{formError}</div>}

          <div style={styles.formActions}>
            <button
              type="button"
              style={styles.button}
              onClick={resetForm}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlexConnectionManager;
