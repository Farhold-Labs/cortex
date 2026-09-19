import React, { useState, useEffect, useMemo, useRef } from 'react';
import { usePullToRefresh } from '../../hooks/usePullToRefresh.js';
import { PRIVACY_LEVELS, NOTIFICATION_BADGE_COLORS, WAVE_DENSITY, DEFAULT_WAVE_DENSITY } from '../../config/constants.js';
import { EMPTY, GHOST_PROTOCOL } from '../../../messages.js';
import { GlowText } from '../ui/SimpleComponents.jsx';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import { T } from '../../config/terminology.js';

// v2.84.1 — one row menu, used by BOTH wave-list layouts.
//
// The categorised and uncategorised lists are separate render paths and only
// the categorised one ever had this menu, so anyone who had not created a
// category saw no ⋮ at all: Pin was unreachable, and Mute (v2.84.0) never
// appeared for them. Extracted rather than copied so the two cannot drift.
const WaveRowMenu = ({ wave, categories = [], channels = [], isOpen, onToggle, onWavePin, onWaveMute, onWaveMove, onWaveFile }) => (
  <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
    <button
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
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: '100%',
          marginTop: '4px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border-primary)',
          borderRadius: '4px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          minWidth: '150px',
          zIndex: 1000,
        }}
        onClick={(e) => e.stopPropagation()}
      >
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
      </div>
    )}
  </div>
);

