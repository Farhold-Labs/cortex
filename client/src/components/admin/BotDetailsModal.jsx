import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner, GlowText } from '../ui/SimpleComponents.jsx';
import { formatError, CONFIRM_DIALOG } from '../../../messages.js';
import { BASE_URL } from '../../config/constants.js';

const BotDetailsModal = ({ bot, onClose, fetchAPI, showToast, isMobile, onUpdate }) => {
  const [permissions, setPermissions] = useState(bot.permissions || []);
  const [waves, setWaves] = useState([]);
  const [showAddPermissionModal, setShowAddPermissionModal] = useState(false);
  const [selectedWaveId, setSelectedWaveId] = useState('');

  // Load available waves
  useEffect(() => {
    const loadWaves = async () => {
      try {
        const data = await fetchAPI('/waves');
        // data is already an array of waves
        const wavesArray = Array.isArray(data) ? data : [];
        // Filter out waves bot already has access to
        const permittedWaveIds = permissions.map(p => p.wave_id);
        const availableWaves = wavesArray.filter(w => !permittedWaveIds.includes(w.id));
        setWaves(availableWaves);
      } catch (err) {
        console.error('Failed to load waves:', err);
      }
    };
    loadWaves();
  }, [fetchAPI, permissions]);

  const handleGrantPermission = async () => {
    if (!selectedWaveId) {
      showToast('Select a wave', 'error');
      return;
    }

    try {
      // Check if wave is encrypted - if so, we need to handle E2EE key distribution
      const wave = waves.find(w => w.id === selectedWaveId);
      if (wave?.encrypted) {
        showToast('E2EE waves require key distribution - feature coming soon', 'error');
        return;
      }

      await fetchAPI(`/admin/bots/${bot.id}/permissions`, {
        method: 'POST',
        body: {
          waveId: selectedWaveId,
          canPost: true,
          canRead: true,
        },
      });

      showToast('Permission granted', 'success');
      setShowAddPermissionModal(false);
      setSelectedWaveId('');

      // Reload bot details
      const data = await fetchAPI(`/admin/bots/${bot.id}`);
      setPermissions(data.bot.permissions || []);
      onUpdate();
    } catch (err) {
      showToast(err.message || formatError('Failed to grant permission'), 'error');
    }
  };

  const handleRevokePermission = async (waveId, waveTitle) => {
    if (!confirm(CONFIRM_DIALOG.revokeAccess(waveTitle))) return;

    try {
      await fetchAPI(`/admin/bots/${bot.id}/permissions/${waveId}`, { method: 'DELETE' });
      showToast('Permission revoked', 'success');

      // Reload
      const data = await fetchAPI(`/admin/bots/${bot.id}`);
      setPermissions(data.bot.permissions || []);
      onUpdate();
    } catch (err) {
      showToast(err.message || formatError('Failed to revoke permission'), 'error');
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: '700px',
        background: 'linear-gradient(135deg, var(--bg-base), var(--bg-surface))',
        border: '2px solid var(--accent-purple)80', padding: isMobile ? '20px' : '24px',
        maxHeight: '90vh', overflowY: 'auto',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ marginBottom: '20px' }}>
          <GlowText color="var(--accent-purple)" size={isMobile ? '1rem' : '1.1rem'}>{`Bot: ${bot.name}`}</GlowText>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Bot Info */}
        <div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
            INFORMATION
          </div>
          <div style={{ padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ marginBottom: '8px' }}>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>ID: </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                {bot.id}
              </span>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>Owner: </span>
              <span style={{ color: 'var(--text-primary)', fontSize: '0.75rem' }}>
                {bot.owner_name} (@{bot.owner_handle})
              </span>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>Status: </span>
              <span style={{
                fontSize: '0.7rem',
                padding: '2px 6px',
                background: bot.status === 'active' ? 'var(--accent-green)20' : 'var(--text-dim)20',
                color: bot.status === 'active' ? 'var(--accent-green)' : 'var(--text-dim)',
                border: `1px solid ${bot.status === 'active' ? 'var(--accent-green)' : 'var(--text-dim)'}`,
              }}>
                {bot.status.toUpperCase()}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>Stats: </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                {bot.total_pings} pings, {bot.total_api_calls} API calls
              </span>
            </div>
            {bot.last_used_at && (
              <div style={{ marginTop: '8px' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>Last used: </span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  {new Date(bot.last_used_at).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Webhook Info */}
        {bot.webhook_secret && (
          <div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
              WEBHOOK ENDPOINT
            </div>
            <div style={{ padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--accent-purple)40' }}>
              <code style={{
                fontSize: '0.7rem',
                color: 'var(--accent-purple)',
                wordBreak: 'break-all',
              }}>
                POST {BASE_URL}/api/webhooks/{bot.id}/{bot.webhook_secret}
              </code>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '8px' }}>
                Send JSON: {'{'}waveId, content, parentId (optional){'}'}
              </div>
            </div>
          </div>
        )}

        {/* Wave Permissions */}
        <div>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '8px',
          }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
              WAVE PERMISSIONS ({permissions.length})
            </div>
            <button
              onClick={() => setShowAddPermissionModal(true)}
              style={{
                padding: '6px 10px',
                background: 'var(--accent-green)20',
                border: '1px solid var(--accent-green)',
                color: 'var(--accent-green)',
                cursor: 'pointer',
                fontSize: '0.7rem',
              }}
            >
              + ADD WAVE
            </button>
          </div>

          {permissions.length === 0 ? (
            <div style={{
              padding: '20px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.75rem',
            }}>
              Bot has no wave permissions yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {permissions.map(perm => (
                <div
                  key={perm.wave_id}
                  style={{
                    padding: '10px',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ color: 'var(--text-primary)', fontSize: '0.8rem', marginBottom: '4px' }}>
                      {perm.wave_title || 'Unknown Wave'}
                    </div>
                    <div style={{
                      color: 'var(--text-dim)',
                      fontSize: '0.65rem',
                      fontFamily: 'monospace',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginBottom: '4px'
                    }}>
                      <span>ID: {perm.wave_id}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(perm.wave_id);
                          showToast('Wave ID copied!', 'success');
                        }}
                        style={{
                          padding: '2px 4px',
                          background: 'var(--accent-teal)20',
                          border: '1px solid var(--accent-teal)',
                          color: 'var(--accent-teal)',
                          cursor: 'pointer',
                          fontSize: '0.6rem',
                        }}
                      >
                        📋
                      </button>
                    </div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>
                      {perm.can_post ? '✓ Post' : '✗ Post'} • {perm.can_read ? '✓ Read' : '✗ Read'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevokePermission(perm.wave_id, perm.wave_title)}
                    style={{
                      padding: '6px 10px',
                      background: 'transparent',
                      border: '1px solid var(--status-error)',
                      color: 'var(--status-error)',
                      cursor: 'pointer',
                      fontSize: '0.7rem',
                    }}
                  >
                    REVOKE
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          style={{
            padding: '10px 16px',
            background: 'transparent',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          CLOSE
        </button>
      </div>

      {/* Add Permission Modal */}
      {showAddPermissionModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 101, padding: '20px',
        }} onClick={() => {
          setShowAddPermissionModal(false);
          setSelectedWaveId('');
        }}>
          <div style={{
            width: '100%', maxWidth: '450px',
            background: 'linear-gradient(135deg, var(--bg-base), var(--bg-surface))',
            border: '2px solid var(--accent-green)80', padding: isMobile ? '20px' : '24px',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: '20px' }}>
              <GlowText color="var(--accent-green)" size={isMobile ? '1rem' : '1.1rem'}>Grant Wave Access</GlowText>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>
                SELECT WAVE
              </label>
              <select
                value={selectedWaveId}
                onChange={(e) => setSelectedWaveId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              >
                <option value="">-- Choose a wave --</option>
                {waves.map(wave => (
                  <option key={wave.id} value={wave.id}>
                    {wave.title} {wave.encrypted ? '🔒' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowAddPermissionModal(false);
                  setSelectedWaveId('');
                }}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                CANCEL
              </button>
              <button
                onClick={handleGrantPermission}
                style={{
                  padding: '10px 16px',
                  background: 'var(--accent-green)',
                  border: '1px solid var(--accent-green)',
                  color: 'var(--bg-primary)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                GRANT ACCESS
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

// ============ PROFILE SETTINGS ============
export default BotDetailsModal;
