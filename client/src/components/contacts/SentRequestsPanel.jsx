import React, { useState } from 'react';
import { formatError } from '../../../messages.js';
import { Avatar } from '../ui/SimpleComponents.jsx';

const SentRequestsPanel = ({ requests, fetchAPI, showToast, onRequestsChange, isMobile }) => {
  const [cancelling, setCancelling] = useState({});
  const [expanded, setExpanded] = useState(false);

  const handleCancel = async (requestId) => {
    setCancelling(prev => ({ ...prev, [requestId]: true }));
    try {
      await fetchAPI(`/contacts/requests/${requestId}`, { method: 'DELETE' });
      showToast('Contact request cancelled', 'info');
      onRequestsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to cancel request'), 'error');
    }
    setCancelling(prev => ({ ...prev, [requestId]: false }));
  };

  if (requests.length === 0) return null;

  return (
    <div style={{
      marginBottom: '24px', padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-amber)40',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', fontWeight: 500 }}>PENDING SENT REQUESTS</span>
          <span style={{
            background: 'var(--accent-amber)', color: '#000', fontSize: '0.65rem',
            padding: '2px 6px', borderRadius: '10px', fontWeight: 700,
          }}>
            {requests.length}
          </span>
        </div>
        {requests.length > 3 && (
          <button onClick={() => setExpanded(!expanded)} style={{
            background: 'transparent', border: 'none', color: 'var(--accent-amber)',
            cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'monospace',
          }}>
            {expanded ? '[-] COLLAPSE' : '[+] EXPAND'}
          </button>
        )}
      </div>

      <div style={{ marginTop: '12px' }}>
        {(expanded ? requests : requests.slice(0, 3)).filter(req => req && req.id && req.to_user && (req.to_user.displayName || req.to_user.handle)).map((req) => (
          <div key={req.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: isMobile ? '10px' : '12px', background: 'var(--bg-hover)',
            marginBottom: '6px', border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
              <Avatar user={req.to_user} size={isMobile ? '32px' : '36px'} />
              <div>
                <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                  {req.to_user?.displayName || req.to_user?.handle || 'Unknown User'}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '2px' }}>
                  Sent {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : 'Recently'}
                  {req.expiresAt && (() => {
                    const daysLeft = Math.max(0, Math.ceil((new Date(req.expiresAt) - Date.now()) / 86400000));
                    return <span style={{ color: daysLeft <= 1 ? 'var(--accent-red, #ff4444)' : 'var(--accent-amber)', marginLeft: '6px' }}>
                      (expires in {daysLeft}d)
                    </span>;
                  })()}
                </div>
              </div>
            </div>
            <button
              onClick={() => handleCancel(req.id)}
              disabled={cancelling[req.id]}
              style={{
                padding: '6px 12px', background: 'transparent', border: '1px solid var(--border-primary)',
                color: 'var(--text-muted)', cursor: cancelling[req.id] ? 'wait' : 'pointer',
                fontSize: '0.7rem', fontFamily: 'monospace',
              }}
            >
              {cancelling[req.id] ? 'CANCELLING...' : 'CANCEL'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SentRequestsPanel;