const WaveCategoryList = ({ waves, categories, channels = [], selectedWave, onSelectWave, onCategoryToggle, onWaveMove, onWaveFile, onWavePin, onWaveMute, onManageCommunity, isMobile, waveNotifications = {}, activeCalls = {}, density = DEFAULT_WAVE_DENSITY, scrollRef }) => {
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

  const groupedWaves = useMemo(() => {
    const pinned = waves.filter(w => w.pinned);

    // A wave filed in a community channel is listed under that channel, not
    // under a personal category — the shared grouping wins, because that is the
    // one other people can also see.
    const byChannel = {};
    channels.forEach(ch => {
      byChannel[ch.id] = waves.filter(w => !w.pinned && w.channelId === ch.id);
    });
    const filedIds = new Set(Object.values(byChannel).flat().map(w => w.id));

    const uncategorized = waves.filter(w => !w.pinned && !w.category_id && !filedIds.has(w.id));

    const categorized = {};
    categories.forEach(cat => {
      categorized[cat.id] = waves.filter(w => !w.pinned && w.category_id === cat.id && !filedIds.has(w.id));
    });

    return { pinned, uncategorized, categorized, byChannel };
  }, [waves, categories, channels]);

  // Calculate unread count for a group of waves
  const getGroupUnreadCount = (wavesInGroup) => {
    return wavesInGroup.reduce((sum, wave) => {
      const notifInfo = waveNotifications[wave.id];
      return sum + (notifInfo?.count || wave.unread_count || 0);
    }, 0);
  };

  // Render a single wave item
  const renderWaveItem = (wave, showPinButton = false) => {
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
        draggable={!isMobile}
        onDragStart={(e) => {
          if (isMobile) return;
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
          if (e.ctrlKey || e.metaKey) {
            onSelectWave(wave, { background: true });
          } else {
            onSelectWave(wave);
          }
        }}
        onAuxClick={(e) => {
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
          cursor: isMobile ? 'pointer' : 'move',
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
            <span style={{ color: config.color, fontSize: '0.7rem', lineHeight: 1 }}>{config.icon}</span>
          </div>
        </div>
      </div>
    );
  };

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
      {groupedWaves.pinned.length > 0 && (
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
          >
            {renderDropZone('__pinned__', 'Pinned')}
            {groupedWaves.pinned.map(wave => renderWaveItem(wave, true))}
          </CollapsibleSection>
        </div>
      )}

      {/* Communities: community -> channels -> waves, each level collapsible.
          The community name was previously a subtitle squeezed beside the
          channel name, and in a narrow sidebar the two ran into each other and
          neither could be read. Nesting says the same thing legibly, and gives
          somewhere to collapse a whole community you are not using today. */}
      {communityGroups.map(group => {
        const groupWaves = group.channels.flatMap(ch => groupedWaves.byChannel[ch.id] || []);
        return (
          <div key={group.communityId} style={{ marginBottom: '1px' }}>
            <CollapsibleSection
              title={group.communityName.toUpperCase()}
              badge={groupWaves.length.toString()}
              unreadCount={getGroupUnreadCount(groupWaves)}
              isOpen={!collapsedKeys[`c:${group.communityId}`]}
              onToggle={() => toggleCollapsed(`c:${group.communityId}`)}
              titleColor="var(--accent-amber)"
              accentColor="var(--accent-amber)"
              isMobile={isMobile}
              compact
              action={onManageCommunity ? {
                label: '⚙',
                title: `Manage ${group.communityName}`,
                onClick: () => onManageCommunity(group.channels[0] || { communityId: group.communityId }),
              } : undefined}
            >
              {group.channels.length === 0 && (
                <div style={{ padding: '10px 24px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  No channels yet
                </div>
              )}
              {group.channels.map(channel => {
                const chWaves = groupedWaves.byChannel[channel.id] || [];
                return (
                  <CollapsibleSection
                    key={channel.id}
                    title={`# ${channel.name}`}
                    badge={chWaves.length.toString()}
                    unreadCount={getGroupUnreadCount(chWaves)}
                    isOpen={!collapsedKeys[`ch:${channel.id}`]}
                    onToggle={() => toggleCollapsed(`ch:${channel.id}`)}
                    titleColor="var(--text-primary)"
                    isMobile={isMobile}
                    compact
                    indent={1}
                  >
                    {chWaves.length === 0 ? (
                      <div style={{ padding: '8px 32px', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        No {T.waves} filed here yet
                      </div>
                    ) : (
                      chWaves.map(wave => renderWaveItem(wave, true))
                    )}
                  </CollapsibleSection>
                );
              })}
            </CollapsibleSection>
          </div>
        );
      })}

      {/* Category Sections */}
      {categories.map(category => {
        const categoryWaves = groupedWaves.categorized[category.id] || [];
        const unreadCount = getGroupUnreadCount(categoryWaves);

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
            >
              {renderDropZone(category.id, category.name)}
              {categoryWaves.length === 0 ? (
                <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                  No {T.waves} in this category
                </div>
              ) : (
                categoryWaves.map(wave => renderWaveItem(wave, true))
              )}
            </CollapsibleSection>
          </div>
        );
      })}

      {/* Uncategorized Section */}
      {groupedWaves.uncategorized.length > 0 && (
        <div style={{ marginBottom: '1px' }}>
          <CollapsibleSection
            title="UNCATEGORIZED"
            badge={groupedWaves.uncategorized.length.toString()}
            unreadCount={getGroupUnreadCount(groupedWaves.uncategorized)}
            defaultOpen={true}
            titleColor="var(--text-dim)"
            accentColor="var(--border-primary)"
            isMobile={isMobile}
            compact
          >
            {renderDropZone(null, 'Uncategorized')}
            {groupedWaves.uncategorized.map(wave => renderWaveItem(wave, true))}
          </CollapsibleSection>
        </div>
      )}

      {/* Empty State */}
      {waves.length === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {EMPTY.noWavesCreate}
        </div>
      )}
    </div>
  );
};

const WaveList = ({ waves, categories = [], channels = [], selectedWave, onSelectWave, onNewWave, showArchived, onToggleArchived, isMobile, waveNotifications = {}, activeCalls = {}, onCategoryToggle, onWaveMove, onWaveFile, onWavePin, onWaveMute, onManageCategories, onManageCommunities, onManageCommunity, communitiesEnabled = false, ghostMode = false, onToggleGhostProtocol, density = DEFAULT_WAVE_DENSITY, onRefresh }) => {
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
  const [showWaveMenu, setShowWaveMenu] = React.useState(false);
  // v2.84.1 — the uncategorised list needs its own row-menu state; the
  // categorised list keeps its copy inside WaveCategoryList.
  const [rowMenuOpen, setRowMenuOpen] = React.useState(null);
  return (
  <div style={{
    width: '100%',
    minWidth: 0,
    display: 'flex', flexDirection: 'column', height: '100%',
    borderBottom: isMobile ? '1px solid var(--border-subtle)' : 'none',
  }}>
    {showWaveMenu && <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => setShowWaveMenu(false)} />}
    <div style={{ padding: isMobile ? '10px 12px' : '8px 12px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <GlowText color={ghostMode ? 'var(--accent-orange)' : 'var(--accent-amber)'} size={isMobile ? '1rem' : '0.9rem'}>{ghostMode ? GHOST_PROTOCOL.modeActive : `${T.WAVES}`}</GlowText>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowWaveMenu(!showWaveMenu)}
          title={`${T.Wave} options`}
          style={{
            padding: isMobile ? '10px 12px' : '5px 8px',
            background: showWaveMenu ? 'var(--bg-hover)' : 'transparent',
            border: `1px solid ${showWaveMenu ? 'var(--border-primary)' : 'var(--border-subtle)'}`,
            color: ghostMode ? 'var(--accent-orange)' : (showWaveMenu ? 'var(--accent-amber)' : 'var(--text-dim)'),
            cursor: 'pointer', fontFamily: 'monospace', fontSize: isMobile ? '1.1rem' : '1rem', lineHeight: 1,
          }}
        >⋮</button>
        {showWaveMenu && (
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: '4px',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)', zIndex: 100, minWidth: '170px',
          }}>
            {[
              { label: `+ New ${T.Wave}`, color: 'var(--accent-amber)', action: onNewWave },
              // v2.84.2 — never gate this on already having a category. It was
              // `categories.length > 0 &&`, so someone with none had no way to
              // create their first: the only entry point to the category manager
              // was hidden until they already had one. The manager itself has
              // always handled the empty case — it opens on a create form.
              // NB: the key is `action`, not `onClick` — the renderer below calls
              // `item.action?.()`, so an `onClick` here is silently inert. It was,
              // until a browser caught it.
              ...(communitiesEnabled ? [{
                label: '⚙ Communities',
                color: 'var(--text-primary)',
                action: onManageCommunities,
              }] : []),
              { label: categories.length > 0 ? '⚙ Manage Categories' : '⚙ Create Category',
                color: 'var(--text-primary)', action: onManageCategories },
              { label: ghostMode ? '👻 Exit Ghost Mode' : '👻 Ghost Protocol', color: ghostMode ? 'var(--accent-orange)' : 'var(--text-primary)', action: onToggleGhostProtocol },
              { label: showArchived ? '📬 Show Active' : '📦 Show Archived', color: showArchived ? 'var(--accent-teal)' : 'var(--text-primary)', action: onToggleArchived },
            ].filter(Boolean).map((item, i, arr) => (
              <button
                key={item.label}
                onClick={() => { setShowWaveMenu(false); item.action?.(); }}
                style={{
                  display: 'block', width: '100%', padding: '9px 12px',
                  background: 'transparent', border: 'none',
                  borderBottom: i < arr.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  color: item.color, cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'monospace', fontSize: isMobile ? '0.9rem' : '0.75rem',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >{item.label}</button>
            ))}
          </div>
        )}
      </div>
    </div>
    {isMobile && (pullDistance > 0 || refreshing) && (
      <div
        aria-hidden="true"
        style={{
          // Fixed height for the same reason as the wave's indicator: a height
          // driven by pullDistance clips its own label mid-pull.
          height: 26, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--accent-green)', fontFamily: 'monospace', fontSize: '0.62rem',
          letterSpacing: '0.1em', whiteSpace: 'nowrap',
          opacity: refreshing ? 1 : Math.max(0.45, Math.min(pullDistance / 60, 1)),
        }}
      >
        {refreshing ? '⟳ REFRESHING…' : (pullDistance >= 60 ? '↻ RELEASE TO REFRESH' : '↓ PULL TO REFRESH')}
      </div>
    )}
    {/* Grouped whenever there is anything to group BY. Previously this was
        categories alone, which would have hidden every community channel from
        the many people who have never made a category. */}
    {(categories.length > 0 || channels.length > 0) ? (
      <WaveCategoryList
        scrollRef={listScrollRef}
        waves={waves}
        categories={categories}
        channels={channels}
        selectedWave={selectedWave}
        onSelectWave={onSelectWave}
        onCategoryToggle={onCategoryToggle}
        onWaveMove={onWaveMove}
        onWaveFile={onWaveFile}
        onManageCommunity={onManageCommunity}
        onWavePin={onWavePin}
        onWaveMute={onWaveMute}
        isMobile={isMobile}
        waveNotifications={waveNotifications}
        activeCalls={activeCalls}
        density={density}
      />
    ) : (
      <div ref={listScrollRef} style={{ flex: 1, overflowY: 'auto' }}>
        {waves.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {showArchived ? `No archived ${T.waves}` : EMPTY.noWavesCreate}
          </div>
        ) : waves.map(wave => {
        const config = PRIVACY_LEVELS[wave.privacy] || PRIVACY_LEVELS.private;
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
              if (e.ctrlKey || e.metaKey) {
                onSelectWave(wave, { background: true });
              } else {
                onSelectWave(wave);
              }
            }}
            onAuxClick={(e) => {
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
            padding: densityStyle.padding, cursor: 'pointer',
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
                <span style={{ color: config.color, fontSize: '0.7rem', lineHeight: 1 }}>{config.icon}</span>
              </div>
            </div>
          </div>
        );
      })}
      </div>
    )}
  </div>
  );
};

export default WaveList;
