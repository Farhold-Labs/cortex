import React, { useState } from 'react';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import { Avatar } from '../ui/SimpleComponents.jsx';

/**
 * A Community voice channel in the wave list (v2.118.0).
 *
 * Who is in the room is listed under the channel whether or not you have
 * joined — that is the point of a voice channel. Joining is an explicit JOIN
 * button rather than a tap on the row: the row folds the list like every other
 * channel, and a stray tap while scrolling must not put you in a room.
 *
 * Moderator actions appear on other people's rows only while you are in the
 * channel yourself, because that is when the server has told this client it
 * holds `voice.moderate` there (in the join token's `can`). The server checks
 * it again, and rank, on every action.
 */
const SOURCE_ICONS = { camera: '📷', screen_share: '🖥️' };

const VoiceChannelSection = ({
  channel, participants = [], isOpen, onToggle, isMobile, menu,
  connected, connecting, canModerate, myUserId, onJoin, onLeave, onModerate,
}) => {
  const [actionsFor, setActionsFor] = useState(null);

  const button = {
    background: connected ? 'var(--accent-orange)' : 'transparent',
    border: `1px solid ${connected ? 'var(--accent-orange)' : 'var(--accent-teal)'}`,
    color: connected ? 'var(--text-primary)' : 'var(--accent-teal)',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.65rem',
    padding: isMobile ? '4px 10px' : '2px 8px',
    minHeight: isMobile ? '28px' : undefined,
  };

  const headerAction = onJoin ? (
    connected ? (
      <button style={button} onClick={onLeave} aria-label={`Leave ${channel.name}`}>LEAVE</button>
    ) : (
      <button style={button} onClick={() => onJoin(channel)} disabled={connecting} aria-label={`Join ${channel.name}`}>
        {connecting ? '…' : 'JOIN'}
      </button>
    )
  ) : null;

  return (
    <CollapsibleSection
      title={`🔊 ${channel.name}`}
      badge={participants.length ? String(participants.length) : undefined}
      isOpen={isOpen}
      onToggle={onToggle}
      titleColor={connected ? 'var(--accent-teal)' : 'var(--text-primary)'}
      isMobile={isMobile}
      compact
      indent={1}
      menuTitle={`${channel.name} options`}
      menu={menu}
      headerAction={headerAction}
    >
      {participants.length === 0 ? (
        <div style={{ padding: '6px 32px 8px', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
          Nobody here
        </div>
      ) : participants.map(p => {
        const isMe = p.userId === myUserId;
        const canAct = canModerate && connected && !isMe;
        return (
          <div key={p.userId}>
            <div
              onClick={canAct ? () => setActionsFor(actionsFor === p.userId ? null : p.userId) : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: isMobile ? '6px 12px 6px 36px' : '4px 12px 4px 36px',
                cursor: canAct ? 'pointer' : 'default',
              }}
              title={canAct ? 'Moderate' : undefined}
            >
              <Avatar
                letter={p.avatar || (p.displayName || '?')[0]}
                imageUrl={p.avatarUrl}
                size={isMobile ? 24 : 20}
              />
              <span style={{
                color: isMe ? 'var(--accent-teal)' : 'var(--text-secondary)',
                fontSize: '0.78rem', minWidth: 0, flex: 1,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {p.displayName || p.handle || 'Someone'}{isMe ? ' (you)' : ''}
              </span>
              {(p.sources || []).filter(s => SOURCE_ICONS[s]).map(s => (
                <span key={s} style={{ fontSize: '0.7rem' }} aria-label={s.replace('_', ' ')}>{SOURCE_ICONS[s]}</span>
              ))}
              {canAct && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>⋮</span>}
            </div>
            {canAct && actionsFor === p.userId && (
              <div style={{ display: 'flex', gap: '6px', padding: '2px 12px 6px 64px' }}>
                {['mute', 'disconnect'].map(action => (
                  <button
                    key={action}
                    onClick={() => { setActionsFor(null); onModerate(channel, p, action); }}
                    style={{
                      background: 'transparent', cursor: 'pointer', fontFamily: 'monospace',
                      fontSize: '0.65rem', padding: isMobile ? '6px 10px' : '3px 8px',
                      border: `1px solid ${action === 'disconnect' ? 'var(--accent-orange, var(--accent-amber))' : 'var(--border-primary)'}`,
                      color: action === 'disconnect' ? 'var(--accent-orange, var(--accent-amber))' : 'var(--text-primary)',
                    }}
                  >
                    {action === 'mute' ? 'MUTE MIC' : 'DISCONNECT'}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </CollapsibleSection>
  );
};

export default VoiceChannelSection;
