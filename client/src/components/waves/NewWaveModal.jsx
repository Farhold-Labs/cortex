import React, { useState, useEffect } from 'react';
import { useModalDismiss } from '../../hooks/useModalDismiss.js';
import { PRIVACY_LEVELS } from '../../config/constants.js';
import { FEDERATION } from '../../../messages.js';
import { GlowText, Avatar } from '../ui/SimpleComponents.jsx';
import { T } from '../../config/terminology.js';

const NewWaveModal = ({ isOpen, onClose, onCreate, contacts, groups, federationEnabled, containerLabel = null, inChannel = false, initialGroupId = null }) => {
  const [title, setTitle] = useState('');
  // Who can see it (v2.135.0): the people picked (one by one or a whole
  // crew), or everyone on the server. The stored privacy follows from that;
  // a wave with people on other servers is federated because of who is in it,
  // which the server decides, so Verse-Wide is no longer a choice.
  const [everyone, setEveryone] = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [federatedInput, setFederatedInput] = useState('');
  const [federatedParticipants, setFederatedParticipants] = useState([]); // Array of "@handle@server" strings

  // Opened from "New wave with these people" (v2.132.0): that group, chosen.
  useEffect(() => {
    if (isOpen && initialGroupId) { setEveryone(false); setSelectedGroup(initialGroupId); }
  }, [isOpen, initialGroupId]);

  // In a Community channel a new wave is open to the channel (v2.134.0). Only
  // the Community's owners and admins narrow one, afterwards, under "Who can
  // see this"; a private conversation belongs outside the Community.
  useEffect(() => {
    if (isOpen && inChannel) setEveryone(true);
  }, [isOpen, inChannel]);

  /**
   * The same dismissal every other modal uses: Escape and the Close button
   * always work, the backdrop only when there is nothing to lose. A wave with
   * a title typed or people picked is not thrown away by a stray click.
   */
  const hasUnsavedInput = () => Boolean(
    title.trim() || selectedParticipants.length || selectedGroup ||
    federatedInput.trim() || federatedParticipants.length
  );
  const { backdropProps, bumped } = useModalDismiss({ onClose, hasUnsavedInput });

  if (!isOpen) return null;

  const handleAddFederated = () => {
    const input = federatedInput.trim();
    // Validate format: @handle@server or handle@server
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
    setFederatedParticipants(federatedParticipants.filter(f => f !== fp));
  };

  const open = inChannel || everyone;
  const handleCreate = () => {
    if (!title.trim()) return;
    const privacy = open ? 'public' : selectedGroup ? 'group' : 'private';
    // Local participant IDs and federated "@handle@server" strings together
    const allParticipants = open || selectedGroup ? [] : [...selectedParticipants, ...federatedParticipants];
    onCreate({ title, privacy, participants: allParticipants, groupId: privacy === 'group' ? selectedGroup : null });
    setTitle(''); setEveryone(false); setSelectedParticipants([]); setSelectedGroup(null);
    setFederatedInput(''); setFederatedParticipants([]);
    onClose();
  };

  const canCreate = Boolean(title.trim());
  // A whole crew, or people one by one: picking one clears the other.
  const pickGroup = (id) => { setSelectedGroup(g => g === id ? null : id); setSelectedParticipants([]); setFederatedParticipants([]); };
  const pickPerson = (id) => { setSelectedGroup(null); setSelectedParticipants(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); };
  const audienceChoice = (isEveryone, config, title, desc) => (
    <button key={title} onClick={() => setEveryone(isEveryone)} aria-pressed={everyone === isEveryone}
      style={{
        width: '100%', padding: '12px', marginBottom: '8px', textAlign: 'left',
        background: everyone === isEveryone ? config.bgColor : 'var(--bg-elevated)',
        border: `1px solid ${everyone === isEveryone ? config.color : 'var(--border-subtle)'}`, cursor: 'pointer',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ color: config.color, fontSize: '1.1rem' }}>{config.icon}</span>
        <div>
          <div style={{ color: config.color }}>{title}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{desc}</div>
        </div>
      </div>
    </button>
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '20px',
      }}
      {...backdropProps}
    >
      <div style={{
        width: '100%', maxWidth: '450px', maxHeight: '80vh', overflowY: 'auto',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        // A refused backdrop click flashes the edge. A dismissal that silently
        // does nothing reads as a broken modal.
        border: bumped ? '2px solid var(--accent-amber)' : '2px solid var(--accent-amber)40',
        padding: '24px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <GlowText color="var(--accent-amber)" size="1.1rem">
            New {T.Wave}{containerLabel ? ` in ${containerLabel}` : ''}
          </GlowText>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border-primary)',
              color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: '0.8rem', padding: '0.45rem 0.6rem',
            }}
          >Close</button>
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

        {inChannel ? (
          <div style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '0.75rem', lineHeight: 1.45 }}>
            Everyone who can see {containerLabel} can see this {T.wave}. The community's owners and admins can
            narrow it afterwards, under Who can see this. For a private conversation, start a {T.wave} outside the community.
          </div>
        ) : (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>WHO CAN SEE IT</div>
          {audienceChoice(false, PRIVACY_LEVELS.private, 'People', `Only the people you pick, or a whole ${T.crew}. Each is asked first.`)}
          {audienceChoice(true, PRIVACY_LEVELS.public, 'Everyone on this server', 'Anyone here can find and read it.')}
        </div>
        )}

        {!open && contacts.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>LOCAL CONTACTS</div>
            <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
              {contacts.map(c => (
                <button key={c.id} onClick={() => pickPerson(c.id)}
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
            {/* v2.132.0: two or more people make a group; the server decides, this says so. */}
            <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '6px', lineHeight: 1.4 }}>
              {selectedParticipants.length >= 2 && federatedParticipants.length === 0 && !containerLabel
                ? `With you and ${selectedParticipants.length} others this starts a group, named after its people until someone renames it. Each is asked first.`
                : 'Everyone you pick is asked first.'}
            </div>
          </div>
        )}

        {!open && groups.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '8px' }}>OR A WHOLE {T.CREW}</div>
            <div style={{ maxHeight: '160px', overflowY: 'auto' }}>
              {groups.map(g => (
                <button key={g.id} onClick={() => pickGroup(g.id)} aria-pressed={selectedGroup === g.id} style={{
                  width: '100%', padding: '10px', marginBottom: '4px', textAlign: 'left',
                  background: selectedGroup === g.id ? 'var(--accent-amber)15' : 'var(--bg-elevated)',
                  border: `1px solid ${selectedGroup === g.id ? 'var(--accent-amber)' : 'var(--border-subtle)'}`, cursor: 'pointer',
                }}>
                  <div style={{ color: 'var(--text-primary)' }}>{g.name}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{g.memberCount} members</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Federated participants section */}
        {federationEnabled && !open && !selectedGroup && (
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
