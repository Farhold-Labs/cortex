import React, { useState } from 'react';
import { SUCCESS, formatError } from '../../../messages.js';
import { Avatar } from '../ui/SimpleComponents.jsx';
import { T } from '../../config/terminology.js';

const GroupInvitationsPanel = ({ invitations, fetchAPI, showToast, onInvitationsChange, onGroupsChange, isMobile }) => {
  const [processing, setProcessing] = useState({});

  const handleAccept = async (invitationId) => {
    setProcessing(prev => ({ ...prev, [invitationId]: 'accept' }));
    try {
      await fetchAPI(`/groups/invitations/${invitationId}/accept`, { method: 'POST' });
      showToast(SUCCESS.joined, 'success');
      onInvitationsChange();
      onGroupsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to accept invitation'), 'error');
    }
    setProcessing(prev => ({ ...prev, [invitationId]: null }));
  };

  const handleDecline = async (invitationId) => {
    setProcessing(prev => ({ ...prev, [invitationId]: 'decline' }));
    try {
      await fetchAPI(`/groups/invitations/${invitationId}/decline`, { method: 'POST' });
      showToast(`${T.Crew} invitation declined`, 'info');
      onInvitationsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to decline invitation'), 'error');
    }
    setProcessing(prev => ({ ...prev, [invitationId]: null }));
  };

  if (invitations.length === 0) return null;

  return (
    <div style={{
      marginBottom: '16px', padding: '16px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-amber)40',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <span style={{ color: 'var(--accent-amber)', fontSize: '0.9rem' }}>GROUP INVITATIONS</span>
        <span style={{
          background: 'var(--accent-amber)', color: '#000', fontSize: '0.65rem',
          padding: '2px 6px', borderRadius: '10px', fontWeight: 700,
        }}>
          {invitations.length}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {invitations.map((inv) => (
          <div key={inv.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px', background: 'var(--bg-hover)',
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
              {inv.invitedBy && <Avatar user={inv.invitedBy} size="36px" />}
              <div>
                <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500 }}>
                  {inv.group.name}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
                  Invited by {inv.invitedBy ? (inv.invitedBy.displayName || inv.invitedBy.handle) : 'Unknown'}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleAccept(inv.id)}
                disabled={processing[inv.id]}
                style={{
                  padding: '8px 14px', background: 'var(--accent-amber)30',
                  border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)',
                  cursor: processing[inv.id] ? 'wait' : 'pointer',
                  fontSize: '0.75rem', fontFamily: 'monospace',
                }}
              >
                {processing[inv.id] === 'accept' ? 'ACCEPTING...' : 'ACCEPT'}
              </button>
              <button
                onClick={() => handleDecline(inv.id)}
                disabled={processing[inv.id]}
                style={{
                  padding: '8px 14px', background: 'transparent',
                  border: '1px solid var(--border-primary)', color: 'var(--text-muted)',
                  cursor: processing[inv.id] ? 'wait' : 'pointer',
                  fontSize: '0.75rem', fontFamily: 'monospace',
                }}
              >
                {processing[inv.id] === 'decline' ? 'DECLINING...' : 'DECLINE'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GroupInvitationsPanel;
