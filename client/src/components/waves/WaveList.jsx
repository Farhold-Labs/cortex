import React, { useState, useEffect, useMemo } from 'react';
import { PRIVACY_LEVELS, NOTIFICATION_BADGE_COLORS } from '../../config/constants.js';
import { EMPTY, GHOST_PROTOCOL } from '../../../messages.js';
import { GlowText } from '../ui/SimpleComponents.jsx';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';

const WaveCategoryList = ({ waves, categories, selectedWave, onSelectWave, onCategoryToggle, onWaveMove, onWavePin, isMobile, waveNotifications = {}, activeCalls = {} }) => {
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
  const groupedWaves = useMemo(() => {
    const pinned = waves.filter(w => w.pinned);
    const uncategorized = waves.filter(w => !w.pinned && !w.category_id);

    const categorized = {};
    categories.forEach(cat => {
      categorized[cat.id] = waves.filter(w => !w.pinned && w.category_id === cat.id);
    });

    return { pinned, uncategorized, categorized };
  }, [waves, categories]);

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
          padding: '12px 16px',
          cursor: isMobile ? 'pointer' : 'move',
          background: isSelected ? 'var(--accent-amber)10' : (showNotificationBadge ? `${badgeStyle.bg}08` : 'transparent'),
          borderBottom: '1px solid var(--bg-hover)',
          borderLeft: `3px solid ${showNotificationBadge ? badgeStyle.bg : (isSelected ? config.color : 'transparent')}`,
          transition: 'background 0.2s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', alignItems: 'center' }}>
          <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
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
            {/* Move menu button (mobile/PWA alternative to drag-and-drop) */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMoveMenuOpen(moveMenuOpen === wave.id ? null : wave.id);
                }}
                title="Move wave to category"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-dim)',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  padding: '2px 4px',
                  lineHeight: 1,
                }}
              >
                ⋮
              </button>
              {/* Move menu dropdown */}
              {moveMenuOpen === wave.id && (
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
                        setMoveMenuOpen(null);
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
                    {/* Category options */}
                    {categories.map(cat => (
                      <div
                        key={cat.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onWaveMove(wave.id, cat.id);
                          setMoveMenuOpen(null);
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
                    {/* Uncategorized option */}
                    {wave.category_id && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          onWaveMove(wave.id, null);
                          setMoveMenuOpen(null);
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
            <span style={{ color: config.color }}>{config.icon}</span>
          </div>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: isMobile ? '0.85rem' : '0.7rem' }}>
          {wave.creator_name || 'Unknown'} • {wave.ping_count || 0} pings
          {wave.crew_name && <span> • {wave.crew_name}</span>}
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
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {/* Pinned Section */}
      {groupedWaves.pinned.length > 0 && (
        <div style={{ marginBottom: '8px' }}>
          <CollapsibleSection
            title="PINNED"
            badge={groupedWaves.pinned.length.toString()}
            defaultOpen={true}
            titleColor="var(--accent-amber)"
            accentColor="var(--accent-amber)"
            isMobile={isMobile}
          >
            {renderDropZone('__pinned__', 'Pinned')}
            {groupedWaves.pinned.map(wave => renderWaveItem(wave, true))}
          </CollapsibleSection>
        </div>
      )}

      {/* Category Sections */}
      {categories.map(category => {
        const categoryWaves = groupedWaves.categorized[category.id] || [];
        const unreadCount = getGroupUnreadCount(categoryWaves);

        return (
          <div key={category.id} style={{ marginBottom: '8px' }}>
            <CollapsibleSection
              title={category.name.toUpperCase()}
              badge={categoryWaves.length > 0 ? `${categoryWaves.length}${unreadCount > 0 ? ` (${unreadCount})` : ''}` : '0'}
              isOpen={!category.collapsed}
              onToggle={() => onCategoryToggle(category.id, !category.collapsed)}
              titleColor={category.color}
              accentColor={category.color}
              isMobile={isMobile}
            >
              {renderDropZone(category.id, category.name)}
              {categoryWaves.length === 0 ? (
                <div style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
                  No waves in this category
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
        <div style={{ marginBottom: '8px' }}>
          <CollapsibleSection
            title="UNCATEGORIZED"
            badge={groupedWaves.uncategorized.length.toString()}
            defaultOpen={true}
            titleColor="var(--text-dim)"
            accentColor="var(--border-primary)"
            isMobile={isMobile}
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

const WaveList = ({ waves, categories = [], selectedWave, onSelectWave, onNewWave, showArchived, onToggleArchived, isMobile, waveNotifications = {}, activeCalls = {}, onCategoryToggle, onWaveMove, onWavePin, onManageCategories, ghostMode = false, onToggleGhostProtocol }) => (
  <div style={{
    width: '100%',
    minWidth: 0,
    display: 'flex', flexDirection: 'column', height: '100%',
    borderBottom: isMobile ? '1px solid var(--border-subtle)' : 'none',
  }}>
    <div style={{ padding: isMobile ? '14px 16px' : '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
      <GlowText color={ghostMode ? 'var(--accent-orange)' : 'var(--accent-amber)'} size={isMobile ? '1rem' : '0.9rem'}>{ghostMode ? GHOST_PROTOCOL.modeActive : 'WAVES'}</GlowText>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {categories.length > 0 && (
          <button
            onClick={onManageCategories}
            title="Manage categories"
            style={{
              padding: isMobile ? '12px 14px' : '6px 10px',
              minHeight: isMobile ? '44px' : 'auto',
              minWidth: isMobile ? '44px' : 'auto',
              background: 'transparent',
              border: '1px solid var(--border-primary)',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.85rem' : '0.7rem',
            }}
          >
            {isMobile ? '⚙' : '⚙ MANAGE'}
          </button>
        )}
        <button
          onClick={onToggleGhostProtocol}
          title={ghostMode ? GHOST_PROTOCOL.exit : GHOST_PROTOCOL.menuItem}
          style={{
            padding: isMobile ? '12px 14px' : '6px 10px',
            minHeight: isMobile ? '44px' : 'auto',
            minWidth: isMobile ? '44px' : 'auto',
            background: ghostMode ? 'var(--accent-orange)20' : 'transparent',
            border: `1px solid ${ghostMode ? 'var(--accent-orange)' : 'var(--border-primary)'}`,
            color: ghostMode ? 'var(--accent-orange)' : 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace', fontSize: isMobile ? '0.85rem' : '0.7rem',
          }}
        >{ghostMode ? '👻 GHOST' : '👻'}</button>
        <button
          onClick={onToggleArchived}
          title={showArchived ? 'Show active waves' : 'Show archived waves'}
          style={{
            padding: isMobile ? '12px 14px' : '6px 10px',
            minHeight: isMobile ? '44px' : 'auto',
            minWidth: isMobile ? '44px' : 'auto',
            background: showArchived ? 'var(--accent-teal)20' : 'transparent',
            border: `1px solid ${showArchived ? 'var(--accent-teal)' : 'var(--border-primary)'}`,
            color: showArchived ? 'var(--accent-teal)' : 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace', fontSize: isMobile ? '0.85rem' : '0.7rem',
          }}
        >{showArchived ? '📦 ARCHIVED' : '📬'}</button>
        <button onClick={onNewWave} style={{
          padding: isMobile ? '12px 16px' : '6px 12px',
          minHeight: isMobile ? '44px' : 'auto',
          background: 'var(--accent-amber)20', border: '1px solid var(--accent-amber)50',
          color: 'var(--accent-amber)', cursor: 'pointer', fontFamily: 'monospace', fontSize: isMobile ? '0.85rem' : '0.75rem',
        }}>+ NEW</button>
      </div>
    </div>
    {categories.length > 0 ? (
      <WaveCategoryList
        waves={waves}
        categories={categories}
        selectedWave={selectedWave}
        onSelectWave={onSelectWave}
        onCategoryToggle={onCategoryToggle}
        onWaveMove={onWaveMove}
        onWavePin={onWavePin}
        isMobile={isMobile}
        waveNotifications={waveNotifications}
        activeCalls={activeCalls}
      />
    ) : (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {waves.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {showArchived ? 'No archived waves' : EMPTY.noWavesCreate}
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
            padding: '12px 16px', cursor: 'pointer',
            background: isSelected ? 'var(--accent-amber)10' : (showNotificationBadge ? `${badgeStyle.bg}08` : 'transparent'),
            borderBottom: '1px solid var(--bg-hover)',
            borderLeft: `3px solid ${showNotificationBadge ? badgeStyle.bg : (isSelected ? config.color : 'transparent')}`,
            transition: 'background 0.2s ease',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', alignItems: 'center' }}>
              <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: '8px' }}>
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
                <span style={{ color: config.color }}>{config.icon}</span>
              </div>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: isMobile ? '0.85rem' : '0.7rem' }}>
              {wave.creator_name || 'Unknown'} • {wave.message_count} msgs
              {wave.group_name && <span> • {wave.group_name}</span>}
            </div>
          </div>
        );
      })}
      </div>
    )}
  </div>
);

export default WaveList;
