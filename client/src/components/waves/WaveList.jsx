import React, { useState, useEffect, useMemo, useRef } from 'react';
import { usePullToRefresh } from '../../hooks/usePullToRefresh.js';
import { PRIVACY_LEVELS, NOTIFICATION_BADGE_COLORS, WAVE_DENSITY, DEFAULT_WAVE_DENSITY } from '../../config/constants.js';
import { EMPTY, GHOST_PROTOCOL } from '../../../messages.js';
import { GlowText } from '../ui/SimpleComponents.jsx';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import FloatingMenu from '../ui/FloatingMenu.jsx';
import VoiceChannelSection from './VoiceChannelSection.jsx';
import { T } from '../../config/terminology.js';
import { byPersonalOrder, moveInGroup, moveInList } from '../../utils/listOrder.js';
import { groupWaves, unreadOf, UNCATEGORIZED_ID } from '../../utils/waveGroups.js';
import { plainText } from '../../utils/plainText.js';
import WaveRail, { ContainerTile } from './WaveRail.jsx';

/**
 * ▲ ▼ for reorder mode (v2.121.0). Buttons rather than dragging: a drag on a
 * phone fights the list's own scrolling, and a tap cannot be made by accident
 * while scrolling. A null handler means "already at that end".
 */
const ReorderArrows = ({ onUp, onDown, isMobile, label }) => {
  const style = (enabled) => ({
    background: 'transparent', fontFamily: 'monospace', lineHeight: 1,
    border: `1px solid ${enabled ? 'var(--border-primary)' : 'var(--border-subtle)'}`,
    color: enabled ? 'var(--accent-amber)' : 'var(--text-muted)',
    cursor: enabled ? 'pointer' : 'default',
    fontSize: isMobile ? '0.8rem' : '0.7rem',
    minWidth: isMobile ? '36px' : '24px', minHeight: isMobile ? '32px' : '22px',
    padding: 0, opacity: enabled ? 1 : 0.4,
  });
  return (
    <span style={{ display: 'inline-flex', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
      <button type="button" aria-label={`Move ${label} up`} disabled={!onUp} style={style(!!onUp)}
        onClick={(e) => { e.stopPropagation(); onUp && onUp(); }}>▲</button>
      <button type="button" aria-label={`Move ${label} down`} disabled={!onDown} style={style(!!onDown)}
        onClick={(e) => { e.stopPropagation(); onDown && onDown(); }}>▼</button>
    </span>
  );
};

/** Up/down handlers for item `id` in `ids`, or nulls at the ends. */
const listMoves = (ids, id, apply) => {
  const at = ids.indexOf(id);
  return {
    onUp: at > 0 ? () => { const next = moveInList(ids, id, -1); if (next) apply(next); } : null,
    onDown: at >= 0 && at < ids.length - 1 ? () => { const next = moveInList(ids, id, 1); if (next) apply(next); } : null,
  };
};

// v2.84.1 — one row menu, used by BOTH wave-list layouts.
//
// The categorised and uncategorised lists are separate render paths and only
// the categorised one ever had this menu, so anyone who had not created a
// category saw no ⋮ at all: Pin was unreachable, and Mute (v2.84.0) never
// appeared for them. Extracted rather than copied so the two cannot drift.
/**
 * A Community wave waiting for its owner's review (v2.134.0): it had people
 * who cannot see its channel when narrowing shipped, and keeps the access it
 * had until the owner or an admin decides (Manage community → WAVES TO REVIEW).
 */
const NeedsReview = () => (
  <span title="Waiting for the community's owner to decide who can see it"
    style={{ color: 'var(--accent-orange)', fontSize: '0.6rem', letterSpacing: '0.04em', fontWeight: 400, whiteSpace: 'nowrap' }}>
    REVIEW
  </span>
);

const WaveRowMenu = ({ wave, categories = [], channels: allChannels = [], isOpen, onToggle, onWavePin, onWaveMute, onWaveMove, onWaveFile }) => {
  // A voice channel holds no waves (v2.118.0), so it is not somewhere to file one.
  const channels = allChannels.filter(ch => ch.type !== 'voice');
  const buttonRef = useRef(null);
  return (
  <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
    <button
      ref={buttonRef}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(isOpen ? null : wave.id);
      }}
      title={`Move ${T.wave}`}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--text-dim)',
        cursor: 'pointer',
        fontSize: '0.85rem',
        padding: '0 3px',
        lineHeight: 1,
      }}
    >
      ⋮
    </button>
    {/* Move menu dropdown */}
    {isOpen && (
      <FloatingMenu anchorRef={buttonRef} onClose={() => onToggle(null)} minWidth={150}>
        <div style={{ padding: '4px 0' }}>
          {/* Pin/Unpin option */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              onWavePin(wave.id, !wave.pinned);
              onToggle(null);
            }}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              fontSize: '0.8rem',
              color: 'var(--text-primary)',
              background: 'transparent',
              borderBottom: '1px solid var(--border-subtle)',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            {wave.pinned ? '📌 Unpin' : '📍 Pin to top'}
          </div>
          {/* Mute/Unmute (v2.84.0) — silences notifications for this
              wave without hiding it or clearing its unread count. */}
          {onWaveMute && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onWaveMute(wave.id, !wave.muted);
                onToggle(null);
              }}
              style={{
                padding: '8px 12px', cursor: 'pointer', fontSize: '0.8rem',
                color: wave.muted ? 'var(--accent-amber)' : 'var(--text-primary)',
                background: 'transparent',
                borderBottom: '1px solid var(--border-subtle)',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              {wave.muted ? '🔔 Unmute' : '🔕 Mute notifications'}
            </div>
          )}
          {/* Category options */}
          {categories.map(cat => (
            <div
              key={cat.id}
              onClick={(e) => {
                e.stopPropagation();
                onWaveMove(wave.id, cat.id);
                onToggle(null);
              }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                color: 'var(--text-primary)',
                background: wave.category_id === cat.id ? 'var(--accent-green)20' : 'transparent',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = wave.category_id === cat.id ? 'var(--accent-green)20' : 'transparent'}
            >
              {wave.category_id === cat.id ? '✓ ' : ''}{cat.name}
            </div>
          ))}
          {/* Community channels (v2.99.0).
              A channel is the SHARED version of a category, so it belongs in
              the same menu — this is where people already look to move a wave,
              and a separate screen for it was the thing that made Communities
              feel bolted on. */}
          {channels.length > 0 && (
            <div style={{
              padding: '6px 12px 2px', fontSize: '0.65rem', letterSpacing: '0.08em',
              color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)',
            }}>COMMUNITY CHANNELS</div>
          )}
          {channels.map(ch => (
            <div
              key={ch.id}
              onClick={(e) => {
                e.stopPropagation();
                onWaveFile && onWaveFile(wave, ch);
                onToggle(null);
              }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                color: 'var(--text-primary)',
                background: wave.channelId === ch.id ? 'var(--accent-amber)20' : 'transparent',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = wave.channelId === ch.id ? 'var(--accent-amber)20' : 'transparent'}
              title={`${ch.communityName} — filing a ${T.wave} here does not change who can read it`}
            >
              {wave.channelId === ch.id ? '✓ ' : ''}# {ch.name}
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginLeft: 6 }}>
                {ch.communityName}
              </span>
            </div>
          ))}
          {wave.channelId && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onWaveFile && onWaveFile(wave, null);
                onToggle(null);
              }}
              style={{
                padding: '8px 12px', cursor: 'pointer', fontSize: '0.8rem',
                color: 'var(--text-primary)', background: 'transparent',
                borderTop: '1px solid var(--border-subtle)',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              Remove from channel
            </div>
          )}

          {/* Uncategorized option */}
          {wave.category_id && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onWaveMove(wave.id, null);
                onToggle(null);
              }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '0.8rem',
                color: 'var(--text-primary)',
                background: 'transparent',
                borderTop: '1px solid var(--border-subtle)',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              Remove from category
            </div>
          )}
        </div>
      </FloatingMenu>
    )}
  </div>
  );
};

