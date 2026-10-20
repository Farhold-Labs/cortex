import React, { useState } from 'react';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import { Avatar } from '../ui/SimpleComponents.jsx';

/**
 * A Community voice channel in the wave list (v2.118.0).
 *
 * Who is in the room is listed under the channel whether or not you have
 * joined — that is the point of a voice channel. Joining is an explicit JOIN
 * button rather than a tap on the row, so a stray tap while scrolling cannot
 * put you in a room.
 *
 * v2.118.1: the row does not fold, and an empty room shows nothing beneath it.
 * The occupant list is at most a few lines, so folding it saved nothing and
 * cost a row under every channel.
 *
 * Moderator actions appear on other people's rows only while you are in the
 * channel yourself, because that is when the server has told this client it
 * holds `voice.moderate` there (in the join token's `can`). The server checks
 * it again, and rank, on every action.
 *
 * A stage channel (v2.119.0) lists who is up first, then the audience, raised
 * hands at the top. Hosts bring people up and send them back.
 */
const SOURCE_ICONS = { camera: '📷', screen_share: '🖥️' };

const VoiceChannelSection = ({
  channel, participants = [], stage = false, moveTargets = [], isMobile, menu,
  connected, connecting, canModerate, myUserId, onJoin, onLeave, onModerate,
}) => {
  const [actionsFor, setActionsFor] = useState(null);
  const [movingFor, setMovingFor] = useState(null);

  // On a stage: who is up, then the audience with raised hands first.
  const onStage = stage ? participants.filter(p => p.onStage !== false) : participants;
  const audience = stage
    ? participants.filter(p => p.onStage === false).sort((a, b) => Number(Boolean(b.hand)) - Number(Boolean(a.hand)))
    : [];

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

  const actionButton = (key, label, onClick, danger = false) => (
    <button
      key={key}
      onClick={onClick}
      style={{
        background: 'transparent', cursor: 'pointer', fontFamily: 'monospace',
        fontSize: '0.65rem', padding: isMobile ? '6px 10px' : '3px 8px',
        border: `1px solid ${danger ? 'var(--accent-orange)' : 'var(--border-primary)'}`,
        color: danger ? 'var(--accent-orange)' : 'var(--text-primary)',
      }}
    >{label}</button>
  );

  const act = (p, action) => { setActionsFor(null); setMovingFor(null); onModerate(channel, p, action); };

  function renderRow(p) {
    const isMe = p.userId === myUserId;
    const canAct = canModerate && connected && !isMe;
    const listening = stage && p.onStage === false;
    const open = canAct && actionsFor === p.userId;
    return (
      <div key={p.userId}>
        <div
          onClick={canAct ? () => { setMovingFor(null); setActionsFor(open ? null : p.userId); } : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: isMobile ? '6px 12px 6px 36px' : '4px 12px 4px 36px',
            cursor: canAct ? 'pointer' : 'default',
            opacity: listening ? 0.8 : 1,
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
          {p.hand && listening && <span style={{ fontSize: '0.75rem' }} aria-label="hand raised" title="Hand raised">✋</span>}
          {(p.sources || []).filter(s => SOURCE_ICONS[s]).map(s => (
            <span key={s} style={{ fontSize: '0.7rem' }} aria-label={s.replace('_', ' ')}>{SOURCE_ICONS[s]}</span>
          ))}
          {canAct && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>⋮</span>}
        </div>
        {open && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '2px 12px 6px 64px' }}>
            {stage && listening && actionButton('up', 'BRING UP', () => act(p, 'speaker'))}
            {stage && !listening && p.speaker && actionButton('down', 'TO AUDIENCE', () => act(p, 'audience'))}
            {!listening && actionButton('mute', 'MUTE MIC', () => act(p, 'mute'))}
            {moveTargets.length > 0 && actionButton('move', 'MOVE TO…', () => setMovingFor(movingFor === p.userId ? null : p.userId))}
            {actionButton('disconnect', 'DISCONNECT', () => act(p, 'disconnect'), true)}
          </div>
        )}
        {open && movingFor === p.userId && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '0 12px 8px 64px' }}>
            {moveTargets.map(target => actionButton(target.id, `${target.stage ? '🎤' : '🔊'} ${target.name}`, () => act(p, { moveTo: target })))}
          </div>
        )}
      </div>
    );
  }

  return (
    <CollapsibleSection
      title={`${stage ? '🎤' : '🔊'} ${channel.name}`}
      badge={participants.length ? String(participants.length) : undefined}
      collapsible={false}
      titleColor={connected ? 'var(--accent-teal)' : 'var(--text-primary)'}
      isMobile={isMobile}
      compact
      indent={1}
      menuTitle={`${channel.name} options`}
      menu={menu}
      headerAction={headerAction}
    >
      {onStage.map(renderRow)}
      {stage && audience.length > 0 && (
        <div style={{ padding: '4px 12px 2px 36px', color: 'var(--text-muted)', fontSize: '0.65rem', letterSpacing: '0.05em' }}>
          AUDIENCE · {audience.length}
        </div>
      )}
      {audience.map(renderRow)}
    </CollapsibleSection>
  );
};

export default VoiceChannelSection;
