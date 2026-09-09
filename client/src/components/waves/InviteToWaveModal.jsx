import React, { useState, useEffect } from 'react';
import { formatError } from '../../../messages.js';
import { useE2EE } from '../../../e2ee-context.jsx';
import { Avatar, GlowText, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { T } from '../../config/terminology.js';

const InviteToWaveModal = ({ isOpen, onClose, wave, contacts, participants, fetchAPI, showToast, isMobile, onParticipantsChange }) => {
  const e2ee = useE2EE();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedUsers([]);
      setSearchQuery('');
    }
  }, [isOpen]);

  if (!isOpen || !wave) return null;

  // Get current participant IDs
  const participantIds = participants.map(p => p.id);

  // Filter contacts that are not already participants
  const availableContacts = (contacts || []).filter(c => !participantIds.includes(c.id));

  // Filter by search query
  const filteredContacts = availableContacts.filter(c => {
    const query = searchQuery.toLowerCase();
    return (c.displayName || c.name || '').toLowerCase().includes(query) ||
           (c.handle || '').toLowerCase().includes(query);
  });

  const toggleUser = (userId) => {
    setSelectedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleInvite = async () => {
    if (selectedUsers.length === 0) {
      showToast('Select at least one user to invite', 'error');
      return;
    }

    setLoading(true);
    let successCount = 0;
    let errors = [];
    let e2eeWarnings = [];

    // If wave is encrypted, ensure we have the wave key cached
    if (wave.encrypted && e2ee.isUnlocked) {
      try {
        console.log(`E2EE: Pre-fetching wave key for ${wave.id} before adding participants...`);
        await e2ee.getWaveKey(wave.id);
        console.log(`E2EE: Wave key cached successfully`);
      } catch (keyErr) {
        console.error('E2EE: Failed to fetch wave key:', keyErr);
        setLoading(false);
        showToast(formatError('Cannot add participants: Failed to load encryption key for this wave. Try reloading the wave first.'), 'error');
        return;
      }
    }

    for (const userId of selectedUsers) {
      const user = availableContacts.find(c => c.id === userId);
      const userName = user?.displayName || user?.name || userId;

      try {
        // Add participant to wave
        await fetchAPI(`/waves/${wave.id}/participants`, {
          method: 'POST',
          body: { userId }
        });

        // If wave is encrypted, distribute wave key to new participant
        if (wave.encrypted && e2ee.isUnlocked) {
          try {
            await e2ee.distributeKeyToParticipant(wave.id, userId);
            console.log(`E2EE: Successfully distributed key to ${userName}`);
          } catch (keyErr) {
            console.error(`E2EE: Failed to distribute key to ${userName}:`, keyErr);

            // Determine the specific error
            if (keyErr.message && keyErr.message.includes('does not have E2EE set up')) {
              e2eeWarnings.push(`${userName} doesn't have encryption enabled - they won't be able to read messages`);
            } else if (keyErr.message && keyErr.message.includes('Wave key not found')) {
              e2eeWarnings.push(`${userName} added but encryption key distribution failed - they won't be able to read messages`);
            } else {
              e2eeWarnings.push(`${userName} added but encryption failed: ${keyErr.message}`);
            }
          }
        }

        successCount++;
      } catch (err) {
        errors.push(`${userName}: ${err.message}`);
      }
    }

    setLoading(false);

    if (successCount > 0) {
      showToast(`Added ${successCount} participant${successCount > 1 ? 's' : ''} to ${T.wave}`, 'success');
      if (onParticipantsChange) onParticipantsChange();
      onClose();
    }
    if (e2eeWarnings.length > 0) {
      showToast(`⚠️ ${e2eeWarnings.join('; ')}`, 'warning');
    }
    if (errors.length > 0) {
      showToast(formatError(errors.join(', ')), 'error');
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
    }}>
      <div style={{
        width: '100%', maxWidth: '450px', maxHeight: '80vh', overflowY: 'auto',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        border: '2px solid var(--accent-teal)40', padding: '24px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <GlowText color="var(--accent-teal)" size="1.1rem">Invite to {T.Wave}</GlowText>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search contacts..."
            style={{
              width: '100%', padding: '10px 12px', boxSizing: 'border-box',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ marginBottom: '16px', maxHeight: '300px', overflowY: 'auto' }}>
          {filteredContacts.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>
              {availableContacts.length === 0 ? 'All contacts are already participants' : 'No matching contacts'}
            </div>
          ) : (
            filteredContacts.map(contact => (
              <div
                key={contact.id}
                onClick={() => toggleUser(contact.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px',
                  cursor: 'pointer',
                  background: selectedUsers.includes(contact.id) ? 'var(--accent-teal)15' : 'var(--bg-elevated)',
                  border: `1px solid ${selectedUsers.includes(contact.id) ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
                  marginBottom: '4px',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedUsers.includes(contact.id)}
                  onChange={() => toggleUser(contact.id)}
                  style={{ accentColor: 'var(--accent-teal)' }}
                />
                <Avatar letter={(contact.displayName || contact.name)?.[0] || '?'} color="var(--accent-teal)" size={28} imageUrl={contact.avatarUrl} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                    {contact.displayName || contact.name}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                    @{contact.handle}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onClose} disabled={loading} style={{
            flex: 1, padding: '12px', background: 'transparent',
            border: '1px solid var(--border-primary)', color: 'var(--text-dim)',
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'monospace',
            opacity: loading ? 0.5 : 1,
          }}>CANCEL</button>
          <button onClick={handleInvite} disabled={loading || selectedUsers.length === 0} style={{
            flex: 1, padding: '12px', background: 'var(--accent-teal)20',
            border: '1px solid var(--accent-teal)', color: 'var(--accent-teal)',
            cursor: (loading || selectedUsers.length === 0) ? 'not-allowed' : 'pointer',
            fontFamily: 'monospace',
            opacity: (loading || selectedUsers.length === 0) ? 0.5 : 1,
          }}>
            {loading ? 'ADDING...' : `INVITE ${selectedUsers.length > 0 ? `(${selectedUsers.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InviteToWaveModal;