/**
 * A Community in the home panel (v2.125.0): its logo or initials, its name, its
 * unread total and 🔊 while anyone is in one of its voice channels. A tap opens
 * its panel; the ⋮ holds the same actions its header used to.
 */
const CommunityRow = ({ community, unread = 0, inVoice = false, density, isMobile, controls, onOpen, menu }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const name = plainText(community.name || '');
  const tileSize = parseFloat(density.fontSize) >= 0.95 ? 32 : parseFloat(density.fontSize) <= 0.8 ? 22 : 26;
  return (
    <div
      role="button"
      tabIndex={onOpen ? 0 : -1}
      aria-label={`Open ${name}${unread ? `, ${unread} unread` : ''}`}
      onClick={onOpen || undefined}
      onKeyDown={(e) => { if (onOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: density.padding, paddingLeft: '0.75rem',
        borderBottom: '1px solid var(--bg-hover)', borderLeft: '3px solid transparent',
        cursor: onOpen ? 'pointer' : 'default',
      }}
    >
      <ContainerTile name={community.name} logoUrl={community.logoUrl} size={tileSize} />
      <span style={{
        flex: 1, minWidth: 0, color: 'var(--text-primary)', fontSize: density.fontSize, fontWeight: 600,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{name}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
        {inVoice && <span title="People are in voice" aria-label="people in voice" style={{ fontSize: '0.75rem' }}>🔊</span>}
        {unread > 0 && (
          <span style={{
            minWidth: '18px', height: '18px', padding: '0 5px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent-amber)', color: 'var(--bg-base)', fontSize: '0.65rem', fontWeight: 700,
            fontFamily: 'monospace', borderRadius: '9px', lineHeight: 1,
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
        {controls}
        {!controls && menu && menu.length > 0 && (
          <span style={{ position: 'relative' }}>
            <button
              ref={menuButtonRef}
              title={`${name} options`}
              onClick={() => setMenuOpen(o => !o)}
              style={{
                background: menuOpen ? 'var(--bg-hover)' : 'transparent', border: 'none',
                color: menuOpen ? 'var(--accent-amber)' : 'var(--text-dim)', cursor: 'pointer',
                fontFamily: 'monospace', fontSize: '0.9rem', padding: isMobile ? '4px 8px' : '0 4px', lineHeight: 1,
              }}
            >⋮</button>
            {menuOpen && (
              <FloatingMenu anchorRef={menuButtonRef} onClose={() => setMenuOpen(false)}>
                  {menu.map((item, i) => (
                    <button
                      key={item.label}
                      onClick={() => { setMenuOpen(false); item.onClick(); }}
                      style={{
                        display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none',
                        borderBottom: i < menu.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                        color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                        fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'nowrap',
                      }}
                    >{item.label}</button>
                  ))}
              </FloatingMenu>
            )}
          </span>
        )}
        {!controls && onOpen && <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>›</span>}
      </span>
    </div>
  );
};

const WaveCategoryList = ({ show = 'all', communityId = null, categoryId = null, communities = [], onOpenContainer, reorder = null, waves, categories, channels = [], selectedWave, onSelectWave, onCategoryToggle, onWaveMove, onWaveFile, onWavePin, onWaveMute, onManageCommunity, onManageCategories, onNewWaveIn, isMobile, waveNotifications = {}, activeCalls = {}, density = DEFAULT_WAVE_DENSITY, scrollRef, voice = {} }) => {
  const densityStyle = WAVE_DENSITY[density] || WAVE_DENSITY[DEFAULT_WAVE_DENSITY];
  const [draggedWave, setDraggedWave] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const [moveMenuOpen, setMoveMenuOpen] = useState(null); // Track which wave's move menu is open

  // Close move menu when clicking outside
  useEffect(() => {
    if (!moveMenuOpen) return;

    const handleClickOutside = () => setMoveMenuOpen(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [moveMenuOpen]);

  // Group waves by category
  // Channels arrive flat; the sidebar shows them under their community.
  const communityGroups = useMemo(() => {
    const byCommunity = new Map();
    for (const ch of channels) {
      if (!byCommunity.has(ch.communityId)) {
        byCommunity.set(ch.communityId, {
          communityId: ch.communityId, communityName: ch.communityName, channels: [],
          canManageChannels: ch.canManageChannels === true,
        });
      }
      byCommunity.get(ch.communityId).channels.push(ch);
    }
    return [...byCommunity.values()];
  }, [channels]);

  /**
   * Collapse state, per viewer, in localStorage.
   *
   * Personal categories persist this server-side on the category row. Channels
   * have no such column and it is not worth one: which groups someone folds
   * away is a convenience local to the browser they are sitting at, and a
   * failure to read it back should cost nothing.
   */
  const [collapsedKeys, setCollapsedKeys] = useState(() => {
    try { return JSON.parse(localStorage.getItem('farhold_community_collapsed') || '{}'); }
    catch { return {}; }
  });
  const toggleCollapsed = (key) => {
    setCollapsedKeys(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('farhold_community_collapsed', JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };

  const groupedWaves = useMemo(() => groupWaves(waves, categories, channels), [waves, categories, channels]);

  const getGroupUnreadCount = (wavesInGroup) => unreadOf(wavesInGroup, waveNotifications);

  // Render a single wave item
  // `move` ({ onUp, onDown }) puts the row in reorder mode: ▲ ▼ instead of the
  // menu, and a tap no longer opens the wave, so a missed arrow is harmless.
  // `indent` is the nesting level, on the same 0.75rem steps as the section
  // headers: a wave in a channel (2) sits inside its channel (1), not level
  // with the Community heading.
  const renderWaveItem = (wave, showPinButton = false, move = null, indent = 0) => {
    const config = PRIVACY_LEVELS[wave.privacy] || PRIVACY_LEVELS.private;
    const isSelected = selectedWave?.id === wave.id;
    const notifInfo = waveNotifications[wave.id];
    const notifCount = notifInfo?.count || 0;
    const notifType = notifInfo?.highestType || 'wave_activity';
    const badgeStyle = NOTIFICATION_BADGE_COLORS[notifType] || NOTIFICATION_BADGE_COLORS.wave_activity;
    const showNotificationBadge = notifCount > 0;
    const showUnreadBadge = !showNotificationBadge && wave.unread_count > 0;
    const callInfo = activeCalls[wave.id];
    const hasActiveCall = callInfo && callInfo.participantCount > 0;

    return (
      <div
        key={wave.id}
        draggable={!isMobile && !move}
        onDragStart={(e) => {
          if (isMobile || move) return;
          setDraggedWave(wave);
          e.dataTransfer.effectAllowed = 'move';
          e.currentTarget.style.opacity = '0.5';
        }}
        onDragEnd={(e) => {
          if (isMobile) return;
          e.currentTarget.style.opacity = '1';
          setDraggedWave(null);
          setDropTarget(null);
        }}
        onClick={(e) => {
          if (move) return;
          if (e.ctrlKey || e.metaKey) {
            onSelectWave(wave, { background: true });
          } else {
            onSelectWave(wave);
          }
        }}
        onAuxClick={(e) => {
          if (move) return;
          if (e.button === 1) {
            e.preventDefault();
            onSelectWave(wave, { background: true });
          }
        }}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.background = 'transparent';
        }}
        style={{
          padding: densityStyle.padding,
          // On the headers' rem steps; a nested row gives back the 3px
          // unread/selected bar so its title lines up on the step.
          paddingLeft: indent ? `calc(${0.75 + indent * 0.75}rem - 3px)` : '0.75rem',
          cursor: move ? 'default' : (isMobile ? 'pointer' : 'move'),
          background: isSelected ? 'var(--accent-amber)10' : (showNotificationBadge ? `${badgeStyle.bg}08` : 'transparent'),
          borderBottom: '1px solid var(--bg-hover)',
          borderLeft: `3px solid ${showNotificationBadge ? badgeStyle.bg : (isSelected ? config.color : 'transparent')}`,
          transition: 'background 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: 'var(--text-primary)', fontSize: densityStyle.fontSize, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
            {wave.is_archived && '📦 '}
            {showPinButton && wave.pinned && '📌 '}
            {wave.title}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
            {/* Beside the title, not in it: a long title's ellipsis would hide it. */}
            {wave.reviewState === 'needs_review' && <NeedsReview />}
            {showNotificationBadge && (
              <span style={{
                background: badgeStyle.bg,
                color: '#000',
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '10px',
                boxShadow: `0 0 8px ${badgeStyle.shadow}`,
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
              }}>
                {badgeStyle.icon && <span style={{ fontSize: '0.7rem' }}>{badgeStyle.icon}</span>}
                {notifCount}
              </span>
            )}
            {showUnreadBadge && (
              <span style={{
                background: 'var(--accent-orange)',
                color: '#fff',
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '10px',
                boxShadow: '0 0 8px var(--glow-orange)',
              }}>{wave.unread_count}</span>
            )}
            {hasActiveCall && (
              <span style={{
                background: 'var(--accent-green)',
                color: '#000',
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: '10px',
                boxShadow: '0 0 8px var(--glow-green)',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
              }}>
                📞 {callInfo.participantCount}
              </span>
            )}
            {move ? (
              <ReorderArrows onUp={move.onUp} onDown={move.onDown} isMobile={isMobile} label={wave.title} />
            ) : (
              <WaveRowMenu
                wave={wave}
                categories={categories}
                channels={channels}
                onWaveFile={onWaveFile}
                isOpen={moveMenuOpen === wave.id}
                onToggle={setMoveMenuOpen}
                onWavePin={onWavePin}
                onWaveMute={onWaveMute}
                onWaveMove={onWaveMove}
              />
            )}
            <span style={{ color: config.color, fontSize: '0.7rem', lineHeight: 1 }}>{config.icon}</span>
          </div>
        </div>
      </div>
    );
  };

  // Reorder mode (v2.121.0). In the WAVES section the person arranges their
  // own waves and categories; in COMMUNITIES they arrange their Communities,
  // and — where they may manage channels — the channels and the waves in them,
  // for everyone.
  // The personal half of the list: PINNED, categories, UNCATEGORIZED.
  const homeWaves = show === 'waves' || show === 'all';
  const arrangingOwn = reorder?.mode === 'waves';
  const arrangingCommunities = reorder?.mode === 'communities';
  const personalMove = (wave, group) => {
    if (!arrangingOwn) return null;
    const ids = group.map(w => w.id);
    const at = ids.indexOf(wave.id);
    const go = (dir) => () => {
      const next = moveInGroup(reorder.allWaveIds, ids, wave.id, dir);
      if (next) reorder.onWaves(next);
    };
    return { onUp: at > 0 ? go(-1) : null, onDown: at < ids.length - 1 ? go(1) : null };
  };
  const channelWaveMove = (wave, group, channel) => {
    if (!arrangingCommunities || !channel.canManage) return null;
    return listMoves(group.map(w => w.id), wave.id,
      (ids) => reorder.onChannelWaves(channel.communityId, channel.id, ids));
  };
  const arrows = (moves, label) => moves
    ? <ReorderArrows onUp={moves.onUp} onDown={moves.onDown} isMobile={isMobile} label={label} />
    : undefined;

  // Render drop zone for category
  const renderDropZone = (categoryId, categoryName) => {
    if (isMobile || !draggedWave) return null;

    const isOver = dropTarget === categoryId;

    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropTarget(categoryId);
        }}
        onDragLeave={() => {
          setDropTarget(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (draggedWave) {
            onWaveMove(draggedWave.id, categoryId);
          }
          setDropTarget(null);
        }}
        style={{
          padding: '8px',
          margin: '4px 8px',
          background: isOver ? 'var(--accent-green)20' : 'transparent',
          border: isOver ? '2px dashed var(--accent-green)' : '2px dashed transparent',
          borderRadius: '4px',
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          textAlign: 'center',
          transition: 'all 0.2s ease',
        }}
      >
        {isOver ? `Drop to move to ${categoryName}` : ''}
      </div>
    );
  };

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
      {/* Pinned Section */}
      {homeWaves && groupedWaves.pinned.length > 0 && (
        <div style={{ marginBottom: '1px' }}>
          <CollapsibleSection
            title="PINNED"
            badge={groupedWaves.pinned.length.toString()}
            unreadCount={getGroupUnreadCount(groupedWaves.pinned)}
            defaultOpen={true}
            titleColor="var(--accent-amber)"
            accentColor="var(--accent-amber)"
            isMobile={isMobile}
            compact
            titleSize={densityStyle.headingSize}
          >
            {renderDropZone('__pinned__', 'Pinned')}
            {groupedWaves.pinned.map(wave => renderWaveItem(wave, true, personalMove(wave, groupedWaves.pinned)))}
          </CollapsibleSection>
        </div>
      )}

      {/* One Community's channels, in its own panel (v2.125.0). The panel
          header names the Community, so its channels start at the left edge
          and their waves sit one step in. */}
      {show === 'community' && (() => {
        const group = communityGroups.find(g => g.communityId === communityId)
          || { communityId, channels: [], canManageChannels: false };
        const base = 0;
        const channelIds = group.channels.map(ch => ch.id);
        const channelMoves = (channel) => arrangingCommunities && group.canManageChannels
          ? listMoves(channelIds, channel.id, (ids) => reorder.onChannels(group.communityId, ids))
          : null;
        return (
          <div style={{ marginBottom: '1px' }}>
            {group.channels.length === 0 && (
              <div style={{ padding: `10px 12px 10px ${0.75 + base * 0.75}rem`, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                No channels yet
              </div>
            )}
            {group.channels.map(channel => {
              if (channel.type === 'voice') {
                return (
                  <VoiceChannelSection
                    key={channel.id}
                    channel={channel}
                    participants={voice.presence?.[channel.id] || []}
                    stage={voice.stage?.[channel.id] ?? channel.stage === true}
                    // Where a moderator can move someone: this Community's other voice channels.
                    moveTargets={group.channels.filter(ch => ch.type === 'voice' && ch.id !== channel.id)}
                    isMobile={isMobile}
                    connected={voice.currentChannelId === channel.id}
                    connecting={voice.connecting}
                    canModerate={voice.canModerate}
                    myUserId={voice.myUserId}
                    onJoin={voice.onJoin}
                    onLeave={voice.onLeave}
                    onModerate={voice.onModerate}
                    reorderControls={arrows(channelMoves(channel), channel.name) || null}
                    titleSize={densityStyle.fontSize}
                    indent={base}
                    menu={onManageCommunity ? [
                      { label: '✎ Rename Channel', onClick: () => onManageCommunity(channel, 'channels') },
                      { label: '⚙ Manage Community', onClick: () => onManageCommunity(channel) },
                    ] : undefined}
                  />
                );
              }
              const chWaves = groupedWaves.byChannel[channel.id] || [];
              return (
                <CollapsibleSection
                  key={channel.id}
                  title={`# ${channel.name}`}
                  badge={chWaves.length.toString()}
                  unreadCount={getGroupUnreadCount(groupedWaves.allByChannel[channel.id] || [])}
                  headerAction={arrows(channelMoves(channel), channel.name)}
                  isOpen={!collapsedKeys[`ch:${channel.id}`]}
                  onToggle={() => toggleCollapsed(`ch:${channel.id}`)}
                  titleColor="var(--text-primary)"
                  isMobile={isMobile}
                  compact
                  titleSize={densityStyle.fontSize}
                  indent={base}
                  menuTitle={`#${channel.name} options`}
                  menu={reorder?.mode ? undefined : [
                    ...(onNewWaveIn ? [{
                      label: `+ New ${T.Wave} Here`,
                      onClick: () => onNewWaveIn({ channelId: channel.id, label: `#${channel.name}` }),
                    }] : []),
                    ...(onManageCommunity ? [
                      { label: '✎ Rename Channel', onClick: () => onManageCommunity(channel, 'channels') },
                      { label: '⚙ Manage Community', onClick: () => onManageCommunity(channel) },
                    ] : []),
                  ]}
                >
                  {chWaves.length === 0 ? (
                    <div style={{ padding: `8px 12px 8px ${0.75 + (base + 1) * 0.75}rem`, color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                      No {T.waves} filed here yet
                    </div>
                  ) : (
                    chWaves.map(wave => renderWaveItem(wave, true, channelWaveMove(wave, chWaves, channel), base + 1))
                  )}
                </CollapsibleSection>
              );
            })}
          </div>
        );
      })()}

      {/* The home panel's COMMUNITIES (v2.125.0): one row per Community. Its
          channels live in its own panel. */}
      {show === 'communityRows' && communities.map(c => {
        const group = communityGroups.find(g => g.communityId === c.id) || { channels: [] };
        const unread = getGroupUnreadCount(group.channels.flatMap(ch => groupedWaves.allByChannel[ch.id] || []));
        const inVoice = group.channels.some(ch => ch.type === 'voice' && (voice.presence?.[ch.id] || []).length > 0);
        const moves = arrangingCommunities
          ? listMoves(communities.map(x => x.id), c.id, reorder.onCommunities)
          : null;
        return (
          <CommunityRow
            key={c.id}
            community={c}
            unread={unread}
            inVoice={inVoice}
            density={densityStyle}
            isMobile={isMobile}
            controls={arrows(moves, plainText(c.name || ''))}
            onOpen={moves ? null : () => onOpenContainer?.({ kind: 'community', id: c.id })}
            menu={onManageCommunity && !reorder?.mode ? [
              { label: '+ New Channel', onClick: () => onManageCommunity({ communityId: c.id }, 'channels') },
              { label: '👤 Invite People', onClick: () => onManageCommunity({ communityId: c.id }, 'invites') },
              { label: '⚙ Manage Community', onClick: () => onManageCommunity({ communityId: c.id }) },
            ] : undefined}
          />
        );
      })}

      {/* One category's waves, in its own panel (v2.125.0). */}
      {show === 'category' && (() => {
        const list = categoryId === UNCATEGORIZED_ID ? groupedWaves.uncategorized : (groupedWaves.categorized[categoryId] || []);
        return list.length === 0 ? (
          <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
            No {T.waves} in this category
          </div>
        ) : list.map(wave => renderWaveItem(wave, true, personalMove(wave, list)));
      })()}

      {/* Category Sections */}
      {homeWaves && categories.map(category => {
        const categoryWaves = groupedWaves.categorized[category.id] || [];
        const unreadCount = getGroupUnreadCount(categoryWaves);
        const categoryMoves = arrangingOwn
          ? listMoves(categories.map(c => c.id), category.id, reorder.onCategories)
          : null;

        return (
          <div key={category.id} style={{ marginBottom: '1px' }}>
            <CollapsibleSection
              title={category.name.toUpperCase()}
              badge={categoryWaves.length.toString()}
              unreadCount={unreadCount}
              isOpen={!category.collapsed}
              onToggle={() => onCategoryToggle(category.id, !category.collapsed)}
              titleColor={category.color}
              accentColor={category.color}
              isMobile={isMobile}
              compact
              titleSize={densityStyle.headingSize}
              headerAction={arrows(categoryMoves, category.name)}
              menuTitle={`${category.name} options`}
              menu={reorder?.mode ? undefined : [
                // Desktop opens a category beside the rail (v2.125.0); a phone
                // folds it in place, because there is no rail to come back by.
                ...(onOpenContainer && !isMobile ? [{
                  label: '▣ Open in Panel', onClick: () => onOpenContainer({ kind: 'category', id: category.id }),
                }] : []),
                ...(onNewWaveIn ? [{
                  label: `+ New ${T.Wave} Here`,
                  onClick: () => onNewWaveIn({ categoryId: category.id, label: category.name }),
                }] : []),
                ...(onManageCategories ? [{
                  label: '⚙ Manage Categories', onClick: onManageCategories,
                }] : []),
              ]}
            >
              {renderDropZone(category.id, category.name)}
              {categoryWaves.length === 0 ? (
                <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                  No {T.waves} in this category
                </div>
              ) : (
                categoryWaves.map(wave => renderWaveItem(wave, true, personalMove(wave, categoryWaves)))
              )}
            </CollapsibleSection>
          </div>
        );
      })}

      {/* Uncategorized Section */}
      {homeWaves && groupedWaves.uncategorized.length > 0 && (
        <div style={{ marginBottom: '1px' }}>
          <CollapsibleSection
            title="UNCATEGORIZED"
            menuTitle="Uncategorized options"
            menu={onOpenContainer && !isMobile && !reorder?.mode ? [{
              label: '▣ Open in Panel', onClick: () => onOpenContainer({ kind: 'category', id: UNCATEGORIZED_ID }),
            }] : undefined}
            badge={groupedWaves.uncategorized.length.toString()}
            unreadCount={getGroupUnreadCount(groupedWaves.uncategorized)}
            defaultOpen={true}
            titleColor="var(--text-dim)"
            accentColor="var(--border-primary)"
            isMobile={isMobile}
            compact
            titleSize={densityStyle.headingSize}
          >
            {renderDropZone(null, 'Uncategorized')}
            {groupedWaves.uncategorized.map(wave => renderWaveItem(wave, true, personalMove(wave, groupedWaves.uncategorized)))}
          </CollapsibleSection>
        </div>
      )}

      {/* Empty State */}
      {homeWaves && waves.length === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {EMPTY.noWavesCreate}
        </div>
      )}
    </div>
  );
};


/**
 * Invitations into other people's waves (v2.130.0), at the top of the list.
 *
 * All an invitee is shown before accepting: who asked, the title and who is
 * already in it. Accept opens the wave; Decline answers quietly; Decline and
 * block also stops that person asking again, and they are not told which.
 */
const WaveInvitations = ({ invitations, onAccept, onDecline, isMobile, density }) => {
  const [busy, setBusy] = React.useState(null);
  const [confirmBlock, setConfirmBlock] = React.useState(null);
  const act = async (id, fn) => { setBusy(id); try { await fn(); } finally { setBusy(null); } };
  const button = (primary) => ({
    padding: isMobile ? '7px 12px' : '4px 10px', cursor: 'pointer', fontFamily: 'monospace',
    fontSize: isMobile ? '0.8rem' : '0.7rem',
    background: primary ? 'var(--accent-amber)' : 'transparent',
    color: primary ? 'var(--bg-base)' : 'var(--text-secondary)',
    border: `1px solid ${primary ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
  });
  return (
    <div role="region" aria-label="Invitations" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)' }}>
      <div style={{ padding: '8px 12px 4px', color: 'var(--accent-amber)', fontFamily: 'monospace', fontSize: density?.headingSize || '0.75rem', letterSpacing: '0.05em' }}>
        INVITATIONS {invitations.length}
      </div>
      {invitations.map(inv => {
        const who = plainText(inv.invitedBy?.displayName || inv.invitedBy?.handle || 'Someone');
        // v2.134.0: an invitation to join a Community, sent when its owner
        // kept a conversation you were in for the Community.
        if (inv.kind === 'community') {
          return (
            <div key={inv.id} style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ color: 'var(--text-primary)', fontSize: density?.fontSize || '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {plainText(inv.communityName || 'A community')}
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', margin: '2px 0 6px' }}>
                {who} invited you to join this community, so you keep a {T.wave} you're in.
              </div>
              {confirmBlock === inv.id ? (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>Block {who}?</span>
                  <button disabled={busy === inv.id} style={button(true)} onClick={() => act(inv.id, () => onDecline?.(inv, { block: true }))}>BLOCK</button>
                  <button style={button(false)} onClick={() => setConfirmBlock(null)}>CANCEL</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button disabled={busy === inv.id} style={button(true)} onClick={() => act(inv.id, () => onAccept?.(inv))}>JOIN</button>
                  <button disabled={busy === inv.id} style={button(false)} onClick={() => act(inv.id, () => onDecline?.(inv))}>DECLINE</button>
                  <button disabled={busy === inv.id} style={button(false)} onClick={() => setConfirmBlock(inv.id)}>DECLINE &amp; BLOCK</button>
                </div>
              )}
            </div>
          );
        }
        // The inviter is already named; "with" lists everyone else in it.
        const rest = (inv.members || []).filter(m => m.id !== inv.invitedBy?.id);
        const others = rest.map(m => plainText(m.name || m.handle || '')).filter(Boolean);
        const inviterCounted = (inv.members || []).length !== rest.length ? 1 : 0;
        const more = Math.max(0, (inv.memberCount || 0) - inviterCounted - others.length);
        return (
          <div key={inv.id} style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ color: 'var(--text-primary)', fontSize: density?.fontSize || '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {inv.encrypted ? '🔒 ' : ''}{plainText(inv.waveTitle || '')}
            </div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', margin: '2px 0 6px' }}>
              {who} invited you{others.length ? ` · with ${others.join(', ')}${more ? ` +${more}` : ''}` : ''}
              {/* v2.132.0: accepting joins the group, and so every wave of it. */}
              {inv.group?.waveCount > 1 && (
                <div style={{ marginTop: '2px' }}>Joins {plainText(inv.group.name || '')}: {inv.group.waveCount} {T.waves}</div>
              )}
            </div>
            {confirmBlock === inv.id ? (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>Block {who}? They won't be able to invite you again.</span>
                <button disabled={busy === inv.id} style={button(true)} onClick={() => act(inv.id, () => onDecline?.(inv, { block: true }))}>BLOCK</button>
                <button style={button(false)} onClick={() => setConfirmBlock(null)}>CANCEL</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button disabled={busy === inv.id} style={button(true)} onClick={() => act(inv.id, () => onAccept?.(inv))}>ACCEPT</button>
                <button disabled={busy === inv.id} style={button(false)} onClick={() => act(inv.id, () => onDecline?.(inv))}>DECLINE</button>
                <button disabled={busy === inv.id} style={button(false)} onClick={() => setConfirmBlock(inv.id)}>DECLINE &amp; BLOCK</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/** A header button that opens a short menu: the list's + and ⋮ (v2.126.0). */
const HeaderMenu = ({ glyph, title, items, isMobile, buttonStyle }) => {
  const [open, setOpen] = React.useState(false);
  const buttonRef = useRef(null);
  return (
    <div style={{ position: 'relative' }}>
      <button ref={buttonRef} onClick={() => setOpen(o => !o)} title={title} aria-label={title} aria-expanded={open} style={buttonStyle(open)}>{glyph}</button>
      {open && (
        <FloatingMenu anchorRef={buttonRef} onClose={() => setOpen(false)} minWidth={190}>
            {items.map((item, i) => (
              <button
                key={item.label}
                role="menuitem"
                onClick={() => { setOpen(false); item.onClick(); }}
                style={{
                  display: 'block', width: '100%', padding: '9px 12px',
                  background: 'transparent', border: 'none',
                  borderBottom: i < items.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  color: item.color || 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'monospace', fontSize: isMobile ? '0.9rem' : '0.75rem', whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >{item.label}</button>
            ))}
        </FloatingMenu>
      )}
    </div>
  );
};

/**
 * The list's header (one since v2.126.0; COMMUNITIES and WAVES before).
 *
 * It carries a pair of affordances that mean different things on
 * purpose — **+ creates, ⋮ manages**. Keeping creation out of the menu is what
 * makes that readable at a glance; a menu whose first item is "New…" trains
 * people to open it for everything.
 */
const ListSectionHeader = ({ title, titleColor, onCreate, createMenu = null, createTitle, menu, menuTitle, isMobile, collapsed, onToggleCollapse, unreadCount = 0, onDone = null }) => {
  const iconButton = (active) => ({
    padding: isMobile ? '8px 10px' : '4px 7px',
    background: active ? 'var(--bg-hover)' : 'transparent',
    border: `1px solid ${active ? 'var(--border-primary)' : 'var(--border-subtle)'}`,
    color: active ? 'var(--accent-amber)' : 'var(--text-dim)',
    cursor: 'pointer', fontFamily: 'monospace',
    fontSize: isMobile ? '1rem' : '0.9rem', lineHeight: 1,
  });

  return (
    <div style={{
      padding: isMobile ? '10px 12px' : '8px 12px',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px',
    }}>
      {/* The title is the toggle, matching every other collapsible group in
          this list. The buttons beside it stop propagation, so acting on a
          section never also folds it. */}
      <div
        onClick={onToggleCollapse}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0,
          cursor: onToggleCollapse ? 'pointer' : 'default', userSelect: 'none', flex: 1,
        }}
      >
        <GlowText color={titleColor || 'var(--accent-amber)'} size={isMobile ? '1rem' : '0.9rem'}>{title}</GlowText>
        {onToggleCollapse && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontFamily: 'monospace' }}>
            {collapsed ? '▸' : '▾'}
          </span>
        )}
        {/* Always shown since v2.121.0, open or folded: the total is the quickest
            way to see that something in the section wants reading. */}
        {unreadCount > 0 && (
          <span title={`${unreadCount} unread`} style={{
            minWidth: '18px', height: '18px', padding: '0 5px',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: titleColor || 'var(--accent-amber)', color: 'var(--bg-base)',
            fontSize: '0.65rem', fontWeight: 700, fontFamily: 'monospace',
            borderRadius: '9px', lineHeight: 1, flexShrink: 0,
          }}>{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} onClick={(e) => e.stopPropagation()}>
        {/* Reorder mode (v2.121.0) replaces + and ⋮ with one way out. */}
        {onDone && (
          <button onClick={onDone} title="Finish reordering" style={{ ...iconButton(true), fontSize: isMobile ? '0.8rem' : '0.7rem' }}>DONE</button>
        )}
        {!onDone && onCreate && (
          <button onClick={onCreate} title={createTitle} style={iconButton(false)}>+</button>
        )}
        {!onDone && createMenu && createMenu.length > 0 && (
          <HeaderMenu glyph="+" title={createTitle} items={createMenu} isMobile={isMobile} buttonStyle={iconButton} />
        )}
        {!onDone && menu && menu.length > 0 && (
          <HeaderMenu glyph="⋮" title={menuTitle} items={menu} isMobile={isMobile} buttonStyle={iconButton} />
        )}
      </div>
    </div>
  );
};

/** The ⋮ in a panel header (v2.125.0). */
const PanelMenu = ({ items, title, isMobile }) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  return (
    <div style={{ position: 'relative' }}>
      <button ref={buttonRef} onClick={() => setOpen(o => !o)} title={title} style={{
        padding: isMobile ? '8px 10px' : '4px 7px',
        background: open ? 'var(--bg-hover)' : 'transparent',
        border: `1px solid ${open ? 'var(--border-primary)' : 'var(--border-subtle)'}`,
        color: open ? 'var(--accent-amber)' : 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace',
        fontSize: isMobile ? '1rem' : '0.9rem', lineHeight: 1,
      }}>⋮</button>
      {open && (
        <FloatingMenu anchorRef={buttonRef} onClose={() => setOpen(false)} minWidth={190}>
            {items.map((item, i) => (
              <button key={item.label} onClick={() => { setOpen(false); item.onClick(); }} style={{
                display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none',
                borderBottom: i < items.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left',
                fontFamily: 'monospace', fontSize: isMobile ? '0.9rem' : '0.75rem', whiteSpace: 'nowrap',
              }}>{item.label}</button>
            ))}
        </FloatingMenu>
      )}
    </div>
  );
};

const WaveList = ({ waveInvitations = [], onAcceptInvitation, onDeclineInvitation, categories = [], channels = [], selectedWave, onSelectWave, onNewWave, showArchived, onToggleArchived, isMobile, waveNotifications = {}, activeCalls = {}, onCategoryToggle, onWaveMove, onWaveFile, onWavePin, onWaveMute, onManageCategories, onManageCommunities, onManageCommunity, onNewWaveIn, communitiesEnabled = false, ghostMode = false, onToggleGhostProtocol, density = DEFAULT_WAVE_DENSITY, onRefresh,
  voicePresence = {}, voiceStage = {}, currentVoiceChannelId = null, voiceConnecting = false, canModerateVoice = false, onJoinVoice = null, onLeaveVoice, onModerateVoice, myUserId,
  onReorderWaves, onReorderCommunities, onReorderChannels, onReorderChannelWaves, onReorderCategories, waves: unorderedWaves,
  communities = [], openContainer = null, onOpenContainer = null }) => {
  // Kept in the order people gave it (v2.121.0), not by last activity: a wave
  // no longer jumps to the top whenever somebody posts in it.
  const waves = useMemo(() => [...(unorderedWaves || [])].sort(byPersonalOrder), [unorderedWaves]);
  // Voice channels (v2.118.0), bundled so the two category lists get one prop.
  const voice = useMemo(() => ({
    presence: voicePresence, stage: voiceStage, currentChannelId: currentVoiceChannelId, connecting: voiceConnecting,
    canModerate: canModerateVoice, onJoin: onJoinVoice, onLeave: onLeaveVoice, onModerate: onModerateVoice, myUserId,
  }), [voicePresence, voiceStage, currentVoiceChannelId, voiceConnecting, canModerateVoice, onJoinVoice, onLeaveVoice, onModerateVoice, myUserId]);
  // Pull down at the top of the list to reload it (v2.77.0). Additive: the list
  // already refreshes itself on websocket events; this is for the moments when
  // someone wants to be sure.
  const listScrollRef = useRef(null);
  const { pullDistance, refreshing } = usePullToRefresh(
    listScrollRef,
    () => onRefresh?.(),
    { enabled: isMobile && !!onRefresh }
  );
  const densityStyle = WAVE_DENSITY[density] || WAVE_DENSITY[DEFAULT_WAVE_DENSITY];
  // v2.84.1 — the uncategorised list needs its own row-menu state; the
  // categorised list keeps its copy inside WaveCategoryList.
  const [rowMenuOpen, setRowMenuOpen] = React.useState(null);

  /**
   * Whether the two top-level sections are folded away, per viewer.
   *
   * Same reasoning as the community and channel groups: which sections
   * somebody folds is local to the browser they are sitting at, and a failure
   * to read it back should cost nothing — so every access is wrapped, and an
   * unreadable store simply means everything is open.
   */
  const [sectionCollapsed, setSectionCollapsed] = React.useState(() => {
    try { return JSON.parse(localStorage.getItem('farhold_list_sections') || '{}'); }
    catch { return {}; }
  });
  const toggleSection = (key) => {
    setSectionCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem('farhold_list_sections', JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };

  const shownCommunities = communitiesEnabled ? communities : [];

  /**
   * The unread total on the list's header (v2.126.0: one header for the whole
   * list). Every wave counts once — a pinned channel wave is listed twice, under
   * PINNED and inside its Community, but it is one wave to read. The per-wave
   * count is the same one the group badges use.
   */
  const sectionUnread = useMemo(() => waves.reduce(
    (total, wave) => total + (waveNotifications[wave.id]?.count || wave.unread_count || 0), 0,
  ), [waves, waveNotifications]);

  // + on the header: straight to a new wave, or — with Communities on — a
  // short menu, because there is more than one thing to create or join.
  const createMenu = communitiesEnabled && onManageCommunities ? [
    ...(onNewWave ? [{ label: `+ New ${T.Wave}`, onClick: onNewWave }] : []),
    { label: '+ New Community', onClick: () => onManageCommunities('create') },
    { label: '🔍 Browse Public Communities', onClick: () => onManageCommunities('browse') },
    { label: '🔗 Join With A Code', onClick: () => onManageCommunities('join') },
  ] : null;

  // Which section is being rearranged, if either (v2.121.0). Not offered for
  // the archived or hidden lists: they hold only some of someone's waves, and
  // the order is saved for the whole list.
  const [reorderMode, setReorderMode] = React.useState(null);
  const canReorder = !showArchived && !ghostMode;
  useEffect(() => { if (!canReorder) setReorderMode(null); }, [canReorder]);
  // Opening or closing a panel (from the rail, say) ends any rearranging: the
  // mode belongs to the list it was started in.
  useEffect(() => { setReorderMode(null); }, [openContainer?.kind, openContainer?.id]);
  const reorder = useMemo(() => reorderMode ? ({
    mode: reorderMode,
    allWaveIds: waves.map(w => w.id),
    onWaves: (ids) => onReorderWaves?.(ids),
    onCommunities: (ids) => onReorderCommunities?.(ids),
    onChannels: (communityId, ids) => onReorderChannels?.(communityId, ids),
    onChannelWaves: (communityId, channelId, ids) => onReorderChannelWaves?.(communityId, channelId, ids),
    onCategories: (ids) => onReorderCategories?.(ids),
  }) : null, [reorderMode, waves, onReorderWaves, onReorderCommunities, onReorderChannels, onReorderChannelWaves, onReorderCategories]);
  // One Reorder for the home list (v2.126.0): Communities move among
  // Communities and waves among waves, each saved in the order it already had
  // ('communities' and 'waves' in user_list_order). Communities stay on top.
  const reorderItem = () => canReorder && (onReorderWaves || onReorderCommunities)
    ? [{ label: '↕ Reorder', onClick: () => {
        setReorderMode('home');
        // Nothing to arrange in a folded list.
        if (sectionCollapsed.waves) toggleSection('waves');
      } }]
    : [];

  // ----- An open Community or category (v2.125.0) -----
  const openCommunity = openContainer?.kind === 'community'
    ? communities.find(c => c.id === openContainer.id) : null;
  const openCategory = openContainer?.kind === 'category'
    ? (openContainer.id === UNCATEGORIZED_ID
      ? { id: UNCATEGORIZED_ID, name: 'Uncategorized', color: 'var(--text-dim)' }
      : categories.find(c => c.id === openContainer.id))
    : null;

  if (openCommunity || openCategory) {
    const kind = openCommunity ? 'community' : 'category';
    const name = plainText((openCommunity || openCategory).name || '');
    const canArrangeChannels = openCommunity && channels.some(ch => ch.communityId === openCommunity.id && (ch.canManageChannels || ch.canManage));
    const panelMenu = openCommunity ? [
      ...(onManageCommunity ? [
        { label: '+ New Channel', onClick: () => onManageCommunity({ communityId: openCommunity.id }, 'channels') },
        { label: '👤 Invite People', onClick: () => onManageCommunity({ communityId: openCommunity.id }, 'invites') },
        { label: '⚙ Manage Community', onClick: () => onManageCommunity({ communityId: openCommunity.id }) },
      ] : []),
      ...(canReorder && canArrangeChannels ? [{ label: '↕ Reorder', onClick: () => setReorderMode('communities') }] : []),
    ] : [
      ...(onNewWaveIn && openCategory.id !== UNCATEGORIZED_ID ? [{
        label: `+ New ${T.Wave} Here`, onClick: () => onNewWaveIn({ categoryId: openCategory.id, label: name }),
      }] : []),
      ...(onManageCategories ? [{ label: '⚙ Manage Categories', onClick: onManageCategories }] : []),
      ...(canReorder ? [{ label: '↕ Reorder', onClick: () => setReorderMode('waves') }] : []),
    ];
    return (
      <div style={{ width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: isMobile ? '8px 10px' : '6px 10px', borderBottom: '1px solid var(--border-subtle)',
        }}>
          <button
            onClick={() => { setReorderMode(null); onOpenContainer?.(null); }}
            aria-label={`Back to all communities and ${T.waves}`}
            title="Back"
            style={{
              background: 'transparent', border: '1px solid var(--border-subtle)', color: 'var(--accent-amber)',
              cursor: 'pointer', fontFamily: 'monospace', fontSize: isMobile ? '1.1rem' : '1rem', lineHeight: 1,
              padding: isMobile ? '6px 10px' : '3px 8px',
            }}
          >‹</button>
          <ContainerTile
            name={name}
            logoUrl={openCommunity?.logoUrl}
            color={openCommunity ? 'var(--accent-amber)' : (openCategory.color || 'var(--accent-teal)')}
            size={isMobile ? 30 : 26}
          />
          <div title={name} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <GlowText color={openCommunity ? 'var(--accent-amber)' : (openCategory.color || 'var(--accent-teal)')} size={isMobile ? '1rem' : '0.9rem'}>
              {name.toUpperCase()}
            </GlowText>
          </div>
          {reorderMode ? (
            <button onClick={() => setReorderMode(null)} title="Finish reordering" style={{
              padding: isMobile ? '8px 10px' : '4px 7px', background: 'var(--bg-hover)', border: '1px solid var(--border-primary)',
              color: 'var(--accent-amber)', cursor: 'pointer', fontFamily: 'monospace', fontSize: isMobile ? '0.8rem' : '0.7rem',
            }}>DONE</button>
          ) : panelMenu.length > 0 && (
            <PanelMenu items={panelMenu} title={`${name} options`} isMobile={isMobile} />
          )}
        </div>
        <WaveCategoryList
          voice={voice}
          reorder={reorder}
          show={kind}
          communityId={openCommunity?.id}
          categoryId={openCategory?.id}
          scrollRef={listScrollRef}
          waves={waves}
          categories={categories}
          channels={channels}
          selectedWave={selectedWave}
          onSelectWave={onSelectWave}
          onCategoryToggle={onCategoryToggle}
          onWaveMove={onWaveMove}
          onWaveFile={onWaveFile}
          onWavePin={onWavePin}
          onWaveMute={onWaveMute}
          onManageCommunity={onManageCommunity}
          onManageCategories={onManageCategories}
          onNewWaveIn={onNewWaveIn}
          isMobile={isMobile}
          waveNotifications={waveNotifications}
          activeCalls={activeCalls}
          density={density}
        />
      </div>
    );
  }

  return (
  <div style={{
    width: '100%',
    minWidth: 0,
    display: 'flex', flexDirection: 'column', height: '100%',
    borderBottom: isMobile ? '1px solid var(--border-subtle)' : 'none',
  }}>
    {/* One section (v2.126.0). Communities are one row each now, opening in
        their own panel, so they no longer crowd the list and sit at the top of
        the same scrolling list as the person's own waves. v2.102.0 had split
        them under two headers when a Community unfolded into all its channels
        here. + creates, ⋮ manages; one Reorder arranges both halves, each in
        the order it already had. */}
    <ListSectionHeader
      title={ghostMode ? GHOST_PROTOCOL.modeActive : `${T.WAVES}`}
      titleColor={ghostMode ? 'var(--accent-orange)' : 'var(--accent-amber)'}
      isMobile={isMobile}
      collapsed={!!sectionCollapsed.waves}
      onToggleCollapse={() => toggleSection('waves')}
      unreadCount={sectionUnread}
      onDone={reorderMode === 'home' ? () => setReorderMode(null) : null}
      onCreate={createMenu ? undefined : onNewWave}
      createMenu={createMenu}
      createTitle={createMenu ? 'Create or join' : `New ${T.wave}`}
      menuTitle="List options"
      menu={[
        ...(communitiesEnabled && onManageCommunities ? [{ label: '⚙ Manage Communities', onClick: () => onManageCommunities() }] : []),
        { label: categories.length > 0 ? '⚙ Manage Categories' : '⚙ Create Category', onClick: onManageCategories },
        { label: ghostMode ? '👻 Exit Ghost Mode' : '👻 Ghost Protocol',
          color: ghostMode ? 'var(--accent-orange)' : undefined, onClick: onToggleGhostProtocol },
        { label: showArchived ? '📬 Show Active' : '📦 Show Archived',
          color: showArchived ? 'var(--accent-teal)' : undefined, onClick: onToggleArchived },
        ...(waves.length > 1 || shownCommunities.length > 1 ? reorderItem() : []),
      ].filter(item => item.onClick)}
    />

    {!sectionCollapsed.waves && (
    <div ref={listScrollRef} style={{ flex: 1, overflowY: 'auto' }}>
    {waveInvitations.length > 0 && !ghostMode && !showArchived && (
      <WaveInvitations
        invitations={waveInvitations}
        onAccept={onAcceptInvitation}
        onDecline={onDeclineInvitation}
        isMobile={isMobile}
        density={densityStyle}
      />
    )}
    {shownCommunities.length > 0 && (
      <WaveCategoryList
        voice={voice}
        reorder={reorderMode === 'home' ? { ...reorder, mode: 'communities' } : null}
        show="communityRows"
        communities={shownCommunities}
        onOpenContainer={onOpenContainer}
        waves={waves}
        categories={categories}
        channels={channels}
        selectedWave={selectedWave}
        onSelectWave={onSelectWave}
        onManageCommunity={onManageCommunity}
        isMobile={isMobile}
        waveNotifications={waveNotifications}
        activeCalls={activeCalls}
        density={density}
      />
    )}

    {(categories.length > 0 || channels.length > 0) ? (
      <WaveCategoryList
        voice={voice}
        reorder={reorderMode === 'home' ? { ...reorder, mode: 'waves' } : null}
        show="waves"
        onOpenContainer={onOpenContainer}
        waves={waves}
        categories={categories}
        channels={channels}
        selectedWave={selectedWave}
        onSelectWave={onSelectWave}
        onCategoryToggle={onCategoryToggle}
        onWaveMove={onWaveMove}
        onWaveFile={onWaveFile}
        onManageCommunity={onManageCommunity}
        onManageCategories={onManageCategories}
        onNewWaveIn={onNewWaveIn}
        onWavePin={onWavePin}
        onWaveMute={onWaveMute}
        isMobile={isMobile}
        waveNotifications={waveNotifications}
        activeCalls={activeCalls}
        density={density}
      />
    ) : (
      <div>
        {waves.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {showArchived ? `No archived ${T.waves}` : EMPTY.noWavesCreate}
          </div>
        ) : waves.map((wave, index) => {
        const config = PRIVACY_LEVELS[wave.privacy] || PRIVACY_LEVELS.private;
        // Reorder mode: here the section is the whole list.
        const move = reorderMode === 'home' ? {
          onUp: index > 0 ? () => onReorderWaves?.(moveInList(waves.map(w => w.id), wave.id, -1)) : null,
          onDown: index < waves.length - 1 ? () => onReorderWaves?.(moveInList(waves.map(w => w.id), wave.id, 1)) : null,
        } : null;
        const isSelected = selectedWave?.id === wave.id;
        // Get notification info for this wave (priority-based type from server)
        const notifInfo = waveNotifications[wave.id];
        const notifCount = notifInfo?.count || 0;
        const notifType = notifInfo?.highestType || 'wave_activity';
        const badgeStyle = NOTIFICATION_BADGE_COLORS[notifType] || NOTIFICATION_BADGE_COLORS.wave_activity;
        // Show notification badge OR unread count (notification badge takes priority)
        const showNotificationBadge = notifCount > 0;
        const showUnreadBadge = !showNotificationBadge && wave.unread_count > 0;
        const callInfo = activeCalls[wave.id];
        const hasActiveCall = callInfo && callInfo.participantCount > 0;
        return (
          <div key={wave.id}
            onClick={(e) => {
              if (move) return;
              if (e.ctrlKey || e.metaKey) {
                onSelectWave(wave, { background: true });
              } else {
                onSelectWave(wave);
              }
            }}
            onAuxClick={(e) => {
              if (move) return;
              if (e.button === 1) {
                e.preventDefault();
                onSelectWave(wave, { background: true });
              }
            }}
            onMouseEnter={(e) => {
              if (!isSelected) {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isSelected) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
            style={{
            padding: densityStyle.padding, cursor: move ? 'default' : 'pointer',
            background: isSelected ? 'var(--accent-amber)10' : (showNotificationBadge ? `${badgeStyle.bg}08` : 'transparent'),
            borderBottom: '1px solid var(--bg-hover)',
            borderLeft: `3px solid ${showNotificationBadge ? badgeStyle.bg : (isSelected ? config.color : 'transparent')}`,
            transition: 'background 0.2s ease',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ color: 'var(--text-primary)', fontSize: densityStyle.fontSize, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
                {wave.is_archived && '📦 '}{wave.title}
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
                {wave.reviewState === 'needs_review' && <NeedsReview />}
                {showNotificationBadge && (
                  <span style={{
                    background: badgeStyle.bg,
                    color: '#000',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '10px',
                    boxShadow: `0 0 8px ${badgeStyle.shadow}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}>
                    {badgeStyle.icon && <span style={{ fontSize: '0.7rem' }}>{badgeStyle.icon}</span>}
                    {notifCount}
                  </span>
                )}
                {showUnreadBadge && (
                  <span style={{
                    background: 'var(--accent-orange)',
                    color: '#fff',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '10px',
                    boxShadow: '0 0 8px var(--glow-orange)',
                  }}>{wave.unread_count}</span>
                )}
                {hasActiveCall && (
                  <span style={{
                    background: 'var(--accent-green)',
                    color: '#000',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: '10px',
                    boxShadow: '0 0 8px var(--glow-green)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}>
                    📞 {callInfo.participantCount}
                  </span>
                )}
                {move ? (
                  <ReorderArrows onUp={move.onUp} onDown={move.onDown} isMobile={isMobile} label={wave.title} />
                ) : (
                  <WaveRowMenu
                    wave={wave}
                    categories={categories}
                    channels={channels}
                    onWaveFile={onWaveFile}
                    isOpen={rowMenuOpen === wave.id}
                    onToggle={setRowMenuOpen}
                    onWavePin={onWavePin}
                    onWaveMute={onWaveMute}
                    onWaveMove={onWaveMove}
                  />
                )}
                <span style={{ color: config.color, fontSize: '0.7rem', lineHeight: 1 }}>{config.icon}</span>
              </div>
            </div>
          </div>
        );
      })}
      </div>
    )}
    </div>
    )}
  </div>
  );
};

export default WaveList;
