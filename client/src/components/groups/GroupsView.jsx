import React, { useState, useEffect, useCallback } from 'react';
import { useWindowSize } from '../../hooks/useWindowSize.js';
import { SUCCESS, EMPTY, CONFIRM_DIALOG, FEDERATION, formatError } from '../../../messages.js';
import { Avatar, GlowText, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { BASE_URL } from '../../config/constants.js';
import GroupInvitationsPanel from './GroupInvitationsPanel.jsx';
import InviteToGroupModal from './InviteToGroupModal.jsx';

const GroupsView = ({ groups, fetchAPI, showToast, onGroupsChange, groupInvitations, onInvitationsChange, contacts }) => {
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupDetails, setGroupDetails] = useState(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [sentInvitations, setSentInvitations] = useState([]);
  const { width, isMobile, isTablet, isDesktop } = useWindowSize();

  useEffect(() => {
    if (selectedGroup) {
      fetchAPI(`/groups/${selectedGroup}`)
        .then(setGroupDetails)
        .catch(() => showToast(formatError('Failed to load crew'), 'error'));
    }
  }, [selectedGroup, fetchAPI, showToast]);

  useEffect(() => {
    if (memberSearch.length < 2) { setSearchResults([]); return; }
    const timeout = setTimeout(async () => {
      try {
        const results = await fetchAPI(`/users/search?q=${encodeURIComponent(memberSearch)}`);
        const memberIds = groupDetails?.members?.map(m => m.id) || [];
        setSearchResults(results.filter(r => !memberIds.includes(r.id)));
      } catch (err) { console.error(err); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [memberSearch, fetchAPI, groupDetails]);

  const loadSentInvitations = useCallback(async () => {
    try {
      const data = await fetchAPI('/crews/invitations/sent');
      setSentInvitations(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Failed to load sent invitations:', e); }
  }, [fetchAPI]);

  useEffect(() => { loadSentInvitations(); }, [loadSentInvitations]);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await fetchAPI('/groups', { method: 'POST', body: { name: newGroupName, description: newGroupDesc } });
      showToast(SUCCESS.crewCreated, 'success');
      setNewGroupName('');
      setNewGroupDesc('');
      setShowNewGroup(false);
      onGroupsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to create crew'), 'error');
    }
  };

  const handleDeleteGroup = async () => {
    if (!confirm(CONFIRM_DIALOG.deleteCrew)) return;
    try {
      await fetchAPI(`/groups/${selectedGroup}`, { method: 'DELETE' });
      showToast(SUCCESS.crewDeleted, 'success');
      setSelectedGroup(null);
      setGroupDetails(null);
      onGroupsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to delete crew'), 'error');
    }
  };

  const handleAddMember = async (userId) => {
    try {
      // Use invitation flow instead of direct add - users should consent to joining
      const result = await fetchAPI(`/groups/${selectedGroup}/invite`, {
        method: 'POST',
        body: { userIds: [userId] }
      });
      if (result.invitations?.length > 0) {
        showToast(SUCCESS.invitationSent, 'success');
      } else if (result.errors?.length > 0) {
        showToast(result.errors[0].error || formatError('Failed to send invitation'), 'error');
      }
      setMemberSearch('');
      setSearchResults([]);
    } catch (err) {
      showToast(err.message || formatError('Failed to send invitation'), 'error');
    }
  };

  const handleLeaveGroup = async () => {
    if (!confirm(CONFIRM_DIALOG.leaveCrew)) return;
    try {
      await fetchAPI(`/groups/${selectedGroup}/members/${groupDetails.currentUserId}`, { method: 'DELETE' });
      showToast(SUCCESS.left, 'success');
      setSelectedGroup(null);
      setGroupDetails(null);
      onGroupsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to leave crew'), 'error');
    }
  };

  const handleRemoveMember = async (userId) => {
    try {
      await fetchAPI(`/groups/${selectedGroup}/members/${userId}`, { method: 'DELETE' });
      showToast('Member removed', 'success');
      const updated = await fetchAPI(`/groups/${selectedGroup}`);
      setGroupDetails(updated);
      onGroupsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to remove member'), 'error');
    }
  };

  const handleToggleAdmin = async (userId, currentRole) => {
    try {
      await fetchAPI(`/groups/${selectedGroup}/members/${userId}`, {
        method: 'PUT', body: { role: currentRole === 'admin' ? 'member' : 'admin' },
      });
      const updated = await fetchAPI(`/groups/${selectedGroup}`);
      setGroupDetails(updated);
    } catch (err) {
      showToast(err.message || formatError('Failed to update role'), 'error');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100%' }}>
      {/* Group list */}
      {(!isMobile || !selectedGroup) && <div style={{
        width: isMobile ? '100%' : '300px',
        borderRight: isMobile ? 'none' : '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column',
        flex: isMobile ? 1 : undefined,
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-subtle)' }}>
          <button onClick={() => setShowNewGroup(true)} style={{
            width: '100%', padding: '10px', background: 'var(--accent-amber)15', border: '1px solid var(--accent-amber)50',
            color: 'var(--accent-amber)', cursor: 'pointer', fontFamily: 'monospace',
          }}>+ NEW CREW</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: groupInvitations?.length > 0 ? '12px' : '0' }}>
          {/* Group Invitations */}
          <GroupInvitationsPanel
            invitations={groupInvitations || []}
            fetchAPI={fetchAPI}
            showToast={showToast}
            onInvitationsChange={onInvitationsChange}
            onGroupsChange={onGroupsChange}
            isMobile={isMobile}
          />
          {groups.length === 0 && (!groupInvitations || groupInvitations.length === 0) ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>{EMPTY.noCrews}</div>
          ) : groups.map(g => (
            <div key={g.id} onClick={() => setSelectedGroup(g.id)} style={{ padding: '14px 16px', cursor: 'pointer',
              background: selectedGroup === g.id ? 'var(--accent-amber)10' : 'transparent',
              borderBottom: '1px solid var(--bg-hover)',
              borderLeft: `3px solid ${selectedGroup === g.id ? 'var(--accent-amber)' : 'transparent'}`,
            }}>
              <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{g.name}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{g.memberCount} members • {g.role}</div>
            </div>
          ))}
        </div>
      </div>}

      {/* Crew details */}
      {(!isMobile || selectedGroup) && <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {!selectedGroup ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--border-primary)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>◈</div>
              <div>Select a crew or create a new one</div>
            </div>
          </div>
        ) : !groupDetails ? (
          <LoadingSpinner />
        ) : (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {isMobile && (
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
                <button onClick={() => setSelectedGroup(null)} style={{
                  background: 'none', border: 'none', color: 'var(--accent-amber)',
                  cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.85rem', padding: 0,
                }}>← Crews</button>
              </div>
            )}
            <div style={{
              padding: '20px', borderBottom: '1px solid var(--border-subtle)',
              background: 'linear-gradient(90deg, var(--bg-surface), var(--bg-hover), var(--bg-surface))',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ color: 'var(--text-primary)', fontSize: '1.2rem', marginBottom: '4px' }}>{groupDetails.name}</div>
                  {groupDetails.description && (
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{groupDetails.description}</div>
                  )}
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '8px' }}>
                    {groupDetails.members?.length} members
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={() => setShowInviteModal(true)} style={{
                    padding: '6px 12px', background: 'var(--accent-teal)15', border: '1px solid var(--accent-teal)',
                    color: 'var(--accent-teal)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem',
                  }}>+ INVITE</button>
                  <button onClick={handleLeaveGroup} style={{
                    padding: '6px 12px', background: 'var(--accent-amber)15', border: '1px solid var(--accent-amber)50',
                    color: 'var(--accent-amber)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem',
                  }}>LEAVE CREW</button>
                  {groupDetails.isAdmin && (
                    <button onClick={handleDeleteGroup} style={{
                      padding: '6px 12px', background: 'var(--accent-orange)20', border: '1px solid var(--accent-orange)',
                      color: 'var(--accent-orange)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem',
                    }}>DELETE CREW</button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ padding: '20px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                <GlowText color="var(--accent-amber)" size="0.9rem">MEMBERS</GlowText>
                {groupDetails.isAdmin && (
                  <button onClick={() => setShowAddMember(!showAddMember)} style={{
                    padding: '6px 12px', background: showAddMember ? 'var(--accent-teal)20' : 'transparent',
                    border: `1px solid ${showAddMember ? 'var(--accent-teal)' : 'var(--border-primary)'}`,
                    color: showAddMember ? 'var(--accent-teal)' : 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem',
                  }}>{showAddMember ? '✕ CLOSE' : '+ INVITE MEMBER'}</button>
                )}
              </div>

              {showAddMember && (
                <div style={{ marginBottom: '16px', padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--accent-teal)40' }}>
                  <input type="text" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="Search users..."
                    style={{
                      width: '100%', padding: '10px', boxSizing: 'border-box', marginBottom: '8px',
                      background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: 'inherit',
                    }} />
                  {searchResults.map(user => (
                    <div key={user.id} style={{
                      padding: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: 'var(--bg-surface)', marginBottom: '4px',
                    }}>
                      <span style={{ color: 'var(--text-primary)' }}>{user.displayName}</span>
                      <button onClick={() => handleAddMember(user.id)} style={{
                        padding: '4px 8px', background: 'var(--accent-teal)20', border: '1px solid var(--accent-teal)',
                        color: 'var(--accent-teal)', cursor: 'pointer', fontSize: '0.7rem',
                      }}>INVITE</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '0 20px 20px' }}>
              {groupDetails.members?.map(member => (
                <div key={member.id} style={{
                  padding: '12px', marginTop: '8px',
                  background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Avatar letter={member.avatar || member.name[0]} color={member.role === 'admin' ? 'var(--accent-amber)' : 'var(--text-dim)'} size={36} status={member.status} />
                    <div>
                      <div style={{ color: 'var(--text-primary)' }}>{member.name}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{member.role}</div>
                    </div>
                  </div>
                  {groupDetails.isAdmin && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleToggleAdmin(member.id, member.role)} style={{
                        padding: '4px 8px', background: 'transparent', border: '1px solid var(--border-primary)',
                        color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.65rem', fontFamily: 'monospace',
                      }}>{member.role === 'admin' ? '↓' : '↑'}</button>
                      <button onClick={() => handleRemoveMember(member.id)} style={{
                        padding: '4px 8px', background: 'transparent', border: '1px solid var(--accent-orange)50',
                        color: 'var(--accent-orange)', cursor: 'pointer', fontSize: '0.65rem', fontFamily: 'monospace',
                      }}>✕</button>
                    </div>
                  )}
                </div>
              ))}

              {/* Per-crew pending invitations */}
              {(() => {
                const crewInvitations = sentInvitations.filter(inv => inv.group_id === selectedGroup);
                if (crewInvitations.length === 0) return null;
                return (
                  <div style={{ marginTop: '20px' }}>
                    <GlowText color="var(--accent-amber)" size="0.9rem">PENDING INVITATIONS</GlowText>
                    {crewInvitations.map(inv => (
                      <div key={inv.id} style={{
                        padding: '12px', marginTop: '8px',
                        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
                        border: '1px solid var(--accent-amber)30',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <Avatar user={{ avatar: inv.invited_avatar, display_name: inv.invited_display_name, handle: inv.invited_handle }} size={36} />
                          <div>
                            <div style={{ color: 'var(--text-primary)' }}>{inv.invited_display_name || inv.invited_handle || 'Unknown User'}</div>
                            <div style={{ color: 'var(--accent-amber)', fontSize: '0.7rem' }}>Pending</div>
                          </div>
                        </div>
                        <button onClick={async () => {
                          try {
                            await fetchAPI(`/crews/invitations/${inv.id}`, { method: 'DELETE' });
                            showToast('Crew invitation cancelled', 'info');
                            loadSentInvitations();
                          } catch (err) {
                            showToast(err.message || formatError('Failed to cancel invitation'), 'error');
                          }
                        }} style={{
                          padding: '4px 8px', background: 'transparent', border: '1px solid var(--border-primary)',
                          color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'monospace',
                        }}>CANCEL</button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>}

      {/* New Group Modal */}
      {showNewGroup && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
        }}>
          <div style={{
            width: '100%', maxWidth: '400px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
            border: '2px solid var(--accent-amber)40', padding: '24px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
              <GlowText color="var(--accent-amber)" size="1.1rem">Create Crew</GlowText>
              <button onClick={() => setShowNewGroup(false)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>NAME</div>
              <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Crew name..."
                style={{
                  width: '100%', padding: '10px', boxSizing: 'border-box',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: 'inherit',
                }} />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>DESCRIPTION (optional)</div>
              <textarea value={newGroupDesc} onChange={(e) => setNewGroupDesc(e.target.value)}
                placeholder="What's this crew for?"
                style={{
                  width: '100%', padding: '10px', boxSizing: 'border-box', height: '80px', resize: 'none',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: 'inherit',
                }} />
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setShowNewGroup(false)} style={{
                flex: 1, padding: '12px', background: 'transparent',
                border: '1px solid var(--border-primary)', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace',
              }}>CANCEL</button>
              <button onClick={handleCreateGroup} disabled={!newGroupName.trim()} style={{
                flex: 1, padding: '12px',
                background: newGroupName.trim() ? 'var(--accent-amber)20' : 'transparent',
                border: `1px solid ${newGroupName.trim() ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
                color: newGroupName.trim() ? 'var(--accent-amber)' : 'var(--text-muted)',
                cursor: newGroupName.trim() ? 'pointer' : 'not-allowed', fontFamily: 'monospace',
              }}>CREATE</button>
            </div>
          </div>
        </div>
      )}

      {/* Invite to Group Modal */}
      <InviteToGroupModal
        isOpen={showInviteModal}
        onClose={() => { setShowInviteModal(false); loadSentInvitations(); }}
        group={groupDetails}
        contacts={contacts || []}
        fetchAPI={fetchAPI}
        showToast={showToast}
        isMobile={isMobile}
      />
    </div>
  );
};

// ============ USER MANAGEMENT ADMIN PANEL ============
const UserManagementPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle, currentUser }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(null); // 'reset-password' | 'disable-mfa' | 'change-role' | null
  const [pendingRole, setPendingRole] = useState(null);

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
        showToast(`Password reset. Temp password: ${data.temporaryPassword}`, 'success');
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
        </div>
      )}
    </div>
  );
};

// ============ ACTIVITY LOG ADMIN PANEL ============
const ActivityLogPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [selectedAction, setSelectedAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;

  const ACTION_LABELS = {
    login: { label: 'Login', color: 'var(--accent-green)' },
    login_failed: { label: 'Login Failed', color: 'var(--accent-orange)' },
    logout: { label: 'Logout', color: 'var(--text-dim)' },
    register: { label: 'Registration', color: 'var(--accent-teal)' },
    password_change: { label: 'Password Change', color: 'var(--accent-amber)' },
    password_reset_complete: { label: 'Password Reset', color: 'var(--accent-amber)' },
    mfa_enable: { label: 'MFA Enabled', color: 'var(--accent-green)' },
    mfa_disable: { label: 'MFA Disabled', color: 'var(--accent-orange)' },
    admin_warn: { label: 'Admin Warning', color: 'var(--accent-purple)' },
    admin_password_reset: { label: 'Admin Password Reset', color: 'var(--accent-purple)' },
    admin_force_logout: { label: 'Admin Force Logout', color: 'var(--accent-purple)' },
    admin_disable_mfa: { label: 'Admin MFA Disabled', color: 'var(--accent-purple)' },
    create_wave: { label: 'Wave Created', color: 'var(--accent-teal)' },
    delete_wave: { label: 'Wave Deleted', color: 'var(--accent-orange)' },
    create_ping: { label: 'Ping Created', color: 'var(--text-secondary)' },
    edit_ping: { label: 'Ping Edited', color: 'var(--text-secondary)' },
    delete_ping: { label: 'Ping Deleted', color: 'var(--accent-orange)' },
  };

  const loadActivities = useCallback(async (newOffset = 0) => {
    setLoading(true);
    try {
      let url = `/admin/activity-log?limit=${LIMIT}&offset=${newOffset}`;
      if (selectedAction) url += `&actionType=${selectedAction}`;

      const data = await fetchAPI(url);
      if (newOffset === 0) {
        setActivities(data.activities || []);
      } else {
        setActivities(prev => [...prev, ...(data.activities || [])]);
      }
      setTotal(data.total || 0);
      setHasMore((data.activities || []).length === LIMIT);
      setOffset(newOffset);
    } catch (err) {
      // Check if it's a 501 (not implemented) error
      if (err.message?.includes('501')) {
        setActivities([]);
        setTotal(0);
      } else {
        showToast(formatError('Failed to load activity log'), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, selectedAction, showToast]);

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchAPI('/admin/activity-stats?days=7');
      setStats(data);
    } catch {
      // Stats not critical, ignore errors
    }
  }, [fetchAPI]);

  useEffect(() => {
    if (isOpen && activities.length === 0) {
      loadActivities(0);
      loadStats();
    }
  }, [isOpen, loadActivities, loadStats, activities.length]);

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const getActionStyle = (actionType) => {
    const config = ACTION_LABELS[actionType] || { label: actionType, color: 'var(--text-dim)' };
    return config;
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
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', fontWeight: 500 }}>
            📊 ACTIVITY LOG
          </div>
          {stats && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
              Last 7 days: {stats.totalActivities} events | {stats.uniqueUsers} users
            </div>
          )}
        </div>
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

      {/* Filter by action type */}
      <div style={{ marginBottom: '16px' }}>
        <select
          value={selectedAction}
          onChange={(e) => {
            const newAction = e.target.value;
            setSelectedAction(newAction);
            setOffset(0);
            // Fetch filtered results immediately
            setLoading(true);
            let url = `/admin/activity-log?limit=${LIMIT}&offset=0`;
            if (newAction) url += `&actionType=${newAction}`;
            fetchAPI(url).then(data => {
              setActivities(data.activities || []);
              setTotal(data.total || 0);
              setHasMore((data.activities || []).length === LIMIT);
            }).catch(() => {
              showToast(formatError('Failed to load activity log'), 'error');
            }).finally(() => setLoading(false));
          }}
          style={{
            padding: '8px 12px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-secondary)',
            color: 'var(--text-primary)',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            cursor: 'pointer',
            minWidth: '180px'
          }}
        >
          <option value="">All Actions</option>
          <option value="login">Logins</option>
          <option value="login_failed">Failed Logins</option>
          <option value="register">Registrations</option>
          <option value="password_change">Password Changes</option>
          <option value="password_reset_complete">Password Resets</option>
          <option value="mfa_enable">MFA Enabled</option>
          <option value="mfa_disable">MFA Disabled</option>
          <option value="admin_warn">Admin Warnings</option>
          <option value="admin_password_reset">Admin Password Resets</option>
          <option value="admin_disable_mfa">Admin MFA Disabled</option>
          <option value="create_wave">Waves Created</option>
          <option value="delete_wave">Waves Deleted</option>
        </select>
      </div>

      {loading && activities.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>Loading...</div>
      ) : activities.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          No activity logs found. Activity logging may not be enabled.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
            Showing {activities.length} of {total} entries
          </div>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {activities.map((activity) => {
              const actionConfig = getActionStyle(activity.action_type);
              return (
                <div
                  key={activity.id}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    gap: isMobile ? '6px' : '12px',
                    alignItems: isMobile ? 'flex-start' : 'center',
                  }}
                >
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    background: actionConfig.color,
                    color: 'var(--bg-base)',
                    borderRadius: '2px',
                    whiteSpace: 'nowrap',
                    minWidth: isMobile ? 'auto' : '120px',
                    textAlign: 'center',
                  }}>
                    {actionConfig.label}
                  </span>
                  <span style={{
                    color: 'var(--text-secondary)',
                    fontSize: '0.8rem',
                    flex: 1,
                  }}>
                    {activity.user_handle || activity.user_id || 'System'}
                  </span>
                  <span style={{
                    color: 'var(--text-dim)',
                    fontSize: '0.7rem',
                    whiteSpace: 'nowrap',
                  }}>
                    {activity.ip_address || '-'}
                  </span>
                  <span style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.7rem',
                    whiteSpace: 'nowrap',
                  }}>
                    {formatDate(activity.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
          {hasMore && (
            <button
              onClick={() => loadActivities(offset + LIMIT)}
              disabled={loading}
              style={{
                marginTop: '12px',
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--border-secondary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                width: '100%',
              }}
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          )}
        </>
      )}
        </div>
      )}
    </div>
  );
};

// ============ CRAWL BAR ADMIN PANEL ============
const CrawlBarAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stockSymbols, setStockSymbols] = useState('');
  const [defaultLocation, setDefaultLocation] = useState('');

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI('/admin/crawl/config');
      setConfig(data.config);
      setStockSymbols((data.config?.stock_symbols || []).join(', '));
      setDefaultLocation(data.config?.default_location?.name || '');
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

              {/* API Key Status */}
              <div style={{ padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', marginTop: '12px' }}>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>API KEY STATUS</div>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.75rem' }}>
                  <span style={{ color: config?.apiKeys?.finnhub ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {config?.apiKeys?.finnhub ? '✓' : '✗'} Finnhub
                  </span>
                  <span style={{ color: config?.apiKeys?.openweathermap ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {config?.apiKeys?.openweathermap ? '✓' : '✗'} OpenWeather
                  </span>
                  <span style={{ color: config?.apiKeys?.newsapi ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {config?.apiKeys?.newsapi ? '✓' : '✗'} NewsAPI
                  </span>
                  <span style={{ color: config?.apiKeys?.gnews ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {config?.apiKeys?.gnews ? '✓' : '✗'} GNews
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '8px' }}>
                  Configure API keys in server/.env file
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ============ ALERTS ADMIN PANEL ============
const AlertsAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAlert, setEditingAlert] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formPriority, setFormPriority] = useState('info');
  const [formCategory, setFormCategory] = useState('system');
  const [formScope, setFormScope] = useState('local');
  const [formStartTime, setFormStartTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI('/admin/alerts');
      setAlerts(data.alerts || []);
    } catch (err) {
      if (!err.message?.includes('401')) {
        showToast(err.message || formatError('Failed to load alerts'), 'error');
      }
    }
    setLoading(false);
  }, [fetchAPI, showToast]);

  useEffect(() => {
    if (isOpen && alerts.length === 0) {
      loadAlerts();
    }
  }, [isOpen, alerts.length, loadAlerts]);

  const resetForm = () => {
    setFormTitle('');
    setFormContent('');
    setFormPriority('info');
    setFormCategory('system');
    setFormScope('local');
    // Default start time to now
    const now = new Date();
    setFormStartTime(now.toISOString().slice(0, 16));
    // Default end time to 24 hours from now
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    setFormEndTime(tomorrow.toISOString().slice(0, 16));
    setEditingAlert(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const openEditModal = (alert) => {
    setEditingAlert(alert);
    setFormTitle(alert.title);
    setFormContent(alert.content);
    setFormPriority(alert.priority);
    setFormCategory(alert.category);
    setFormScope(alert.scope);
    // Safely parse dates - convert to local datetime format for datetime-local input
    const parseToLocalDatetime = (dateStr) => {
      if (!dateStr) return '';
      // Ensure we parse as UTC - append Z if not present (SQLite may strip it)
      const utcStr = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
      const d = new Date(utcStr);
      if (isNaN(d.getTime())) return '';
      // Use local time methods to convert UTC to user's local timezone
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    setFormStartTime(parseToLocalDatetime(alert.startTime));
    setFormEndTime(parseToLocalDatetime(alert.endTime));
    setShowCreateModal(true);
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formContent.trim() || !formStartTime || !formEndTime) {
      showToast('Please fill all required fields', 'error');
      return;
    }

    setSaving(true);
    try {
      if (editingAlert) {
        await fetchAPI(`/admin/alerts/${editingAlert.id}`, {
          method: 'PUT',
          body: {
            title: formTitle.trim(),
            content: formContent.trim(),
            priority: formPriority,
            category: formCategory,
            scope: formScope,
            startTime: new Date(formStartTime).toISOString(),
            endTime: new Date(formEndTime).toISOString(),
          }
        });
        showToast('Alert updated', 'success');
      } else {
        await fetchAPI('/admin/alerts', {
          method: 'POST',
          body: {
            title: formTitle.trim(),
            content: formContent.trim(),
            priority: formPriority,
            category: formCategory,
            scope: formScope,
            startTime: new Date(formStartTime).toISOString(),
            endTime: new Date(formEndTime).toISOString(),
          }
        });
        showToast('Alert created', 'success');
      }
      setShowCreateModal(false);
      loadAlerts();
    } catch (err) {
      showToast(err.message || formatError('Failed to save alert'), 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (alertId) => {
    if (!confirm(CONFIRM_DIALOG.deleteAlert)) return;
    try {
      await fetchAPI(`/admin/alerts/${alertId}`, { method: 'DELETE' });
      showToast('Alert deleted', 'success');
      loadAlerts();
    } catch (err) {
      showToast(err.message || formatError('Failed to delete alert'), 'error');
    }
  };

  const getAlertStatus = (alert) => {
    const now = new Date();
    // Ensure we parse as UTC - append Z if not present (SQLite may strip it)
    const startStr = alert.startTime?.endsWith('Z') ? alert.startTime : alert.startTime + 'Z';
    const endStr = alert.endTime?.endsWith('Z') ? alert.endTime : alert.endTime + 'Z';
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (now < start) return { label: 'SCHEDULED', color: 'var(--accent-purple)' };
    if (now > end) return { label: 'EXPIRED', color: 'var(--text-muted)' };
    return { label: 'ACTIVE', color: 'var(--accent-green)' };
  };

  const priorityConfig = {
    critical: { icon: '🚨', color: 'var(--accent-orange)' },
    warning: { icon: '⚠️', color: 'var(--accent-amber)' },
    info: { icon: 'ℹ️', color: 'var(--accent-teal)' }
  };

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-amber)40',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', fontWeight: 500 }}>🚨 SYSTEM ALERTS</div>
        <button
          onClick={onToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? 'var(--accent-amber)20' : 'transparent',
            border: `1px solid ${isOpen ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
            color: isOpen ? 'var(--accent-amber)' : 'var(--text-dim)',
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
              {/* Create button */}
              <div style={{ marginBottom: '16px' }}>
                <button onClick={openCreateModal} style={{
                  padding: isMobile ? '10px 16px' : '8px 14px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: 'var(--accent-amber)20',
                  border: '1px solid var(--accent-amber)',
                  color: 'var(--accent-amber)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.85rem' : '0.8rem',
                }}>+ NEW ALERT</button>
              </div>

              {/* Alerts list */}
              {alerts.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                  No alerts configured
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {alerts.map(alert => {
                    const status = getAlertStatus(alert);
                    const cfg = priorityConfig[alert.priority] || priorityConfig.info;
                    return (
                      <div key={alert.id} style={{
                        padding: '12px',
                        background: 'var(--bg-surface)',
                        border: `1px solid ${cfg.color}40`,
                        display: 'flex',
                        flexDirection: isMobile ? 'column' : 'row',
                        gap: '8px',
                        alignItems: isMobile ? 'flex-start' : 'center',
                      }}>
                        {/* Priority icon and title */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span>{cfg.icon}</span>
                            <span style={{
                              color: 'var(--text-primary)',
                              fontFamily: 'monospace',
                              fontSize: '0.85rem',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {alert.title}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                            <span style={{ color: status.color, fontWeight: 600 }}>{status.label}</span>
                            <span>•</span>
                            <span>{alert.category}</span>
                            <span>•</span>
                            <span>{alert.scope}</span>
                            {alert.origin_node && (
                              <>
                                <span>•</span>
                                <span style={{ color: 'var(--accent-purple)' }}>@{alert.origin_node}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {/* Actions */}
                        {!alert.origin_node && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => openEditModal(alert)} style={{
                              padding: '4px 8px',
                              background: 'transparent',
                              border: '1px solid var(--border-secondary)',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              fontFamily: 'monospace',
                              fontSize: '0.7rem',
                            }}>EDIT</button>
                            <button onClick={() => handleDelete(alert.id)} style={{
                              padding: '4px 8px',
                              background: 'transparent',
                              border: '1px solid var(--accent-orange)40',
                              color: 'var(--accent-orange)',
                              cursor: 'pointer',
                              fontFamily: 'monospace',
                              fontSize: '0.7rem',
                            }}>DEL</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.8)', padding: '16px',
        }} onClick={() => setShowCreateModal(false)}>
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--accent-amber)',
            borderRadius: '4px', padding: isMobile ? '16px' : '24px',
            maxWidth: '500px', width: '100%', maxHeight: '90vh', overflow: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--accent-amber)', fontFamily: 'monospace' }}>
              {editingAlert ? 'EDIT ALERT' : 'NEW ALERT'}
            </h3>

            {/* Title */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>TITLE *</label>
              <input
                type="text"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                }}
                placeholder="Alert title..."
              />
            </div>

            {/* Content */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>CONTENT *</label>
              <textarea
                value={formContent}
                onChange={e => setFormContent(e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                  resize: 'vertical',
                }}
                placeholder="Alert content (supports basic HTML)..."
              />
            </div>

            {/* Priority + Category Row */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>PRIORITY</label>
                <select
                  value={formPriority}
                  onChange={e => setFormPriority(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="info">ℹ️ Info</option>
                  <option value="warning">⚠️ Warning</option>
                  <option value="critical">🚨 Critical</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>CATEGORY</label>
                <select
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="system">System</option>
                  <option value="announcement">Announcement</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
            </div>

            {/* Scope */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>SCOPE</label>
              <select
                value={formScope}
                onChange={e => setFormScope(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                }}
              >
                <option value="local">Local only</option>
                <option value="federated">{FEDERATION.scopeFederated}</option>
              </select>
            </div>

            {/* Start + End Time */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>START TIME *</label>
                <input
                  type="datetime-local"
                  value={formStartTime}
                  onChange={e => setFormStartTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>END TIME *</label>
                <input
                  type="datetime-local"
                  value={formEndTime}
                  onChange={e => setFormEndTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreateModal(false)} style={{
                padding: isMobile ? '10px 16px' : '8px 14px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'transparent',
                border: '1px solid var(--border-secondary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
              }}>CANCEL</button>
              <button onClick={handleSave} disabled={saving} style={{
                padding: isMobile ? '10px 16px' : '8px 14px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-amber)20',
                border: '1px solid var(--accent-amber)',
                color: 'var(--accent-amber)',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'SAVING...' : (editingAlert ? 'UPDATE' : 'CREATE')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============ ALERT SUBSCRIPTIONS PANEL ============
const AlertSubscriptionsPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [subscriptions, setSubscriptions] = useState([]);
  const [federationNodes, setFederationNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSub, setEditingSub] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formSourceNode, setFormSourceNode] = useState('');
  const [formCategories, setFormCategories] = useState({ system: false, announcement: false, emergency: false });

  const availableCategories = ['system', 'announcement', 'emergency'];

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load both subscriptions and federation nodes
      const [subsData, nodesData] = await Promise.all([
        fetchAPI('/admin/alert-subscriptions'),
        fetchAPI('/admin/federation/nodes').catch(() => ({ nodes: [] })) // Gracefully handle if federation disabled
      ]);
      setSubscriptions(subsData.subscriptions || []);
      setFederationNodes(nodesData.nodes || []);
    } catch (err) {
      if (!err.message?.includes('401')) {
        showToast(err.message || formatError('Failed to load subscriptions'), 'error');
      }
    }
    setLoading(false);
  }, [fetchAPI, showToast]);

  const loadSubscriptions = loadData; // Alias for refresh

  useEffect(() => {
    if (isOpen && subscriptions.length === 0 && federationNodes.length === 0) {
      loadData();
    }
  }, [isOpen, subscriptions.length, federationNodes.length, loadData]);

  const resetForm = () => {
    setFormSourceNode('');
    setFormCategories({ system: false, announcement: false, emergency: false });
    setEditingSub(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowAddModal(true);
  };

  const openEditModal = (sub) => {
    setEditingSub(sub);
    setFormSourceNode(sub.source_node);
    const cats = JSON.parse(sub.categories || '[]');
    setFormCategories({
      system: cats.includes('system'),
      announcement: cats.includes('announcement'),
      emergency: cats.includes('emergency'),
    });
    setShowAddModal(true);
  };

  const handleSave = async () => {
    const selectedCats = Object.entries(formCategories)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (!formSourceNode && !editingSub) {
      showToast(FEDERATION.selectAlliedPort, 'error');
      return;
    }
    if (selectedCats.length === 0) {
      showToast('Please select at least one category', 'error');
      return;
    }

    setSaving(true);
    try {
      if (editingSub) {
        await fetchAPI(`/admin/alert-subscriptions/${editingSub.id}`, {
          method: 'PUT',
          body: { categories: selectedCats }
        });
        showToast('Subscription updated', 'success');
      } else {
        await fetchAPI('/admin/alert-subscriptions', {
          method: 'POST',
          body: { sourceNode: formSourceNode, categories: selectedCats }
        });
        showToast('Subscription created', 'success');
      }
      setShowAddModal(false);
      loadSubscriptions();
    } catch (err) {
      showToast(err.message || formatError('Failed to save subscription'), 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (subId) => {
    if (!confirm(CONFIRM_DIALOG.unsubscribe)) return;
    try {
      await fetchAPI(`/admin/alert-subscriptions/${subId}`, { method: 'DELETE' });
      showToast('Subscription removed', 'success');
      loadSubscriptions();
    } catch (err) {
      showToast(err.message || formatError('Failed to remove subscription'), 'error');
    }
  };

  const handleToggleStatus = async (sub) => {
    try {
      await fetchAPI(`/admin/alert-subscriptions/${sub.id}`, {
        method: 'PUT',
        body: { status: sub.status === 'active' ? 'paused' : 'active' }
      });
      showToast(`Subscription ${sub.status === 'active' ? 'paused' : 'resumed'}`, 'success');
      loadSubscriptions();
    } catch (err) {
      showToast(err.message || formatError('Failed to update subscription'), 'error');
    }
  };

  // Get nodes we haven't subscribed to yet
  const subscribedNodes = subscriptions.map(s => s.source_node);
  const availableNodes = federationNodes.filter(n => !subscribedNodes.includes(n.node_name) && n.status === 'active');

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
        <div style={{ color: 'var(--accent-purple)', fontSize: '0.8rem', fontWeight: 500 }}>◇ ALERT SUBSCRIPTIONS</div>
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
          {loading ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>Loading...</div>
          ) : (
            <>
              {/* Info text */}
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '12px' }}>
                {FEDERATION.subscribeInfo}
              </div>

              {/* Add button */}
              <div style={{ marginBottom: '16px' }}>
                <button onClick={openAddModal} disabled={availableNodes.length === 0} style={{
                  padding: isMobile ? '10px 16px' : '8px 14px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: 'var(--accent-purple)20',
                  border: '1px solid var(--accent-purple)',
                  color: 'var(--accent-purple)',
                  cursor: availableNodes.length === 0 ? 'not-allowed' : 'pointer',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.85rem' : '0.8rem',
                  opacity: availableNodes.length === 0 ? 0.5 : 1,
                }}>+ NEW SUBSCRIPTION</button>
                {availableNodes.length === 0 && federationNodes.length > 0 && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: '8px' }}>
                    {FEDERATION.subscribedToAllPorts}
                  </span>
                )}
                {federationNodes.length === 0 && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: '8px' }}>
                    {FEDERATION.noAlliedPortsConfigured}
                  </span>
                )}
              </div>

              {/* Subscriptions list */}
              {subscriptions.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                  {FEDERATION.noAlertSubscriptions}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {subscriptions.map(sub => {
                    const cats = JSON.parse(sub.categories || '[]');
                    return (
                      <div key={sub.id} style={{
                        padding: '12px',
                        background: 'var(--bg-surface)',
                        border: `1px solid ${sub.status === 'active' ? 'var(--accent-purple)40' : 'var(--border-subtle)'}`,
                        display: 'flex',
                        flexDirection: isMobile ? 'column' : 'row',
                        gap: '8px',
                        alignItems: isMobile ? 'flex-start' : 'center',
                        opacity: sub.status === 'paused' ? 0.6 : 1,
                      }}>
                        {/* Node name and categories */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span style={{ color: 'var(--accent-purple)' }}>◇</span>
                            <span style={{
                              color: 'var(--text-primary)',
                              fontFamily: 'monospace',
                              fontSize: '0.85rem',
                            }}>
                              {sub.source_node}
                            </span>
                            {sub.status === 'paused' && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>(paused)</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {cats.map(cat => (
                              <span key={cat} style={{
                                fontSize: '0.65rem',
                                padding: '2px 6px',
                                background: 'var(--accent-purple)20',
                                border: '1px solid var(--accent-purple)40',
                                color: 'var(--accent-purple)',
                                fontFamily: 'monospace',
                              }}>
                                {cat}
                              </span>
                            ))}
                          </div>
                        </div>
                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => handleToggleStatus(sub)} style={{
                            padding: '4px 8px',
                            background: 'transparent',
                            border: '1px solid var(--border-secondary)',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                            fontSize: '0.7rem',
                          }}>{sub.status === 'active' ? 'PAUSE' : 'RESUME'}</button>
                          <button onClick={() => openEditModal(sub)} style={{
                            padding: '4px 8px',
                            background: 'transparent',
                            border: '1px solid var(--border-secondary)',
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                            fontSize: '0.7rem',
                          }}>EDIT</button>
                          <button onClick={() => handleDelete(sub.id)} style={{
                            padding: '4px 8px',
                            background: 'transparent',
                            border: '1px solid var(--accent-orange)40',
                            color: 'var(--accent-orange)',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                            fontSize: '0.7rem',
                          }}>DEL</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.8)', padding: '16px',
        }} onClick={() => setShowAddModal(false)}>
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--accent-purple)',
            borderRadius: '4px', padding: isMobile ? '16px' : '24px',
            maxWidth: '400px', width: '100%',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--accent-purple)', fontFamily: 'monospace' }}>
              {editingSub ? 'EDIT SUBSCRIPTION' : 'NEW SUBSCRIPTION'}
            </h3>

            {/* Node selector */}
            {!editingSub && (
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>{FEDERATION.alliedPortLabel}</label>
                <select
                  value={formSourceNode}
                  onChange={e => setFormSourceNode(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="">{FEDERATION.selectPort}</option>
                  {availableNodes.map(node => (
                    <option key={node.id} value={node.node_name}>{node.node_name}</option>
                  ))}
                </select>
              </div>
            )}

            {editingSub && (
              <div style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                Node: <span style={{ color: 'var(--accent-purple)' }}>{editingSub.source_node}</span>
              </div>
            )}

            {/* Category checkboxes */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>CATEGORIES TO RECEIVE</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {availableCategories.map(cat => (
                  <label key={cat} style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    cursor: 'pointer', color: 'var(--text-secondary)', fontFamily: 'monospace',
                  }}>
                    <input
                      type="checkbox"
                      checked={formCategories[cat] || false}
                      onChange={e => setFormCategories(prev => ({ ...prev, [cat]: e.target.checked }))}
                      style={{ accentColor: 'var(--accent-purple)' }}
                    />
                    {cat}
                  </label>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowAddModal(false)} style={{
                padding: isMobile ? '10px 16px' : '8px 14px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'transparent',
                border: '1px solid var(--border-secondary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
              }}>CANCEL</button>
              <button onClick={handleSave} disabled={saving} style={{
                padding: isMobile ? '10px 16px' : '8px 14px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-purple)20',
                border: '1px solid var(--accent-purple)',
                color: 'var(--accent-purple)',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'SAVING...' : (editingSub ? 'UPDATE' : 'SUBSCRIBE')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============ FEDERATION ADMIN PANEL ============
const FederationAdminPanel = ({ fetchAPI, showToast, isMobile, refreshTrigger = 0, isOpen, onToggle }) => {
  const [status, setStatus] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [nodeName, setNodeName] = useState('');
  const [showAddNode, setShowAddNode] = useState(false);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodeUrl, setNewNodeUrl] = useState('');
  const [handshakeLoading, setHandshakeLoading] = useState(null);
  // Federation request system
  const [federationRequests, setFederationRequests] = useState([]);
  const [requestUrl, setRequestUrl] = useState('');
  const [requestMessage, setRequestMessage] = useState('');
  const [requestLoading, setRequestLoading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(null);

  const loadFederationData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusData, nodesData, requestsData] = await Promise.all([
        fetchAPI('/admin/federation/status'),
        fetchAPI('/admin/federation/nodes'),
        fetchAPI('/admin/federation/requests').catch(() => ({ requests: [] }))
      ]);
      setStatus(statusData);
      setNodes(nodesData.nodes || []);
      setFederationRequests(requestsData.requests || []);
      if (statusData.nodeName) {
        setNodeName(statusData.nodeName);
      }
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToLoadVerse), 'error');
    }
    setLoading(false);
  }, [fetchAPI, showToast]);

  useEffect(() => {
    if (isOpen) {
      loadFederationData();
    }
  }, [isOpen, loadFederationData, refreshTrigger]);

  const handleSetupIdentity = async () => {
    if (!nodeName.trim() || nodeName.length < 3) {
      showToast(FEDERATION.portNameMinLength, 'error');
      return;
    }
    try {
      await fetchAPI('/admin/federation/identity', {
        method: 'POST',
        body: { nodeName: nodeName.trim() }
      });
      showToast(FEDERATION.identityConfigured, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToConfigureIdentity), 'error');
    }
  };

  const handleAddNode = async () => {
    if (!newNodeName.trim() || !newNodeUrl.trim()) {
      showToast(FEDERATION.portNameUrlRequired, 'error');
      return;
    }
    try {
      await fetchAPI('/admin/federation/nodes', {
        method: 'POST',
        body: { nodeName: newNodeName.trim(), baseUrl: newNodeUrl.trim() }
      });
      showToast(FEDERATION.portAdded, 'success');
      setNewNodeName('');
      setNewNodeUrl('');
      setShowAddNode(false);
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToAddPort), 'error');
    }
  };

  const handleHandshake = async (nodeId) => {
    setHandshakeLoading(nodeId);
    try {
      const result = await fetchAPI(`/admin/federation/nodes/${nodeId}/handshake`, {
        method: 'POST'
      });
      showToast(result.message || FEDERATION.dockingSuccessful, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToDock), 'error');
    }
    setHandshakeLoading(null);
  };

  const handleDeleteNode = async (nodeId) => {
    if (!confirm(CONFIRM_DIALOG.removeFederationNode)) return;
    try {
      await fetchAPI(`/admin/federation/nodes/${nodeId}`, { method: 'DELETE' });
      showToast(FEDERATION.portRemoved, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToRemovePort), 'error');
    }
  };

  const handleStatusChange = async (nodeId, newStatus) => {
    try {
      await fetchAPI(`/admin/federation/nodes/${nodeId}`, {
        method: 'PUT',
        body: { status: newStatus }
      });
      showToast(`Port ${newStatus}`, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToUpdateStatus), 'error');
    }
  };

  // Send federation request to another server
  const handleSendRequest = async () => {
    if (!requestUrl.trim()) {
      showToast('Port URL is required', 'error');
      return;
    }
    setRequestLoading(true);
    try {
      const result = await fetchAPI('/admin/federation/request', {
        method: 'POST',
        body: {
          baseUrl: requestUrl.trim(),
          message: requestMessage.trim() || null
        }
      });
      showToast(result.message || FEDERATION.dockingRequestSent, 'success');
      setRequestUrl('');
      setRequestMessage('');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToSendRequest), 'error');
    }
    setRequestLoading(false);
  };

  // Accept incoming federation request
  const handleAcceptRequest = async (requestId) => {
    setAcceptLoading(requestId);
    try {
      const result = await fetchAPI(`/admin/federation/requests/${requestId}/accept`, {
        method: 'POST'
      });
      showToast(result.message || FEDERATION.dockingRequestAccepted, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToAcceptRequest), 'error');
    }
    setAcceptLoading(null);
  };

  // Decline incoming federation request
  const handleDeclineRequest = async (requestId) => {
    if (!confirm(CONFIRM_DIALOG.declineFederationRequest)) return;
    setAcceptLoading(requestId);
    try {
      await fetchAPI(`/admin/federation/requests/${requestId}/decline`, {
        method: 'POST'
      });
      showToast(FEDERATION.dockingRequestDeclined, 'success');
      loadFederationData();
    } catch (err) {
      showToast(err.message || formatError(FEDERATION.failedToDeclineRequest), 'error');
    }
    setAcceptLoading(null);
  };

  const getStatusColor = (s) => {
    switch (s) {
      case 'active': return 'var(--accent-green)';
      case 'pending': return 'var(--accent-amber)';
      case 'outbound_pending': return 'var(--accent-teal)';
      case 'suspended': return 'var(--accent-orange)';
      case 'blocked': return 'var(--status-error)';
      case 'declined': return 'var(--text-dim)';
      default: return 'var(--text-dim)';
    }
  };

  const getStatusLabel = (s) => {
    switch (s) {
      case 'outbound_pending': return 'AWAITING RESPONSE';
      case 'declined': return 'DECLINED';
      default: return s.toUpperCase();
    }
  };

  return (
    <div style={{ marginTop: '20px', padding: isMobile ? '16px' : '20px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))', border: '1px solid var(--accent-teal)40' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', fontWeight: 500 }}>{FEDERATION.panelHeading}</div>
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
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)' }}>Loading...</div>
          ) : (
            <>
              {/* Status Overview */}
      <div style={{
        marginTop: '16px',
        padding: isMobile ? '14px' : '16px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: isMobile ? '0.9rem' : '0.85rem' }}>Status</span>
          <span style={{
            padding: '2px 10px',
            background: status?.enabled ? 'var(--accent-green)20' : 'var(--text-dim)20',
            color: status?.enabled ? 'var(--accent-green)' : 'var(--text-dim)',
            fontSize: '0.75rem',
            textTransform: 'uppercase',
          }}>
            {status?.enabled ? FEDERATION.verseEnabled : FEDERATION.verseDisabled}
          </span>
        </div>

        {!status?.enabled && (
          <div style={{
            padding: '12px',
            background: 'var(--accent-amber)10',
            border: '1px solid var(--accent-amber)40',
            color: 'var(--accent-amber)',
            fontSize: isMobile ? '0.85rem' : '0.8rem',
            marginBottom: '16px',
          }}>
            {FEDERATION.envHint}
          </div>
        )}

        {/* Server Identity Setup */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px', textTransform: 'uppercase' }}>
            {FEDERATION.portIdentity}
          </div>

          {status?.configured ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--accent-teal)', fontFamily: 'monospace', fontSize: isMobile ? '0.9rem' : '0.85rem' }}>
                {status.nodeName}
              </span>
              <span style={{
                padding: '2px 8px',
                background: 'var(--accent-green)20',
                color: 'var(--accent-green)',
                fontSize: '0.7rem',
              }}>
                {status.hasKeypair ? 'KEYPAIR OK' : 'NO KEYPAIR'}
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={nodeName}
                onChange={(e) => setNodeName(e.target.value)}
                placeholder="farhold.example.com"
                style={{
                  flex: 1,
                  minWidth: '200px',
                  padding: isMobile ? '12px' : '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                }}
              />
              <button
                onClick={handleSetupIdentity}
                style={{
                  padding: isMobile ? '12px 20px' : '10px 20px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: 'var(--accent-teal)20',
                  border: '1px solid var(--accent-teal)',
                  color: 'var(--accent-teal)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.85rem' : '0.8rem',
                }}
              >
                CONFIGURE
              </button>
            </div>
          )}
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '24px', color: 'var(--text-dim)', fontSize: isMobile ? '0.85rem' : '0.8rem' }}>
          <span>{FEDERATION.alliedPortsCount}: <span style={{ color: 'var(--text-primary)' }}>{status?.trustedNodes || 0}</span></span>
          <span>{FEDERATION.activeCount}: <span style={{ color: 'var(--accent-green)' }}>{status?.activeNodes || 0}</span></span>
        </div>
      </div>

      {/* Request Federation Section */}
      {status?.configured && status?.enabled && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase', marginBottom: '12px' }}>
            {FEDERATION.requestDocking}
          </div>
          <div style={{
            padding: isMobile ? '14px' : '16px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--accent-purple)40',
          }}>
            <div style={{ marginBottom: '12px' }}>
              <input
                type="text"
                value={requestUrl}
                onChange={(e) => setRequestUrl(e.target.value)}
                placeholder={FEDERATION.portUrlPlaceholder}
                style={{
                  width: '100%',
                  padding: isMobile ? '12px' : '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                  marginBottom: '8px',
                }}
              />
              <textarea
                value={requestMessage}
                onChange={(e) => setRequestMessage(e.target.value)}
                placeholder={FEDERATION.optionalMessagePlaceholder}
                rows={2}
                style={{
                  width: '100%',
                  padding: isMobile ? '12px' : '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                  resize: 'vertical',
                }}
              />
            </div>
            <button
              onClick={handleSendRequest}
              disabled={requestLoading || !requestUrl.trim()}
              style={{
                padding: isMobile ? '12px 20px' : '10px 20px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-purple)20',
                border: '1px solid var(--accent-purple)',
                color: 'var(--accent-purple)',
                cursor: requestLoading || !requestUrl.trim() ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
                opacity: requestLoading || !requestUrl.trim() ? 0.6 : 1,
              }}
            >
              {requestLoading ? FEDERATION.sendingRequest : FEDERATION.sendRequest}
            </button>
            <div style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              {FEDERATION.requestDockingHelp}
            </div>
          </div>
        </div>
      )}

      {/* Incoming Federation Requests */}
      {federationRequests.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
              {FEDERATION.incomingRequests}
            </span>
            <span style={{
              padding: '2px 8px',
              background: 'var(--accent-purple)20',
              color: 'var(--accent-purple)',
              fontSize: '0.7rem',
              borderRadius: '10px',
            }}>
              {federationRequests.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {federationRequests.map((request) => (
              <div
                key={request.id}
                style={{
                  padding: isMobile ? '14px' : '12px 16px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--accent-purple)40',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <span style={{ color: 'var(--accent-purple)', fontFamily: 'monospace', fontSize: isMobile ? '0.9rem' : '0.85rem' }}>
                      {request.fromNodeName}
                    </span>
                  </div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                    {new Date(request.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div style={{ color: 'var(--text-dim)', fontSize: isMobile ? '0.8rem' : '0.75rem', marginBottom: '8px' }}>
                  {request.fromBaseUrl}
                </div>

                {request.message && (
                  <div style={{
                    padding: '8px',
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-secondary)',
                    fontSize: isMobile ? '0.85rem' : '0.8rem',
                    fontStyle: 'italic',
                    marginBottom: '12px',
                  }}>
                    "{request.message}"
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleAcceptRequest(request.id)}
                    disabled={acceptLoading === request.id}
                    style={{
                      padding: isMobile ? '10px 16px' : '8px 14px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'var(--accent-green)20',
                      border: '1px solid var(--accent-green)',
                      color: 'var(--accent-green)',
                      cursor: acceptLoading === request.id ? 'wait' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.8rem' : '0.75rem',
                      opacity: acceptLoading === request.id ? 0.6 : 1,
                    }}
                  >
                    {acceptLoading === request.id ? FEDERATION.accepting : FEDERATION.accept}
                  </button>
                  <button
                    onClick={() => handleDeclineRequest(request.id)}
                    disabled={acceptLoading === request.id}
                    style={{
                      padding: isMobile ? '10px 16px' : '8px 14px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'transparent',
                      border: '1px solid var(--accent-orange)',
                      color: 'var(--accent-orange)',
                      cursor: acceptLoading === request.id ? 'wait' : 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.8rem' : '0.75rem',
                      opacity: acceptLoading === request.id ? 0.6 : 1,
                    }}
                  >
                    {FEDERATION.denyDocking}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trusted Nodes */}
      <div style={{ marginTop: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', textTransform: 'uppercase' }}>{FEDERATION.alliedPorts}</span>
          <button
            onClick={() => setShowAddNode(!showAddNode)}
            style={{
              padding: isMobile ? '8px 14px' : '6px 12px',
              background: showAddNode ? 'var(--accent-teal)20' : 'transparent',
              border: `1px solid ${showAddNode ? 'var(--accent-teal)' : 'var(--border-primary)'}`,
              color: showAddNode ? 'var(--accent-teal)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.8rem' : '0.75rem',
            }}
          >
            {showAddNode ? 'CANCEL' : FEDERATION.addPort}
          </button>
        </div>

        {/* Add Node Form */}
        {showAddNode && (
          <div style={{
            padding: isMobile ? '14px' : '16px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--accent-teal)40',
            marginBottom: '12px',
          }}>
            <div style={{ marginBottom: '12px' }}>
              <input
                type="text"
                value={newNodeName}
                onChange={(e) => setNewNodeName(e.target.value)}
                placeholder={FEDERATION.addPortNamePlaceholder}
                style={{
                  width: '100%',
                  padding: isMobile ? '12px' : '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                  marginBottom: '8px',
                }}
              />
              <input
                type="text"
                value={newNodeUrl}
                onChange={(e) => setNewNodeUrl(e.target.value)}
                placeholder={FEDERATION.addPortUrlPlaceholder}
                style={{
                  width: '100%',
                  padding: isMobile ? '12px' : '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.9rem' : '0.85rem',
                }}
              />
            </div>
            <button
              onClick={handleAddNode}
              style={{
                padding: isMobile ? '12px 20px' : '10px 20px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-teal)20',
                border: '1px solid var(--accent-teal)',
                color: 'var(--accent-teal)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
              }}
            >
              {FEDERATION.addPortBtn}
            </button>
          </div>
        )}

        {/* Node List */}
        {nodes.length === 0 ? (
          <div style={{
            padding: '20px',
            textAlign: 'center',
            color: 'var(--text-dim)',
            background: 'var(--bg-surface)',
            border: '1px dashed var(--border-subtle)',
            fontSize: isMobile ? '0.9rem' : '0.85rem',
          }}>
            {FEDERATION.noAlliedPorts}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {nodes.map((node) => (
              <div
                key={node.id}
                style={{
                  padding: isMobile ? '14px' : '12px 16px',
                  background: 'var(--bg-surface)',
                  border: `1px solid ${node.status === 'active' ? 'var(--accent-green)40' : 'var(--border-subtle)'}`,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div>
                    <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: isMobile ? '0.9rem' : '0.85rem' }}>
                      {node.nodeName}
                    </span>
                    <span style={{
                      marginLeft: '10px',
                      padding: '2px 8px',
                      background: `${getStatusColor(node.status)}20`,
                      color: getStatusColor(node.status),
                      fontSize: '0.7rem',
                    }}>
                      {getStatusLabel(node.status)}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteNode(node.id)}
                    style={{
                      padding: '4px 8px',
                      background: 'transparent',
                      border: '1px solid var(--accent-orange)40',
                      color: 'var(--accent-orange)',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: '0.7rem',
                    }}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ color: 'var(--text-dim)', fontSize: isMobile ? '0.8rem' : '0.75rem', marginBottom: '8px' }}>
                  {node.baseUrl}
                </div>

                {node.lastContactAt && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: '8px' }}>
                    Last contact: {new Date(node.lastContactAt).toLocaleString()}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {node.status === 'pending' && (
                    <button
                      onClick={() => handleHandshake(node.id)}
                      disabled={handshakeLoading === node.id}
                      style={{
                        padding: isMobile ? '10px 16px' : '8px 14px',
                        minHeight: isMobile ? '44px' : 'auto',
                        background: 'var(--accent-teal)20',
                        border: '1px solid var(--accent-teal)',
                        color: 'var(--accent-teal)',
                        cursor: handshakeLoading === node.id ? 'wait' : 'pointer',
                        fontFamily: 'monospace',
                        fontSize: isMobile ? '0.8rem' : '0.75rem',
                        opacity: handshakeLoading === node.id ? 0.6 : 1,
                      }}
                    >
                      {handshakeLoading === node.id ? FEDERATION.docking : FEDERATION.dock}
                    </button>
                  )}

                  {node.status === 'outbound_pending' && (
                    <span style={{
                      padding: isMobile ? '10px 16px' : '8px 14px',
                      background: 'var(--accent-teal)10',
                      color: 'var(--accent-teal)',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.8rem' : '0.75rem',
                    }}>
                      {FEDERATION.waitingForResponse}
                    </span>
                  )}

                  {node.status === 'declined' && (
                    <span style={{
                      padding: isMobile ? '10px 16px' : '8px 14px',
                      background: 'var(--text-dim)10',
                      color: 'var(--text-dim)',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.8rem' : '0.75rem',
                    }}>
                      {FEDERATION.requestWasDeclined}
                    </span>
                  )}

                  {node.status === 'active' && (
                    <button
                      onClick={() => handleStatusChange(node.id, 'suspended')}
                      style={{
                        padding: isMobile ? '10px 16px' : '8px 14px',
                        minHeight: isMobile ? '44px' : 'auto',
                        background: 'transparent',
                        border: '1px solid var(--accent-orange)',
                        color: 'var(--accent-orange)',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        fontSize: isMobile ? '0.8rem' : '0.75rem',
                      }}
                    >
                      SUSPEND
                    </button>
                  )}

                  {node.status === 'suspended' && (
                    <>
                      <button
                        onClick={() => handleHandshake(node.id)}
                        disabled={handshakeLoading === node.id}
                        style={{
                          padding: isMobile ? '10px 16px' : '8px 14px',
                          minHeight: isMobile ? '44px' : 'auto',
                          background: 'var(--accent-green)20',
                          border: '1px solid var(--accent-green)',
                          color: 'var(--accent-green)',
                          cursor: handshakeLoading === node.id ? 'wait' : 'pointer',
                          fontFamily: 'monospace',
                          fontSize: isMobile ? '0.8rem' : '0.75rem',
                          opacity: handshakeLoading === node.id ? 0.6 : 1,
                        }}
                      >
                        REACTIVATE
                      </button>
                      <button
                        onClick={() => handleStatusChange(node.id, 'blocked')}
                        style={{
                          padding: isMobile ? '10px 16px' : '8px 14px',
                          minHeight: isMobile ? '44px' : 'auto',
                          background: 'transparent',
                          border: '1px solid var(--status-error)',
                          color: 'var(--status-error)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: isMobile ? '0.8rem' : '0.75rem',
                        }}
                      >
                        BLOCK
                      </button>
                    </>
                  )}

                  {node.publicKey && (
                    <span style={{
                      padding: '4px 8px',
                      background: 'var(--accent-green)10',
                      color: 'var(--accent-green)',
                      fontSize: '0.7rem',
                    }}>
                      KEY OK
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ============ HANDLE REQUESTS LIST (ADMIN) ============
const HandleRequestsList = ({ fetchAPI, showToast, isMobile, isOpen: controlledIsOpen, onToggle }) => {
  // Support both controlled (isOpen/onToggle props) and uncontrolled modes
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;
  const handleToggle = isControlled ? onToggle : () => setInternalIsOpen(!internalIsOpen);

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const data = await fetchAPI('/admin/handle-requests');
      setRequests(data);
    } catch (err) {
      showToast(err.message || formatError('Failed to load requests'), 'error');
    }
    setLoading(false);
  };

  useEffect(() => {
    if (isOpen) {
      loadRequests();
    }
  }, [isOpen]);

  const handleApprove = async (requestId) => {
    try {
      await fetchAPI(`/admin/handle-requests/${requestId}/approve`, { method: 'POST' });
      showToast('Handle change approved', 'success');
      loadRequests();
    } catch (err) {
      showToast(err.message || formatError('Failed to approve'), 'error');
    }
  };

  const handleReject = async (requestId) => {
    const reason = prompt('Rejection reason (optional):');
    try {
      await fetchAPI(`/admin/handle-requests/${requestId}/reject`, {
        method: 'POST',
        body: { reason }
      });
      showToast('Handle change rejected', 'success');
      loadRequests();
    } catch (err) {
      showToast(err.message || formatError('Failed to reject'), 'error');
    }
  };

  return (
    <div style={{ marginTop: '20px', padding: isMobile ? '16px' : '20px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))', border: '1px solid var(--accent-amber)40' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', fontWeight: 500 }}>HANDLE REQUESTS</div>
        <button
          onClick={handleToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? 'var(--accent-amber)20' : 'transparent',
            border: `1px solid ${isOpen ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
            color: isOpen ? 'var(--accent-amber)' : 'var(--text-dim)',
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
            <LoadingSpinner />
          ) : requests.length === 0 ? (
            <div style={{
              padding: '20px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: isMobile ? '0.9rem' : '0.85rem',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            }}>
              No pending handle change requests
            </div>
          ) : (
            <div>
      {requests.map(req => (
        <div key={req.id} style={{
          padding: isMobile ? '14px' : '16px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '12px',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '12px',
            flexWrap: 'wrap',
            gap: '8px',
          }}>
            <div>
              <div style={{ color: 'var(--text-primary)', fontSize: isMobile ? '1rem' : '0.9rem', marginBottom: '4px' }}>
                {req.displayName}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: isMobile ? '0.85rem' : '0.75rem', fontFamily: 'monospace' }}>
                @{req.currentHandle} → @{req.newHandle}
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: isMobile ? '0.8rem' : '0.7rem', marginTop: '4px' }}>
                Requested: {new Date(req.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => handleApprove(req.id)} style={{
              padding: isMobile ? '10px 16px' : '8px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: 'var(--accent-green)20',
              border: '1px solid var(--accent-green)', color: 'var(--accent-green)',
              cursor: 'pointer', fontFamily: 'monospace', fontSize: isMobile ? '0.85rem' : '0.75rem',
            }}>APPROVE</button>

            <button onClick={() => handleReject(req.id)} style={{
              padding: isMobile ? '10px 16px' : '8px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: 'var(--accent-orange)20',
              border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)',
              cursor: 'pointer', fontFamily: 'monospace', fontSize: isMobile ? '0.85rem' : '0.75rem',
            }}>REJECT</button>
          </div>
        </div>
      ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============ BOTS ADMIN PANEL (v2.1.0) ============

const BotsAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [selectedBot, setSelectedBot] = useState(null);
  const [newApiKey, setNewApiKey] = useState(null);
  const [newWebhookSecret, setNewWebhookSecret] = useState(null);

  // Form state
  const [botName, setBotName] = useState('');
  const [botDescription, setBotDescription] = useState('');
  const [enableWebhook, setEnableWebhook] = useState(false);

  // Load bots
  const loadBots = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAPI('/admin/bots');
      setBots(data.bots || []);
    } catch (err) {
      showToast(err.message || formatError('Failed to load bots'), 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => {
    if (isOpen) loadBots();
  }, [isOpen, loadBots]);

  // Create bot
  const handleCreateBot = async () => {
    if (!botName || botName.length < 3) {
      showToast('Bot name must be at least 3 characters', 'error');
      return;
    }

    try {
      const data = await fetchAPI('/admin/bots', {
        method: 'POST',
        body: { name: botName, description: botDescription, enableWebhook },
      });

      // Show API key modal with the new key
      setNewApiKey(data.bot.apiKey);
      setNewWebhookSecret(data.bot.webhookSecret || null);
      setShowApiKeyModal(true);
      setShowCreateModal(false);

      // Reset form
      setBotName('');
      setBotDescription('');
      setEnableWebhook(false);

      loadBots();
      showToast(`Bot "${data.bot.name}" created`, 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to create bot'), 'error');
    }
  };

  // Update bot status
  const handleUpdateStatus = async (botId, status) => {
    try {
      await fetchAPI(`/admin/bots/${botId}`, {
        method: 'PATCH',
        body: { status },
      });
      showToast(`Bot ${status}`, 'success');
      loadBots();
    } catch (err) {
      showToast(err.message || formatError('Failed to update bot'), 'error');
    }
  };

  // Delete bot
  const handleDeleteBot = async (botId, botName) => {
    if (!confirm(CONFIRM_DIALOG.deleteBot(botName))) return;

    try {
      await fetchAPI(`/admin/bots/${botId}`, { method: 'DELETE' });
      showToast(`Bot "${botName}" deleted`, 'success');
      loadBots();
    } catch (err) {
      showToast(err.message || formatError('Failed to delete bot'), 'error');
    }
  };

  // Regenerate API key
  const handleRegenerateKey = async (botId) => {
    if (!confirm(CONFIRM_DIALOG.regenerateKey)) return;

    try {
      const data = await fetchAPI(`/admin/bots/${botId}/regenerate`, { method: 'POST' });
      setNewApiKey(data.apiKey);
      setNewWebhookSecret(null);
      setShowApiKeyModal(true);
      showToast('API key regenerated', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to regenerate key'), 'error');
    }
  };

  // View bot details
  const handleViewDetails = async (botId) => {
    try {
      const data = await fetchAPI(`/admin/bots/${botId}`);
      setSelectedBot(data.bot);
      setShowDetailsModal(true);
    } catch (err) {
      showToast(err.message || formatError('Failed to load bot details'), 'error');
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
        <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', fontWeight: 500 }}>
          🤖 BOTS & WEBHOOKS
        </div>
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
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>
              Loading bots...
            </div>
          ) : (
            <>
              {/* Info */}
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '12px' }}>
                Bots can post messages to waves via API. Each bot has a unique API key and optional webhook URL.
              </div>

              {/* Create button */}
              <div style={{ marginBottom: '16px' }}>
                <button
                  onClick={() => setShowCreateModal(true)}
                  style={{
                    padding: isMobile ? '10px 16px' : '8px 14px',
                    minHeight: isMobile ? '44px' : 'auto',
                    background: 'var(--accent-teal)20',
                    border: '1px solid var(--accent-teal)',
                    color: 'var(--accent-teal)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: isMobile ? '0.85rem' : '0.8rem',
                  }}
                >
                  + CREATE BOT
                </button>
              </div>

              {/* Bots list */}
              {bots.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                  No bots created yet
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {bots.map(bot => (
                    <div
                      key={bot.id}
                      style={{
                        padding: '12px',
                        background: 'var(--bg-surface)',
                        border: `1px solid ${bot.status === 'active' ? 'var(--accent-green)40' : 'var(--text-dim)40'}`,
                        display: 'flex',
                        flexDirection: isMobile ? 'column' : 'row',
                        gap: '12px',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '1.2rem' }}>🤖</span>
                          <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>
                            {bot.name}
                          </span>
                          <span style={{
                            padding: '2px 6px',
                            fontSize: '0.65rem',
                            background: bot.status === 'active' ? 'var(--accent-green)20' : 'var(--text-dim)20',
                            color: bot.status === 'active' ? 'var(--accent-green)' : 'var(--text-dim)',
                            border: `1px solid ${bot.status === 'active' ? 'var(--accent-green)' : 'var(--text-dim)'}`,
                          }}>
                            {bot.status.toUpperCase()}
                          </span>
                        </div>
                        {bot.description && (
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', marginBottom: '6px' }}>
                            {bot.description}
                          </div>
                        )}
                        <div style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>
                          Owner: {bot.owner_name} (@{bot.owner_handle}) •
                          Pings: {bot.total_pings} •
                          API Calls: {bot.total_api_calls}
                        </div>
                        {bot.wave_count > 0 && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '4px' }}>
                            Waves: {bot.wave_titles || `${bot.wave_count} wave(s)`}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                        <button
                          onClick={() => handleViewDetails(bot.id)}
                          style={{
                            padding: '6px 10px',
                            background: 'var(--accent-purple)20',
                            border: '1px solid var(--accent-purple)',
                            color: 'var(--accent-purple)',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                          }}
                        >
                          DETAILS
                        </button>
                        <button
                          onClick={() => handleRegenerateKey(bot.id)}
                          style={{
                            padding: '6px 10px',
                            background: 'var(--accent-amber)20',
                            border: '1px solid var(--accent-amber)',
                            color: 'var(--accent-amber)',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                          }}
                        >
                          REGEN KEY
                        </button>
                        {bot.status === 'active' && (
                          <button
                            onClick={() => handleUpdateStatus(bot.id, 'suspended')}
                            style={{
                              padding: '6px 10px',
                              background: 'transparent',
                              border: '1px solid var(--accent-orange)',
                              color: 'var(--accent-orange)',
                              cursor: 'pointer',
                              fontSize: '0.7rem',
                            }}
                          >
                            SUSPEND
                          </button>
                        )}
                        {bot.status === 'suspended' && (
                          <button
                            onClick={() => handleUpdateStatus(bot.id, 'active')}
                            style={{
                              padding: '6px 10px',
                              background: 'var(--accent-green)20',
                              border: '1px solid var(--accent-green)',
                              color: 'var(--accent-green)',
                              cursor: 'pointer',
                              fontSize: '0.7rem',
                            }}
                          >
                            ACTIVATE
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteBot(bot.id, bot.name)}
                          style={{
                            padding: '6px 10px',
                            background: 'transparent',
                            border: '1px solid var(--status-error)',
                            color: 'var(--status-error)',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                          }}
                        >
                          DELETE
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Create Bot Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
        }} onClick={() => setShowCreateModal(false)}>
          <div style={{
            width: '100%', maxWidth: '500px',
            background: 'linear-gradient(135deg, var(--bg-base), var(--bg-surface))',
            border: '2px solid var(--accent-teal)80', padding: isMobile ? '20px' : '24px',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: '20px' }}>
              <GlowText color="var(--accent-teal)" size={isMobile ? '1rem' : '1.1rem'}>Create Bot</GlowText>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>
                BOT NAME *
              </label>
              <input
                type="text"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                placeholder="e.g., GitHub Notifier"
                maxLength={50}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>
                DESCRIPTION
              </label>
              <textarea
                value={botDescription}
                onChange={(e) => setBotDescription(e.target.value)}
                placeholder="What does this bot do?"
                maxLength={500}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                  resize: 'vertical',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enableWebhook}
                  onChange={(e) => setEnableWebhook(e.target.checked)}
                />
                <span style={{ color: 'var(--text-primary)', fontSize: '0.8rem' }}>
                  Enable webhook endpoint
                </span>
              </label>
              {enableWebhook && (
                <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '4px', marginLeft: '24px' }}>
                  A webhook secret will be generated for secure external integrations
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowCreateModal(false)}
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
                onClick={handleCreateBot}
                style={{
                  padding: '10px 16px',
                  background: 'var(--accent-teal)',
                  border: '1px solid var(--accent-teal)',
                  color: 'var(--bg-primary)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                CREATE BOT
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* API Key Display Modal */}
      {showApiKeyModal && newApiKey && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
        }} onClick={() => {
          setShowApiKeyModal(false);
          setNewApiKey(null);
          setNewWebhookSecret(null);
        }}>
          <div style={{
            width: '100%', maxWidth: '550px',
            background: 'linear-gradient(135deg, var(--bg-base), var(--bg-surface))',
            border: '2px solid var(--accent-orange)80', padding: isMobile ? '20px' : '24px',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: '20px' }}>
              <GlowText color="var(--accent-orange)" size={isMobile ? '1rem' : '1.1rem'}>⚠️ Save Your API Key</GlowText>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ color: 'var(--accent-orange)', fontSize: '0.85rem', fontWeight: 500 }}>
              This API key will only be shown once. Save it securely!
            </div>

            <div>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>
                API KEY
              </label>
              <div style={{
                padding: '12px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent-teal)',
                color: 'var(--accent-teal)',
                fontSize: '0.8rem',
                wordBreak: 'break-all',
                fontFamily: 'monospace',
              }}>
                {newApiKey}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newApiKey);
                  showToast('API key copied!', 'success');
                }}
                style={{
                  marginTop: '8px',
                  padding: '8px 12px',
                  background: 'var(--accent-teal)20',
                  border: '1px solid var(--accent-teal)',
                  color: 'var(--accent-teal)',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                📋 COPY KEY
              </button>
            </div>

            {newWebhookSecret && (
              <div>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>
                  WEBHOOK SECRET
                </label>
                <div style={{
                  padding: '12px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--accent-purple)',
                  color: 'var(--accent-purple)',
                  fontSize: '0.8rem',
                  wordBreak: 'break-all',
                  fontFamily: 'monospace',
                }}>
                  {newWebhookSecret}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(newWebhookSecret);
                    showToast('Webhook secret copied!', 'success');
                  }}
                  style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    background: 'var(--accent-purple)20',
                    border: '1px solid var(--accent-purple)',
                    color: 'var(--accent-purple)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                  }}
                >
                  📋 COPY SECRET
                </button>
              </div>
            )}

            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
              Use this key in your bot's Authorization header:
              <code style={{
                display: 'block',
                marginTop: '8px',
                padding: '8px',
                background: 'var(--bg-elevated)',
                fontSize: '0.7rem',
              }}>
                Authorization: Bearer {newApiKey.substring(0, 20)}...
              </code>
            </div>

            <button
              onClick={() => {
                setShowApiKeyModal(false);
                setNewApiKey(null);
                setNewWebhookSecret(null);
              }}
              style={{
                padding: '10px 16px',
                background: 'var(--accent-green)',
                border: '1px solid var(--accent-green)',
                color: 'var(--bg-primary)',
                cursor: 'pointer',
                fontWeight: 500,
              }}
            >
              I'VE SAVED IT
            </button>
            </div>
          </div>
        </div>
      )}

      {/* Bot Details Modal */}
      {showDetailsModal && selectedBot && (
        <BotDetailsModal
          bot={selectedBot}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedBot(null);
          }}
          fetchAPI={fetchAPI}
          showToast={showToast}
          isMobile={isMobile}
          onUpdate={loadBots}
        />
      )}
    </div>
  );
};

// Bot Details Modal Component (separate for complexity management)
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


export default GroupsView;
