import React, { useState } from 'react';
import { PRIVACY_LEVELS } from '../../config/constants.js';
import { FEDERATION } from '../../../messages.js';
import { GlowText, Avatar } from '../ui/SimpleComponents.jsx';
import { T } from '../../config/terminology.js';

const NewWaveModal = ({ isOpen, onClose, onCreate, contacts, groups, federationEnabled }) => {
  const [title, setTitle] = useState('');
  const [privacy, setPrivacy] = useState('private');
  const [selectedParticipants, setSelectedParticipants] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [federatedInput, setFederatedInput] = useState('');
  const [federatedParticipants, setFederatedParticipants] = useState([]); // Array of "@handle@server" strings

  if (!isOpen) return null;

  const handleAddFederated = () => {
    const input = federatedInput.trim();
    // Validate format: @handle@server or handle@server
    const match = input.match(/^@?([^@\s]+)@([^@\s]+)$/);
    if (match) {
      const normalized = `@${match[1]}@${match[2]}`;
      if (!federatedParticipants.includes(normalized)) {
        setFederatedParticipants([...federatedParticipants, normalized]);
        // Auto-switch to cross-server privacy when adding federated participant
        if (privacy !== 'crossServer') {
          setPrivacy('crossServer');
        }
      }
      setFederatedInput('');
    }
  };

  const handleRemoveFederated = (fp) => {
    setFederatedParticipants(federatedParticipants.filter(f => f !== fp));
  };

  const handleCreate = () => {
    if (!title.trim()) return;
    if (privacy === 'group' && !selectedGroup) return;
    // Combine local participant IDs with federated participant strings
    const allParticipants = [...selectedParticipants, ...federatedParticipants];
    onCreate({ title, privacy, participants: allParticipants, groupId: privacy === 'group' ? selectedGroup : null });
    setTitle(''); setPrivacy('private'); setSelectedParticipants([]); setSelectedGroup(null);
    setFederatedInput(''); setFederatedParticipants([]);
    onClose();
  };

  const canCreate = title.trim() && (privacy !== 'group' || selectedGroup);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
    }}>
      <div style={{
        width: '100%', maxWidth: '450px', maxHeight: '80vh', overflowY: 'auto',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        border: '2px solid var(--accent-amber)40', padding: '24px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <GlowText color="var(--accent-amber)" size="1.1rem">New {T.Wave}</GlowText>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>TITLE</div>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={`${T.Wave} title...`}
            style={{
              width: '100%', padding: '10px', boxSizing: 'border-box',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: 'inherit',
            }} />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>PRIVACY LEVEL</div>
          {Object.entries(PRIVACY_LEVELS).map(([key, config]) => (
            <button key={key} onClick={() => { setPrivacy(key); if (key !== 'group') setSelectedGroup(null); }}
              style={{
                width: '100%', padding: '12px', marginBottom: '8px', textAlign: 'left',
                background: privacy === key ? config.bgColor : 'var(--bg-elevated)',
                border: `1px solid ${privacy === key ? config.color : 'var(--border-subtle)'}`, cursor: 'pointer',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: config.color, fontSize: '1.1rem' }}>{config.icon}</span>
                <div>
                  <div style={{ color: config.color }}>{config.name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{config.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {privacy === 'group' && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>SELECT {T.CREW}</div>
            {groups.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', padding: '10px', background: 'var(--bg-elevated)' }}>No {T.crews}. Create one first.</div>
            ) : groups.map(g => (
              <button key={g.id} onClick={() => setSelectedGroup(g.id)} style={{
                width: '100%', padding: '10px', marginBottom: '4px', textAlign: 'left',
                background: selectedGroup === g.id ? 'var(--accent-amber)15' : 'var(--bg-elevated)',
                border: `1px solid ${selectedGroup === g.id ? 'var(--accent-amber)' : 'var(--border-subtle)'}`, cursor: 'pointer',
              }}>
                <div style={{ color: 'var(--text-primary)' }}>{g.name}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{g.memberCount} members</div>
              </button>
            ))}
          </div>
        )}

        {privacy !== 'group' && privacy !== 'public' && contacts.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>LOCAL CONTACTS</div>
            <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
              {contacts.map(c => (
                <button key={c.id} onClick={() => setSelectedParticipants(p => p.includes(c.id) ? p.filter(x => x !== c.id) : [...p, c.id])}
                  style={{
                    width: '100%', padding: '8px', marginBottom: '4px',
                    background: selectedParticipants.includes(c.id) ? 'var(--accent-amber)15' : 'transparent',
                    border: `1px solid ${selectedParticipants.includes(c.id) ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px',
                  }}>
                  <Avatar letter={c.avatar} color="var(--accent-amber)" size={24} />
                  <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>{c.name}</span>
                  {selectedParticipants.includes(c.id) && <span style={{ marginLeft: 'auto', color: 'var(--accent-green)' }}>✔</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Federated participants section */}
        {federationEnabled && privacy !== 'group' && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>
              {FEDERATION.travelersLabel} <span style={{ color: 'var(--accent-teal)' }}>◇</span>
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
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
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
            <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px' }}>
              {FEDERATION.travelerFormatHint}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '12px', background: 'transparent',
            border: '1px solid var(--border-primary)', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace',
          }}>CANCEL</button>
          <button onClick={handleCreate} disabled={!canCreate} style={{
            flex: 1, padding: '12px',
            background: canCreate ? 'var(--accent-amber)20' : 'transparent',
            border: `1px solid ${canCreate ? 'var(--accent-amber)' : 'var(--text-muted)'}`,
            color: canCreate ? 'var(--accent-amber)' : 'var(--text-muted)',
            cursor: canCreate ? 'pointer' : 'not-allowed', fontFamily: 'monospace',
          }}>CREATE</button>
        </div>
      </div>
    </div>
  );
};

export default NewWaveModal;
