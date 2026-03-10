import React, { useState } from 'react';
import { formatError } from '../../../messages.js';
import { Avatar } from '../ui/SimpleComponents.jsx';

const SentCrewInvitationsPanel = ({ invitations, fetchAPI, showToast, onInvitationsChange, isMobile }) => {
  const [cancelling, setCancelling] = useState({});
  const [expanded, setExpanded] = useState(false);

  const handleCancel = async (invitationId) => {
    setCancelling(prev => ({ ...prev, [invitationId]: true }));
    try {
      await fetchAPI(`/crews/invitations/${invitationId}`, { method: 'DELETE' });
      showToast('Crew invitation cancelled', 'info');
      onInvitationsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to cancel invitation'), 'error');
    }
    setCancelling(prev => ({ ...prev, [invitationId]: false }));
  };

  if (!invitations || invitations.length === 0) return null;

  return (
    <div style={{
      marginBottom: '24px', padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-amber)40',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', fontWeight: 500 }}>PENDING SENT INVITATIONS</span>
          <span style={{
            background: 'var(--accent-amber)', color: '#000', fontSize: '0.65rem',
            padding: '2px 6px', borderRadius: '10px', fontWeight: 700,
          }}>
            {invitations.length}
          </span>
        </div>
        {invitations.length > 3 && (
          <button onClick={() => setExpanded(!expanded)} style={{
            background: 'transparent', border: 'none', color: 'var(--accent-amber)',
            cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'monospace',
          }}>
            {expanded ? '[-] COLLAPSE' : '[+] EXPAND'}
          </button>
        )}
      </div>

      <div style={{ marginTop: '12px' }}>
        {(expanded ? invitations : invitations.slice(0, 3)).map((inv) => (
          <div key={inv.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: isMobile ? '10px' : '12px', background: 'var(--bg-hover)',
            marginBottom: '6px', border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
              <Avatar user={{ avatar: inv.invited_avatar, display_name: inv.invited_display_name, handle: inv.invited_handle }} size={isMobile ? '32px' : '36px'} />
              <div>
                <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                  {inv.invited_display_name || inv.invited_handle || 'Unknown User'}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '2px' }}>
                  {inv.group_name} • Sent {inv.created_at ? new Date(inv.created_at).toLocaleDateString() : 'Recently'}
                  {inv.expiresAt && (() => {
                    const daysLeft = Math.max(0, Math.ceil((new Date(inv.expiresAt) - Date.now()) / 86400000));
                    return <span style={{ color: daysLeft <= 1 ? 'var(--accent-red, #ff4444)' : 'var(--accent-amber)', marginLeft: '6px' }}>
                      (expires in {daysLeft}d)
                    </span>;
                  })()}
                </div>
              </div>
            </div>
            <button
              onClick={() => handleCancel(inv.id)}
              disabled={cancelling[inv.id]}
              style={{
                padding: '6px 12px', background: 'transparent', border: '1px solid var(--border-primary)',
                color: 'var(--text-muted)', cursor: cancelling[inv.id] ? 'wait' : 'pointer',
                fontSize: '0.7rem', fontFamily: 'monospace',
              }}
            >
              {cancelling[inv.id] ? 'CANCELLING...' : 'CANCEL'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SentCrewInvitationsPanel;
