import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { canAccess } from '../../config/constants.js';
import { LOADING, formatError } from '../../../messages.js';

const UserManagementPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle, currentUser }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(null); // 'reset-password' | 'disable-mfa' | 'change-role' | 'disable-account' | 'ban-account' | 'reinstate-account' | 'kick-from-wave' | 'delete-account' | 'reset-encryption' | null
  const [pendingRole, setPendingRole] = useState(null);
  const [moderationReason, setModerationReason] = useState('');
  const [kickWaveId, setKickWaveId] = useState('');

  const searchUsers = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const data = await fetchAPI(`/admin/users/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(data.users || []);
    } catch (err) {
      showToast(formatError('Failed to search users'), 'error');
    } finally {
      setSearching(false);
    }
  };

  const handleResetPassword = async (sendEmail) => {
    if (!selectedUser) return;
    setActionLoading(true);
    try {
      const data = await fetchAPI(`/admin/users/${selectedUser.id}/reset-password`, {
        method: 'POST',
        body: { sendEmail }
      });
      if (data.temporaryPassword) {
        showToast(`Password reset. Temp password: ${data.temporaryPassword}`, 'success', { duration: 15000, dismissible: true });
      } else {
        showToast(data.message || 'Password reset successfully', 'success');
      }
      setShowConfirm(null);
      setSelectedUser(null);
    } catch (err) {
      showToast(err.message || formatError('Failed to reset password'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisableMfa = async () => {
    if (!selectedUser) return;
    setActionLoading(true);
    try {
      await fetchAPI(`/admin/users/${selectedUser.id}/disable-mfa`, { method: 'POST' });
      showToast('MFA disabled for user', 'success');
      setShowConfirm(null);
      setSelectedUser(null);
    } catch (err) {
      showToast(err.message || formatError('Failed to disable MFA'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleChangeRole = async () => {
    if (!selectedUser || !pendingRole) return;
    setActionLoading(true);
    try {
      const data = await fetchAPI(`/admin/users/${selectedUser.id}/role`, {
        method: 'PUT',
        body: { role: pendingRole }
      });
      showToast(`Role changed to ${pendingRole} for @${data.user.handle}`, 'success');
      // Update search results with new role
      setSearchResults(prev => prev.map(u =>
        u.id === selectedUser.id ? { ...u, role: pendingRole, isAdmin: pendingRole === 'admin' } : u
      ));
      setShowConfirm(null);
      setSelectedUser(null);
      setPendingRole(null);
    } catch (err) {
      showToast(err.message || formatError('Failed to change role'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisableAccount = async () => {
    if (!selectedUser || !moderationReason.trim()) return;
    setActionLoading(true);
    try {
      await fetchAPI(`/admin/users/${selectedUser.id}/disable`, {
        method: 'POST',
        body: { reason: moderationReason.trim() }
      });
      showToast(`Account @${selectedUser.handle} disabled`, 'success');
      setSearchResults(prev => prev.map(u =>
        u.id === selectedUser.id ? { ...u, accountStatus: 'disabled', moderationReason: moderationReason.trim() } : u
      ));
      setShowConfirm(null);
      setSelectedUser(null);
      setModerationReason('');
    } catch (err) {
      showToast(err.message || formatError('Failed to disable account'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleBanAccount = async () => {
    if (!selectedUser || !moderationReason.trim()) return;
    setActionLoading(true);
    try {
      await fetchAPI(`/admin/users/${selectedUser.id}/ban`, {
        method: 'POST',
        body: { reason: moderationReason.trim() }
      });
      showToast(`Account @${selectedUser.handle} banned`, 'success');
      setSearchResults(prev => prev.map(u =>
        u.id === selectedUser.id ? { ...u, accountStatus: 'banned', moderationReason: moderationReason.trim() } : u
      ));
      setShowConfirm(null);
      setSelectedUser(null);
      setModerationReason('');
    } catch (err) {
      showToast(err.message || formatError('Failed to ban account'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReinstateAccount = async () => {
    if (!selectedUser) return;
    setActionLoading(true);
    try {
      await fetchAPI(`/admin/users/${selectedUser.id}/reinstate`, { method: 'POST' });
      showToast(`Account @${selectedUser.handle} reinstated`, 'success');
      setSearchResults(prev => prev.map(u =>
        u.id === selectedUser.id ? { ...u, accountStatus: 'active', moderationReason: null } : u
      ));
      setShowConfirm(null);
      setSelectedUser(null);
    } catch (err) {
      showToast(err.message || formatError('Failed to reinstate account'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleKickFromWave = async () => {
    if (!selectedUser || !kickWaveId.trim()) return;
    setActionLoading(true);
    try {
      await fetchAPI(`/admin/users/${selectedUser.id}/kick`, {
        method: 'POST',
        body: { waveId: kickWaveId.trim() }
      });
      showToast(`@${selectedUser.handle} kicked from wave`, 'success');
      setShowConfirm(null);
      setSelectedUser(null);
      setKickWaveId('');
    } catch (err) {
      showToast(err.message || formatError('Failed to kick user'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetEncryption = async () => {
    if (!selectedUser || !moderationReason.trim()) return;
    setActionLoading(true);
    try {
      await fetchAPI(`/admin/users/${selectedUser.id}/reset-encryption`, {
        method: 'POST',
        body: { reason: moderationReason.trim() }
      });
      showToast(`Encryption keys reset for @${selectedUser.handle}`, 'success');
      setShowConfirm(null);
      setSelectedUser(null);
      setModerationReason('');
    } catch (err) {
      showToast(err.message || formatError('Failed to reset encryption keys'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!selectedUser) return;
    setActionLoading(true);
    try {
      await fetchAPI(`/admin/users/${selectedUser.id}/delete`, { method: 'POST' });
      showToast(`Account @${selectedUser.handle} deleted`, 'success');
      setSearchResults(prev => prev.filter(u => u.id !== selectedUser.id));
      setShowConfirm(null);
      setSelectedUser(null);
    } catch (err) {
      showToast(err.message || formatError('Failed to delete account'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Check if current user can assign roles (admin only)
  const canAssignRoles = canAccess(currentUser, 'admin');

  const inputStyle = {
    padding: '8px 12px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-secondary)',
    color: 'var(--text-primary)',
    fontFamily: 'monospace',
    fontSize: '0.85rem',
  };

  const buttonStyle = {
    padding: '8px 16px',
    background: 'transparent',
    border: '1px solid var(--border-primary)',
    color: 'var(--text-dim)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.8rem',
  };

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-purple)40',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ color: 'var(--accent-purple)', fontSize: '0.8rem', fontWeight: 500 }}>USER MANAGEMENT</div>
        <button
          onClick={onToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? 'var(--accent-purple)20' : 'transparent',
            border: `1px solid ${isOpen ? 'var(--accent-purple)' : 'var(--border-primary)'}`,
            color: isOpen ? 'var(--accent-purple)' : 'var(--text-dim)',
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
          {/* Search */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchUsers()}
              placeholder="Search by handle or email..."
              style={{ ...inputStyle, flex: 1, minWidth: '200px' }}
            />
            <button
              onClick={searchUsers}
              disabled={searching || !searchQuery.trim()}
              style={{
                ...buttonStyle,
                border: '1px solid var(--accent-teal)',
                color: 'var(--accent-teal)',
                opacity: searching || !searchQuery.trim() ? 0.5 : 1,
              }}
            >
              {searching ? LOADING.searching : 'SEARCH'}
            </button>
          </div>

          {/* Results */}
          {searchResults.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
                Found {searchResults.length} user(s)
              </div>
              {searchResults.map(u => {
                const userRole = u.role || (u.isAdmin ? 'admin' : 'user');
                const roleColors = {
                  admin: 'var(--accent-amber)',
                  moderator: 'var(--accent-teal)',
                  user: 'var(--text-muted)'
                };
                return (
                  <div
                    key={u.id}
                    onClick={() => setSelectedUser(selectedUser?.id === u.id ? null : u)}
                    style={{
                      padding: '10px 12px',
                      marginBottom: '4px',
                      background: selectedUser?.id === u.id ? 'var(--accent-purple)20' : 'var(--bg-elevated)',
                      border: `1px solid ${selectedUser?.id === u.id ? 'var(--accent-purple)' : 'var(--border-subtle)'}`,
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{u.displayName || u.handle}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>@{u.handle}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {u.accountStatus && u.accountStatus !== 'active' && (
                        <span style={{
                          color: u.accountStatus === 'banned' ? 'var(--accent-orange)' : 'var(--accent-amber)',
                          fontSize: '0.65rem',
                          padding: '2px 5px',
                          border: `1px solid ${u.accountStatus === 'banned' ? 'var(--accent-orange)' : 'var(--accent-amber)'}`,
                          borderRadius: '3px',
                          textTransform: 'uppercase',
                        }}>
                          {u.accountStatus}
                        </span>
                      )}
                      <span style={{
                        color: roleColors[userRole],
                        fontSize: '0.7rem',
                        padding: '2px 6px',
                        border: `1px solid ${roleColors[userRole]}`,
                        borderRadius: '3px',
                        textTransform: 'uppercase'
                      }}>
                        {userRole}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Actions for selected user */}
          {selectedUser && !showConfirm && (
            <div style={{ padding: '12px', background: 'var(--bg-hover)', border: '1px solid var(--border-secondary)' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '12px' }}>
                Actions for <strong style={{ color: 'var(--text-primary)' }}>@{selectedUser.handle}</strong>
                {selectedUser.role && (
                  <span style={{ marginLeft: '8px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    (role: {selectedUser.role || (selectedUser.isAdmin ? 'admin' : 'user')})
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setShowConfirm('reset-password')}
                  style={{ ...buttonStyle, border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)' }}
                >
                  RESET PASSWORD
                </button>
                <button
                  onClick={() => setShowConfirm('disable-mfa')}
                  style={{ ...buttonStyle, border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)' }}
                >
                  DISABLE MFA
                </button>
                {canAssignRoles && selectedUser.id !== currentUser?.id && (
                  <button
                    onClick={() => setShowConfirm('change-role')}
                    style={{ ...buttonStyle, border: '1px solid var(--accent-purple)', color: 'var(--accent-purple)' }}
                  >
                    CHANGE ROLE
                  </button>
                )}
                {selectedUser.id !== currentUser?.id && (!selectedUser.accountStatus || selectedUser.accountStatus === 'active') && (
                  <button
                    onClick={() => { setShowConfirm('disable-account'); setModerationReason(''); }}
                    style={{ ...buttonStyle, border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)' }}
                  >
                    DISABLE
                  </button>
                )}
                {canAssignRoles && selectedUser.id !== currentUser?.id && (!selectedUser.accountStatus || selectedUser.accountStatus === 'active') && (
                  <button
                    onClick={() => { setShowConfirm('ban-account'); setModerationReason(''); }}
                    style={{ ...buttonStyle, border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)' }}
                  >
                    BAN
                  </button>
                )}
                {canAssignRoles && selectedUser.accountStatus && selectedUser.accountStatus !== 'active' && (
                  <button
                    onClick={() => setShowConfirm('reinstate-account')}
                    style={{ ...buttonStyle, border: '1px solid var(--accent-green)', color: 'var(--accent-green)' }}
                  >
                    REINSTATE
                  </button>
                )}
                {selectedUser.id !== currentUser?.id && (
                  <button
                    onClick={() => { setShowConfirm('kick-from-wave'); setKickWaveId(''); }}
                    style={{ ...buttonStyle, border: '1px solid var(--accent-teal)', color: 'var(--accent-teal)' }}
                  >
                    KICK FROM WAVE
                  </button>
                )}
                {canAssignRoles && selectedUser.id !== currentUser?.id && (
                  <button
                    onClick={() => { setShowConfirm('reset-encryption'); setModerationReason(''); }}
                    style={{ ...buttonStyle, border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)' }}
                  >
                    RESET E2EE
                  </button>
                )}
                {canAssignRoles && selectedUser.id !== currentUser?.id && (
                  <button
                    onClick={() => setShowConfirm('delete-account')}
                    style={{ ...buttonStyle, border: '1px solid #ff4444', color: '#ff4444' }}
                  >
                    DELETE ACCOUNT
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Confirmation dialogs */}
          {showConfirm === 'reset-password' && (
            <div style={{ padding: '16px', background: 'var(--accent-amber)10', border: '1px solid var(--accent-amber)40' }}>
              <div style={{ color: 'var(--accent-amber)', marginBottom: '12px', fontSize: '0.85rem' }}>
                Reset password for @{selectedUser.handle}?
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                User will be required to change password on next login.
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleResetPassword(true)}
                  disabled={actionLoading}
                  style={{ ...buttonStyle, border: '1px solid var(--accent-green)', color: 'var(--accent-green)' }}
                >
                  {actionLoading ? '...' : 'RESET & EMAIL USER'}
                </button>
                <button
                  onClick={() => handleResetPassword(false)}
                  disabled={actionLoading}
                  style={{ ...buttonStyle, border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)' }}
                >
                  {actionLoading ? '...' : 'RESET (SHOW PASSWORD)'}
                </button>
                <button
                  onClick={() => setShowConfirm(null)}
                  disabled={actionLoading}
                  style={buttonStyle}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {showConfirm === 'disable-mfa' && (
            <div style={{ padding: '16px', background: 'var(--accent-orange)10', border: '1px solid var(--accent-orange)40' }}>
              <div style={{ color: 'var(--accent-orange)', marginBottom: '12px', fontSize: '0.85rem' }}>
                Disable all MFA for @{selectedUser.handle}?
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                This will disable TOTP, email MFA, and remove all recovery codes.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleDisableMfa}
                  disabled={actionLoading}
                  style={{ ...buttonStyle, border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)' }}
                >
                  {actionLoading ? '...' : 'DISABLE MFA'}
                </button>
                <button
                  onClick={() => setShowConfirm(null)}
                  disabled={actionLoading}
                  style={buttonStyle}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {showConfirm === 'change-role' && (
            <div style={{ padding: '16px', background: 'var(--accent-purple)10', border: '1px solid var(--accent-purple)40' }}>
              <div style={{ color: 'var(--accent-purple)', marginBottom: '12px', fontSize: '0.85rem' }}>
                Change role for @{selectedUser.handle}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                Current role: <strong>{selectedUser.role || (selectedUser.isAdmin ? 'admin' : 'user')}</strong>
              </div>
              <div style={{ marginBottom: '12px' }}>
                <select
                  value={pendingRole || ''}
                  onChange={(e) => setPendingRole(e.target.value)}
                  style={{
                    ...inputStyle,
                    width: '100%',
                    cursor: 'pointer',
                    background: 'var(--bg-elevated)',
                  }}
                >
                  <option value="">Select new role...</option>
                  <option value="user">User - Regular user</option>
                  <option value="moderator">Moderator - Reports, warnings, user management</option>
                  <option value="admin">Admin - Full access</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={handleChangeRole}
                  disabled={actionLoading || !pendingRole}
                  style={{
                    ...buttonStyle,
                    border: '1px solid var(--accent-purple)',
                    color: 'var(--accent-purple)',
                    opacity: !pendingRole ? 0.5 : 1
                  }}
                >
                  {actionLoading ? '...' : 'CONFIRM CHANGE'}
                </button>
                <button
                  onClick={() => { setShowConfirm(null); setPendingRole(null); }}
                  disabled={actionLoading}
                  style={buttonStyle}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {showConfirm === 'disable-account' && (
            <div style={{ padding: '16px', background: 'var(--accent-amber)10', border: '1px solid var(--accent-amber)40' }}>
              <div style={{ color: 'var(--accent-amber)', marginBottom: '12px', fontSize: '0.85rem' }}>
                Disable account @{selectedUser.handle}?
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                User will be logged out and unable to sign in. They can submit an appeal.
              </div>
              <textarea
                value={moderationReason}
                onChange={(e) => setModerationReason(e.target.value)}
                placeholder="Reason for disabling (required)"
                rows={2}
                style={{ ...inputStyle, width: '100%', marginBottom: '12px', resize: 'vertical', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleDisableAccount} disabled={actionLoading || !moderationReason.trim()}
                  style={{ ...buttonStyle, border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)', opacity: !moderationReason.trim() ? 0.5 : 1 }}>
                  {actionLoading ? '...' : 'DISABLE ACCOUNT'}
                </button>
                <button onClick={() => { setShowConfirm(null); setModerationReason(''); }} disabled={actionLoading} style={buttonStyle}>CANCEL</button>
              </div>
            </div>
          )}

          {showConfirm === 'ban-account' && (
            <div style={{ padding: '16px', background: 'var(--accent-orange)10', border: '1px solid var(--accent-orange)40' }}>
              <div style={{ color: 'var(--accent-orange)', marginBottom: '12px', fontSize: '0.85rem' }}>
                Ban account @{selectedUser.handle}?
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                This is a severe action. User will be logged out and unable to sign in.
              </div>
              <textarea
                value={moderationReason}
                onChange={(e) => setModerationReason(e.target.value)}
                placeholder="Reason for banning (required)"
                rows={2}
                style={{ ...inputStyle, width: '100%', marginBottom: '12px', resize: 'vertical', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleBanAccount} disabled={actionLoading || !moderationReason.trim()}
                  style={{ ...buttonStyle, border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)', opacity: !moderationReason.trim() ? 0.5 : 1 }}>
                  {actionLoading ? '...' : 'BAN ACCOUNT'}
                </button>
                <button onClick={() => { setShowConfirm(null); setModerationReason(''); }} disabled={actionLoading} style={buttonStyle}>CANCEL</button>
              </div>
            </div>
          )}

          {showConfirm === 'reinstate-account' && (
            <div style={{ padding: '16px', background: 'var(--accent-green)10', border: '1px solid var(--accent-green)40' }}>
              <div style={{ color: 'var(--accent-green)', marginBottom: '12px', fontSize: '0.85rem' }}>
                Reinstate account @{selectedUser.handle}?
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                Currently <strong>{selectedUser.accountStatus}</strong>: {selectedUser.moderationReason || 'No reason recorded'}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleReinstateAccount} disabled={actionLoading}
                  style={{ ...buttonStyle, border: '1px solid var(--accent-green)', color: 'var(--accent-green)' }}>
                  {actionLoading ? '...' : 'REINSTATE'}
                </button>
                <button onClick={() => setShowConfirm(null)} disabled={actionLoading} style={buttonStyle}>CANCEL</button>
              </div>
            </div>
          )}

          {showConfirm === 'kick-from-wave' && (
            <div style={{ padding: '16px', background: 'var(--accent-teal)10', border: '1px solid var(--accent-teal)40' }}>
              <div style={{ color: 'var(--accent-teal)', marginBottom: '12px', fontSize: '0.85rem' }}>
                Kick @{selectedUser.handle} from a wave
              </div>
              <input
                value={kickWaveId}
                onChange={(e) => setKickWaveId(e.target.value)}
                placeholder="Wave ID (e.g., thread-abc123...)"
                style={{ ...inputStyle, width: '100%', marginBottom: '12px', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleKickFromWave} disabled={actionLoading || !kickWaveId.trim()}
                  style={{ ...buttonStyle, border: '1px solid var(--accent-teal)', color: 'var(--accent-teal)', opacity: !kickWaveId.trim() ? 0.5 : 1 }}>
                  {actionLoading ? '...' : 'KICK'}
                </button>
                <button onClick={() => { setShowConfirm(null); setKickWaveId(''); }} disabled={actionLoading} style={buttonStyle}>CANCEL</button>
              </div>
            </div>
          )}

          {showConfirm === 'reset-encryption' && (
            <div style={{ padding: '16px', background: 'var(--accent-orange)10', border: '1px solid var(--accent-orange)40' }}>
              <div style={{ color: 'var(--accent-orange)', marginBottom: '12px', fontSize: '0.85rem' }}>
                Reset encryption keys for @{selectedUser.handle}?
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                This will wipe all encryption keys for this user. They will lose access to previously encrypted messages and must set up encryption again.
              </div>
              <textarea
                value={moderationReason}
                onChange={(e) => setModerationReason(e.target.value)}
                placeholder="Reason for resetting encryption (required)"
                rows={2}
                style={{ ...inputStyle, width: '100%', marginBottom: '12px', resize: 'vertical', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleResetEncryption} disabled={actionLoading || !moderationReason.trim()}
                  style={{ ...buttonStyle, border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)', opacity: !moderationReason.trim() ? 0.5 : 1 }}>
                  {actionLoading ? '...' : 'RESET E2EE KEYS'}
                </button>
                <button onClick={() => { setShowConfirm(null); setModerationReason(''); }} disabled={actionLoading} style={buttonStyle}>CANCEL</button>
              </div>
            </div>
          )}

          {showConfirm === 'delete-account' && (
            <div style={{ padding: '16px', background: '#ff444415', border: '1px solid #ff444440' }}>
              <div style={{ color: '#ff4444', marginBottom: '12px', fontSize: '0.85rem' }}>
                Permanently delete account @{selectedUser.handle}?
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '12px' }}>
                This action is <strong>irreversible</strong>. All user data will be removed.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleDeleteAccount} disabled={actionLoading}
                  style={{ ...buttonStyle, border: '1px solid #ff4444', color: '#ff4444' }}>
                  {actionLoading ? '...' : 'DELETE PERMANENTLY'}
                </button>
                <button onClick={() => setShowConfirm(null)} disabled={actionLoading} style={buttonStyle}>CANCEL</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============ ACTIVITY LOG ADMIN PANEL ============
export default UserManagementPanel;
