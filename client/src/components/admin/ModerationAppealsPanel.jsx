import React, { useState, useEffect, useCallback } from 'react';
import { formatError } from '../../../messages.js';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';

const ModerationAppealsPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [appeals, setAppeals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedAppeal, setSelectedAppeal] = useState(null);
  const [adminResponse, setAdminResponse] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const loadAppeals = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI('/admin/moderation-appeals');
      setAppeals(data.appeals || []);
    } catch (err) {
      showToast(formatError('Failed to load appeals'), 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => {
    if (isOpen) loadAppeals();
  }, [isOpen, loadAppeals]);

  const handleResolve = async (status) => {
    if (!selectedAppeal) return;
    setActionLoading(true);
    try {
      await fetchAPI(`/admin/moderation-appeals/${selectedAppeal.id}/resolve`, {
        method: 'POST',
        body: { status, adminResponse: adminResponse.trim() || null }
      });
      showToast(`Appeal ${status}${status === 'approved' ? ' — user reinstated' : ''}`, 'success');
      setAppeals(prev => prev.filter(a => a.id !== selectedAppeal.id));
      setSelectedAppeal(null);
      setAdminResponse('');
    } catch (err) {
      showToast(err.message || formatError('Failed to resolve appeal'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

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
    <CollapsibleSection title="APPEALS" isOpen={isOpen} onToggle={onToggle} isMobile={isMobile} badge={appeals.length > 0 ? String(appeals.length) : null}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Loading appeals...</div>
        ) : appeals.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No pending appeals</div>
        ) : (
          <>
            {appeals.map(appeal => (
              <div
                key={appeal.id}
                onClick={() => {
                  setSelectedAppeal(selectedAppeal?.id === appeal.id ? null : appeal);
                  setAdminResponse('');
                }}
                style={{
                  padding: '10px 12px',
                  marginBottom: '4px',
                  background: selectedAppeal?.id === appeal.id ? 'var(--accent-amber)20' : 'var(--bg-elevated)',
                  border: `1px solid ${selectedAppeal?.id === appeal.id ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>@{appeal.userHandle}</div>
                  <span style={{
                    color: appeal.accountStatus === 'banned' ? 'var(--accent-orange)' : 'var(--accent-amber)',
                    fontSize: '0.65rem',
                    padding: '2px 5px',
                    border: `1px solid ${appeal.accountStatus === 'banned' ? 'var(--accent-orange)' : 'var(--accent-amber)'}`,
                    textTransform: 'uppercase',
                  }}>
                    {appeal.accountStatus}
                  </span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  Reason: {appeal.moderationReason || 'None'}
                </div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '4px' }}>
                  {new Date(appeal.createdAt).toLocaleString()}
                </div>
              </div>
            ))}

            {selectedAppeal && (
              <div style={{ padding: '16px', background: 'var(--bg-hover)', border: '1px solid var(--border-secondary)', marginTop: '12px' }}>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>APPEAL TEXT</div>
                <div style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.85rem',
                  padding: '10px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: '12px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {selectedAppeal.appealText}
                </div>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' }}>
                    ADMIN RESPONSE (optional)
                  </label>
                  <textarea
                    value={adminResponse}
                    onChange={(e) => setAdminResponse(e.target.value)}
                    placeholder="Response to user..."
                    rows={2}
                    style={{ ...inputStyle, width: '100%', resize: 'vertical', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleResolve('approved')}
                    disabled={actionLoading}
                    style={{ ...buttonStyle, border: '1px solid var(--accent-green)', color: 'var(--accent-green)' }}
                  >
                    {actionLoading ? '...' : 'APPROVE & REINSTATE'}
                  </button>
                  <button
                    onClick={() => handleResolve('denied')}
                    disabled={actionLoading}
                    style={{ ...buttonStyle, border: '1px solid var(--accent-orange)', color: 'var(--accent-orange)' }}
                  >
                    {actionLoading ? '...' : 'DENY'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
    </CollapsibleSection>
  );
};

export default ModerationAppealsPanel;
