import React, { useState, useEffect } from 'react';
import { formatError, FEDERATION } from '../../../messages.js';
import { GlowText } from '../ui/SimpleComponents.jsx';
import { T } from '../../config/terminology.js';

const InviteFederatedModal = ({ isOpen, onClose, wave, fetchAPI, showToast, isMobile }) => {
  const [federatedInput, setFederatedInput] = useState('');
  const [federatedParticipants, setFederatedParticipants] = useState([]);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setFederatedInput('');
      setFederatedParticipants([]);
    }
  }, [isOpen]);

  const handleAddFederated = () => {
    const input = federatedInput.trim();
    const match = input.match(/^@?([^@\s]+)@([^@\s]+)$/);
    if (match) {
      const normalized = `@${match[1]}@${match[2]}`;
      if (!federatedParticipants.includes(normalized)) {
        setFederatedParticipants([...federatedParticipants, normalized]);
      }
      setFederatedInput('');
    }
  };

  const handleRemoveFederated = (fp) => {
    setFederatedParticipants(federatedParticipants.filter(x => x !== fp));
  };

  const handleInvite = async () => {
    if (federatedParticipants.length === 0) return;
    setInviting(true);

    try {
      const res = await fetchAPI(`/waves/${wave.id}/invite-federated`, {
        method: 'POST',
        body: JSON.stringify({ participants: federatedParticipants }),
      });

      if (res.ok) {
        const data = await res.json();
        const invited = data.results?.invited || [];
        const failed = data.results?.failed || [];

        if (invited.length > 0) {
          showToast(`Invited: ${invited.join(', ')}`, 'success');
        }
        if (failed.length > 0) {
          showToast(`Failed to invite: ${failed.join(', ')}`, 'error');
        }
        onClose();
      } else {
        const error = await res.json();
        showToast(error.error || formatError('Failed to invite'), 'error');
      }
    } catch (err) {
      showToast(formatError(FEDERATION.failedToInviteTravelers), 'error');
    } finally {
      setInviting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'var(--overlay-amber)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: isMobile ? '16px' : 0,
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-base)', border: '1px solid var(--accent-teal)',
        padding: '24px', width: isMobile ? '100%' : '400px', maxWidth: '90vw',
        maxHeight: '80vh', overflowY: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ color: 'var(--accent-teal)', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.2rem' }}>◇</span> {FEDERATION.broadcastToVerse}
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
          {FEDERATION.inviteTravelers} "{wave.title || wave.name}".
        </p>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
            {FEDERATION.addTravelers}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              type="text"
              value={federatedInput}
              onChange={(e) => setFederatedInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddFederated()}
              placeholder="@handle@server.com"
              style={{
                flex: 1, padding: '8px', boxSizing: 'border-box',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.85rem',
              }}
            />
            <button
              onClick={handleAddFederated}
              disabled={!federatedInput.trim()}
              style={{
                padding: '8px 12px', background: 'var(--accent-teal)20',
                border: '1px solid var(--accent-teal)', color: 'var(--accent-teal)',
                cursor: federatedInput.trim() ? 'pointer' : 'not-allowed', fontFamily: 'monospace',
              }}
            >ADD</button>
          </div>
          {federatedParticipants.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {federatedParticipants.map(fp => (
                <div key={fp} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '4px 8px', background: 'var(--accent-teal)15',
                  border: '1px solid var(--accent-teal)40', fontSize: '0.8rem',
                }}>
                  <span style={{ color: 'var(--accent-teal)' }}>{fp}</span>
                  <button
                    onClick={() => handleRemoveFederated(fp)}
                    style={{
                      background: 'none', border: 'none', color: 'var(--text-muted)',
                      cursor: 'pointer', padding: '0 2px', fontSize: '0.9rem',
                    }}
                  >✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
            {FEDERATION.travelerFormatHint}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '12px', background: 'transparent',
            border: '1px solid var(--border-primary)', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace',
          }}>CANCEL</button>
          <button onClick={handleInvite} disabled={federatedParticipants.length === 0 || inviting} style={{
            flex: 1, padding: '12px',
            background: federatedParticipants.length > 0 ? 'var(--accent-teal)20' : 'transparent',
            border: `1px solid ${federatedParticipants.length > 0 ? 'var(--accent-teal)' : 'var(--text-muted)'}`,
            color: federatedParticipants.length > 0 ? 'var(--accent-teal)' : 'var(--text-muted)',
            cursor: federatedParticipants.length > 0 && !inviting ? 'pointer' : 'not-allowed', fontFamily: 'monospace',
          }}>{inviting ? 'INVITING...' : 'INVITE'}</button>
        </div>
      </div>
    </div>
  );
};

export default InviteFederatedModal;
