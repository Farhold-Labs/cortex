import React, { useState, useEffect } from 'react';
import { PRIVACY_LEVELS, THREAD_DEPTH_LIMIT, canAccess, BASE_URL } from '../../config/constants.js';

const resolveMediaUrl = (url) => {
  if (!url || !BASE_URL) return url;
  if (url.startsWith('/')) return `${BASE_URL}${url}`;
  return url;
};
import { Avatar, PrivacyBadge } from '../ui/SimpleComponents.jsx';
import ImageLightbox from '../ui/ImageLightbox.jsx';
import MessageWithEmbeds from './MessageWithEmbeds.jsx';
import AudioPlayer from '../media/AudioPlayer.jsx';
import VideoPlayer from '../media/VideoPlayer.jsx';

const getFirstLine = (content) => {
  if (!content) return '';
  const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= 60) return text;
  return text.substring(0, 57) + '...';
};

const truncateForQuote = (content, maxLen = 60) => {
  if (!content) return '';
  const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 1) + '…';
};

const isWithinGroupWindow = (a, b) =>
  Math.abs(new Date(a) - new Date(b)) < 5 * 60 * 1000;

const AVATAR_SIZE = 28;
const AVATAR_COL = AVATAR_SIZE + 8; // avatar + gap

const menuItemBase = {
  padding: '8px 12px',
  cursor: 'pointer',
  fontSize: '0.8rem',
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

const MenuItem = ({ onClick, color, style, children }) => {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ ...menuItemBase, color: color || 'var(--text-primary)', background: hov ? 'var(--bg-hover)' : 'transparent', ...style }}
    >
      {children}
    </div>
  );
};

const Message = ({
  message, depth = 0, onReply, onDelete, onEdit, onSaveEdit, onCancelEdit,
  editingMessageId, editContent, setEditContent, currentUserId, highlightId,
  playbackIndex, collapsed, onToggleCollapse, isMobile, contentCollapsed = {},
  onToggleContentCollapse, onReact, onMessageClick, participants = [],
  contacts = [], onShowProfile, onReport, onFocus, onShare, wave,
  onNavigateToWave, currentWaveId, unreadCountsByWave = {},
  autoFocusMessages = false, fetchAPI, onOpenThread, isInThreadPanel = false,
  currentUser, moveSource, onStartMove, onCompleteMove,
  isFirstInGroup = true,
  parentPing = null,
}) => {
  const config = PRIVACY_LEVELS[message.privacy] || PRIVACY_LEVELS.private;
  const isHighlighted = highlightId === message.id;
  const isVisible = playbackIndex === null || message._index <= playbackIndex;

  const hasVisibleChildren = (children) => {
    if (!children || children.length === 0) return false;
    return children.some(child => !child.deleted || hasVisibleChildren(child.children));
  };
  const hasChildren = hasVisibleChildren(message.children);
  const isCollapsed = collapsed[message.id];
  const isDeleted = message.deleted;
  const canDelete = !isDeleted && message.author_id === currentUserId;
  const isEditing = !isDeleted && editingMessageId === message.id;

  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (!showMessageMenu && !showReactionPicker) return;
    const handleOutsideClick = () => {
      setShowMessageMenu(false);
      setShowReactionPicker(false);
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [showMessageMenu, showReactionPicker]);

  useEffect(() => {
    const handleOtherMenuOpen = (e) => {
      if (e.detail !== message.id) {
        setShowMessageMenu(false);
        setShowReactionPicker(false);
      }
    };
    document.addEventListener('cortex:message-menu-open', handleOtherMenuOpen);
    return () => document.removeEventListener('cortex:message-menu-open', handleOtherMenuOpen);
  }, [message.id]);

  const isUnread = !isDeleted && message.is_unread && message.author_id !== currentUserId;
  const isAtDepthLimit = depth >= THREAD_DEPTH_LIMIT;

  const countAllChildren = (children) => {
    if (!children) return 0;
    return children.reduce((acc, child) => acc + 1 + countAllChildren(child.children), 0);
  };
  const totalChildCount = hasChildren ? countAllChildren(message.children) : 0;

  const countUnreadChildren = (children) => {
    if (!children) return 0;
    return children.reduce((acc, child) => {
      const u = !child.deleted && child.is_unread && child.author_id !== currentUserId ? 1 : 0;
      return acc + u + countUnreadChildren(child.children);
    }, 0);
  };
  const unreadChildCount = isCollapsed && hasChildren ? countUnreadChildren(message.children) : 0;

  const isLongMessage = React.useMemo(() => {
    if (message.deleted) return false;
    if (message.media_type === 'audio' || message.media_type === 'video') return true;
    if (!message.content) return false;
    if (message.content.length > 150) return true;
    if (message.content.includes('<img')) return true;
    if (message.content.includes('class="file-attachment"')) return true;
    return false;
  }, [message.content, message.media_type, message.deleted]);

  const isContentCollapsed = contentCollapsed[message.id];
  const quickReactions = ['👍', '☝️', '❤️', '😂', '🎉', '🤔', '👏', '😢', '🖕', '😮', '🤦'];

  if (!isVisible) return null;
  if (isDeleted && !hasChildren) return null;

  const isMoving = moveSource && moveSource.messageId === message.id;
  const isMoveTarget = moveSource && !isMoving && !isDeleted;
  const canMove = !isDeleted && currentUser && onStartMove && !moveSource &&
    (message.author_id === currentUserId || canAccess(currentUser, 'moderator'));

  const handleMessageClick = (e) => {
    e.stopPropagation();
    if (showMessageMenu || showReactionPicker) {
      setShowMessageMenu(false);
      setShowReactionPicker(false);
      return;
    }
    if (isMoveTarget && onCompleteMove) { onCompleteMove(message.id); return; }
    if (isUnread && onMessageClick) onMessageClick(message.id);
    if (autoFocusMessages && hasChildren && onOpenThread && !isDeleted) onOpenThread(message);
  };

  const ts = new Date(message.created_at);
  const timeStr = ts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dateStr = ts.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' });

  const showHoverPill = isHovered && !isDeleted && !isEditing;

  return (
    <div data-message-id={message.id}>
      {/* Message row */}
      <div
        onClickCapture={isMoveTarget ? (e) => { e.stopPropagation(); e.preventDefault(); onCompleteMove(message.id); } : undefined}
        onClick={handleMessageClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          position: 'relative',
          display: 'flex',
          gap: '8px',
          paddingTop: isFirstInGroup ? (isMobile ? '10px' : '7px') : '1px',
          paddingBottom: '1px',
          paddingLeft: '12px',
          paddingRight: showHoverPill ? '90px' : '12px', // reserve space for pill
          background: isMoving ? 'rgba(255, 210, 63, 0.08)'
            : isHighlighted ? `${config.color}15`
            : isUnread ? 'var(--accent-amber)08'
            : isHovered ? 'var(--bg-hover)'
            : 'transparent',
          borderLeft: isUnread ? '2px solid var(--accent-amber)'
            : isMoving ? '2px solid var(--accent-amber)'
            : '2px solid transparent',
          cursor: isMoveTarget ? 'pointer'
            : (isUnread || (autoFocusMessages && hasChildren && onOpenThread && !isDeleted)) ? 'pointer'
            : 'default',
          opacity: isDeleted ? 0.5 : isMoving ? 0.6 : 1,
          transition: 'background 0.1s ease',
          outline: isMoveTarget && isHovered ? '1px solid var(--accent-amber)' : 'none',
        }}
      >
        {/* Left avatar column */}
        <div style={{ width: AVATAR_SIZE, flexShrink: 0, position: 'relative', paddingTop: isFirstInGroup ? '1px' : 0 }}>
          {isFirstInGroup ? (
            <div
              style={{ cursor: onShowProfile ? 'pointer' : 'default' }}
              onClick={onShowProfile && message.author_id
                ? (e) => { e.stopPropagation(); onShowProfile(message.author_id); }
                : undefined}
            >
              <Avatar
                letter={message.sender_avatar || '?'}
                color={config.color}
                size={AVATAR_SIZE}
                imageUrl={message.sender_avatar_url}
              />
            </div>
          ) : isHovered ? (
            <span style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '0.5rem',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              fontFamily: 'monospace',
              lineHeight: 1,
            }}>
              {timeStr}
            </span>
          ) : null}
        </div>

        {/* Content column */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Name + timestamp (first in group only) */}
          {isFirstInGroup && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '1px' }}>
              <span
                style={{
                  color: config.color,
                  fontSize: isMobile ? '0.85rem' : '0.8rem',
                  fontWeight: 600,
                  cursor: onShowProfile ? 'pointer' : 'default',
                }}
                onClick={onShowProfile && message.author_id
                  ? (e) => { e.stopPropagation(); onShowProfile(message.author_id); }
                  : undefined}
              >
                {message.sender_name}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', fontFamily: 'monospace' }}>
                {dateStr} {timeStr}
              </span>
              {wave?.privacy !== message.privacy && <PrivacyBadge level={message.privacy} compact />}
            </div>
          )}

          {/* Compact parent quote for replies */}
          {parentPing && !isDeleted && (
            <div style={{
              fontSize: '0.7rem',
              color: 'var(--text-muted)',
              marginBottom: '2px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              overflow: 'hidden',
              fontFamily: 'monospace',
            }}>
              <span style={{ color: 'var(--accent-teal)', flexShrink: 0 }}>↩</span>
              <span style={{ color: config.color, flexShrink: 0, fontWeight: 600 }}>{parentPing.sender_name}:</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.65 }}>
                {truncateForQuote(parentPing.content)}
              </span>
            </div>
          )}

          {/* Depth limit notice */}
          {isAtDepthLimit && (
            <div style={{
              marginBottom: '4px',
              padding: '3px 8px',
              background: 'var(--accent-teal)10',
              border: '1px solid var(--accent-teal)40',
              borderLeft: '3px solid var(--accent-teal)',
              fontSize: '0.65rem',
              color: 'var(--accent-teal)',
              fontFamily: 'monospace',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span>⬡</span>
              <span>Thread depth limit — open thread to continue</span>
            </div>
          )}
          {depth > THREAD_DEPTH_LIMIT && (
            <div style={{
              marginBottom: '4px',
              padding: '2px 6px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderLeft: '2px solid var(--text-dim)',
              fontSize: '0.6rem',
              color: 'var(--text-dim)',
              fontFamily: 'monospace',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}>
              <span>⬡</span>
              <span>Depth: {depth}</span>
            </div>
          )}

          {/* Content area */}
          {isEditing ? (
            <div style={{ marginBottom: '6px' }}>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) onSaveEdit(message.id);
                  else if (e.key === 'Escape') onCancelEdit();
                }}
                style={{
                  width: '100%',
                  minHeight: '60px',
                  padding: '6px 8px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--accent-amber)',
                  color: 'var(--text-secondary)',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.95rem' : '0.85rem',
                  resize: 'vertical',
                  boxSizing: 'border-box',
                }}
                placeholder="Edit your ping..."
                autoFocus
              />
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                <button onClick={() => onSaveEdit(message.id)} style={{
                  padding: isMobile ? '8px 12px' : '4px 10px',
                  background: 'var(--accent-green)20', border: '1px solid var(--accent-green)',
                  color: 'var(--accent-green)', cursor: 'pointer', fontFamily: 'monospace',
                  fontSize: isMobile ? '0.85rem' : '0.75rem',
                }}>💾 SAVE (Ctrl+Enter)</button>
                <button onClick={onCancelEdit} style={{
                  padding: isMobile ? '8px 12px' : '4px 10px',
                  background: 'transparent', border: '1px solid var(--text-dim)',
                  color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace',
                  fontSize: isMobile ? '0.85rem' : '0.75rem',
                }}>✕ CANCEL (Esc)</button>
              </div>
            </div>
          ) : isDeleted ? (
            <div style={{
              color: 'var(--text-muted)', fontSize: isMobile ? '0.95rem' : '0.85rem',
              fontStyle: 'italic', marginBottom: '2px',
            }}>
              [Message deleted]
            </div>
          ) : isContentCollapsed ? (
            <div
              onClick={(e) => { e.stopPropagation(); onToggleContentCollapse?.(message.id); }}
              style={{
                cursor: 'pointer', color: 'var(--text-muted)',
                fontSize: isMobile ? '0.85rem' : '0.8rem', marginBottom: '2px',
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '3px 6px', background: 'var(--bg-hover)', borderRadius: '3px',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {getFirstLine(message.content)}
              </span>
              {message.media_type === 'audio' && <span title="Audio">🎵</span>}
              {message.media_type === 'video' && <span title="Video">🎬</span>}
              {message.content?.includes('<img') && <span title="Image">🖼️</span>}
              {message.content?.includes('class="file-attachment"') && <span title="File">📎</span>}
            </div>
          ) : (
            <div
              onClick={(e) => {
                if (e.target.tagName === 'IMG' && e.target.classList.contains('zoomable-image')) {
                  e.stopPropagation();
                  setLightboxImage(e.target.src);
                }
              }}
              style={{
                color: 'var(--text-primary)', fontSize: isMobile ? '0.95rem' : '0.85rem',
                lineHeight: 1.5, marginBottom: '2px',
                wordBreak: 'break-word', whiteSpace: 'pre-wrap', overflow: 'hidden',
              }}
            >
              {message.content && (
                <MessageWithEmbeds
                  content={message.content}
                  participants={participants}
                  contacts={contacts}
                  onMentionClick={onShowProfile}
                  fetchAPI={fetchAPI}
                />
              )}
              {message.media_type === 'audio' && message.media_url && (
                <div style={{ marginTop: message.content ? '6px' : 0 }}>
                  <AudioPlayer src={resolveMediaUrl(message.media_url)} duration={message.media_duration} isMobile={isMobile} />
                </div>
              )}
              {message.media_type === 'video' && message.media_url && (
                <div style={{ marginTop: message.content ? '6px' : 0 }}>
                  <VideoPlayer src={resolveMediaUrl(message.media_url)} duration={message.media_duration} isMobile={isMobile} />
                </div>
              )}
            </div>
          )}

          {/* Reactions */}
          {!isDeleted && message.reactions && Object.keys(message.reactions).length > 0 && (
            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '2px' }}>
              {Object.entries(message.reactions).map(([emoji, userIds]) => {
                const hasReacted = userIds.includes(currentUserId);
                return (
                  <button key={emoji} onClick={() => onReact(message.id, emoji)} style={{
                    padding: '1px 4px',
                    background: hasReacted ? 'var(--accent-amber)20' : 'var(--bg-hover)',
                    border: 'none', cursor: 'pointer',
                    color: hasReacted ? 'var(--accent-amber)' : 'var(--text-dim)',
                    fontSize: isMobile ? '0.8rem' : '0.75rem',
                    display: 'flex', alignItems: 'center', gap: '2px', borderRadius: '2px',
                  }}>
                    <span>{emoji}</span>
                    <span style={{ fontSize: '0.6rem', fontFamily: 'monospace' }}>{userIds.length}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Read receipts */}
          {!isDeleted && message.readBy && message.readBy.length > 0 && (
            <details style={{ marginTop: '2px', cursor: 'pointer' }}>
              <summary style={{
                color: 'var(--text-muted)', fontSize: '0.55rem', userSelect: 'none',
                fontFamily: 'monospace', listStyle: 'none',
                display: 'inline-flex', alignItems: 'center', gap: '3px',
              }}>
                <span style={{ color: 'var(--accent-green)' }}>✓</span>
                {message.readBy.length}
              </summary>
              <div style={{ marginTop: '3px', display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {message.readBy.map(userId => {
                  const participant = participants.find(p => p.id === userId);
                  return (
                    <span key={userId} title={participant?.handle || ''} style={{
                      padding: '1px 4px', background: 'var(--accent-green)15',
                      border: '1px solid var(--accent-green)40', color: 'var(--accent-green)',
                      fontSize: '0.55rem', fontFamily: 'monospace',
                    }}>
                      {participant ? participant.name : userId}
                    </span>
                  );
                })}
              </div>
            </details>
          )}

          {/* Thread reply count link (threaded mode) */}
          {hasChildren && message.threaded && !isInThreadPanel && onOpenThread && (
            <div
              onClick={() => onOpenThread(message)}
              style={{
                marginTop: '2px', cursor: 'pointer',
                fontSize: isMobile ? '0.75rem' : '0.7rem',
                color: 'var(--accent-teal)', fontFamily: 'monospace',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <span style={{ opacity: 0.7 }}>↳</span>
              <span>{totalChildCount} {totalChildCount === 1 ? 'reply' : 'replies'}</span>
              <span style={{ opacity: 0.5, fontSize: '0.6rem' }}>— view thread</span>
            </div>
          )}

          {/* Collapsed thread indicator */}
          {isCollapsed && hasChildren && (
            <div
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(message.id); }}
              style={{
                marginTop: '2px', cursor: 'pointer',
                fontSize: isMobile ? '0.75rem' : '0.7rem',
                color: 'var(--accent-amber)', fontFamily: 'monospace',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              <span>▶</span>
              <span>{totalChildCount} {totalChildCount === 1 ? 'reply' : 'replies'}</span>
              {unreadChildCount > 0 && (
                <span style={{
                  background: 'var(--accent-amber)', color: 'var(--bg-surface)',
                  padding: '0 3px', fontSize: '0.55rem', borderRadius: '2px',
                }}>
                  {unreadChildCount} new
                </span>
              )}
            </div>
          )}
        </div>

        {/* Hover action pill */}
        {showHoverPill && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '4px',
              right: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '1px',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-primary)',
              borderRadius: '4px',
              padding: '2px 3px',
              zIndex: 20,
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            }}
          >
            {/* React */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!showReactionPicker) document.dispatchEvent(new CustomEvent('cortex:message-menu-open', { detail: message.id }));
                  setShowReactionPicker(!showReactionPicker);
                }}
                title="React"
                style={{ padding: '3px 5px', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.8rem' }}
              >😀</button>
              {showReactionPicker && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute', bottom: '100%', right: 0, marginBottom: '4px', zIndex: 30,
                    background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                    padding: '4px', display: 'flex', flexWrap: 'wrap', gap: '2px', width: 'max-content',
                  }}
                >
                  {quickReactions.map(emoji => (
                    <button key={emoji}
                      onClick={() => { onReact(message.id, emoji); setShowReactionPicker(false); }}
                      style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1rem' }}
                    >{emoji}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Reply */}
            {isAtDepthLimit && onOpenThread ? (
              <button onClick={() => onOpenThread(message)} title="Open thread to reply" style={{
                padding: '3px 5px', background: 'transparent', border: 'none',
                color: 'var(--accent-teal)', cursor: 'pointer', fontSize: '0.75rem',
              }}>↳</button>
            ) : (
              <button onClick={() => onReply(message)} title="Reply" style={{
                padding: '3px 5px', background: 'transparent', border: 'none',
                color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.75rem',
              }}>↵</button>
            )}

            {/* Collapse/Expand thread */}
            {hasChildren && (
              <button onClick={() => onToggleCollapse(message.id)} title={isCollapsed ? 'Expand' : 'Collapse'} style={{
                padding: '3px 5px', background: 'transparent', border: 'none',
                color: 'var(--accent-amber)', cursor: 'pointer', fontSize: '0.65rem',
              }}>{isCollapsed ? `▶${totalChildCount}` : '▼'}</button>
            )}

            {/* Collapse/Expand content */}
            {isLongMessage && onToggleContentCollapse && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleContentCollapse(message.id); }}
                title={isContentCollapsed ? 'Expand message' : 'Collapse message'}
                style={{ padding: '3px 5px', background: 'transparent', border: 'none', color: 'var(--accent-teal)', cursor: 'pointer', fontSize: '0.65rem' }}
              >{isContentCollapsed ? '◀' : '◆'}</button>
            )}

            {/* Three-dot menu */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!showMessageMenu) document.dispatchEvent(new CustomEvent('cortex:message-menu-open', { detail: message.id }));
                  setShowMessageMenu(!showMessageMenu);
                }}
                title="More"
                style={{ padding: '3px 5px', background: showMessageMenu ? 'var(--bg-hover)' : 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.75rem' }}
              >⋮</button>
              {showMessageMenu && (
                <div
                  style={{
                    position: 'absolute', right: 0, bottom: '100%', marginBottom: '4px',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)',
                    borderRadius: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    minWidth: '150px', zIndex: 1000,
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ padding: '4px 0' }}>
                    {wave?.privacy === 'public' && onShare && (
                      <MenuItem onClick={() => { onShare(message); setShowMessageMenu(false); }}>
                        <span>⤴</span><span>Share</span>
                      </MenuItem>
                    )}
                    {onOpenThread && !isInThreadPanel && (
                      <MenuItem
                        color="var(--accent-teal)"
                        onClick={async () => {
                          setShowMessageMenu(false);
                          if (fetchAPI) {
                            try { await fetchAPI(`/pings/${message.id}/thread`, { method: 'POST' }); } catch {}
                          }
                          if (!message.threaded) onOpenThread(message);
                        }}
                      >
                        <span>↳</span><span>{message.threaded ? 'Unthread' : 'Thread'}</span>
                      </MenuItem>
                    )}
                    {canMove && (
                      <MenuItem color="var(--accent-amber)" onClick={() => { onStartMove(message, wave?.id); setShowMessageMenu(false); }}>
                        <span>↕</span><span>Move</span>
                      </MenuItem>
                    )}
                    {canDelete && (
                      <MenuItem color="var(--accent-amber)" style={{ borderTop: '1px solid var(--border-subtle)' }} onClick={() => { onEdit(message); setShowMessageMenu(false); }}>
                        <span>✏</span><span>Edit</span>
                      </MenuItem>
                    )}
                    {canDelete && (
                      <MenuItem color="var(--accent-orange)" onClick={() => { onDelete(message); setShowMessageMenu(false); }}>
                        <span>✕</span><span>Delete</span>
                      </MenuItem>
                    )}
                    {onReport && message.author_id !== currentUserId && (
                      <MenuItem color="var(--text-muted)" style={{ borderTop: '1px solid var(--border-subtle)' }} onClick={() => { onReport(message); setShowMessageMenu(false); }}>
                        <span>⚑</span><span>Report</span>
                      </MenuItem>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Inline children (non-threaded or inside thread panel) */}
      {hasChildren && !isCollapsed && !(message.threaded && !isInThreadPanel) && (
        <div style={{
          marginLeft: `${12 + AVATAR_COL}px`,
          paddingLeft: '8px',
          borderLeft: '2px solid var(--border-subtle)',
          marginBottom: '2px',
        }}>
          {message.children.map((child, i) => {
            const prev = message.children[i - 1];
            const childIsFirstInGroup = !prev ||
              prev.author_id !== child.author_id ||
              !isWithinGroupWindow(prev.created_at, child.created_at);
            return (
              <Message
                key={child.id}
                message={child}
                depth={depth + 1}
                isFirstInGroup={childIsFirstInGroup}
                parentPing={i === 0 ? message : null}
                onReply={onReply}
                onDelete={onDelete}
                onEdit={onEdit}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
                editingMessageId={editingMessageId}
                editContent={editContent}
                setEditContent={setEditContent}
                currentUserId={currentUserId}
                highlightId={highlightId}
                playbackIndex={playbackIndex}
                collapsed={collapsed}
                onToggleCollapse={onToggleCollapse}
                isMobile={isMobile}
                contentCollapsed={contentCollapsed}
                onToggleContentCollapse={onToggleContentCollapse}
                onReact={onReact}
                onMessageClick={onMessageClick}
                participants={participants}
                contacts={contacts}
                onShowProfile={onShowProfile}
                onReport={onReport}
                onFocus={onFocus}
                onShare={onShare}
                wave={wave}
                onNavigateToWave={onNavigateToWave}
                currentWaveId={currentWaveId}
                unreadCountsByWave={unreadCountsByWave}
                autoFocusMessages={autoFocusMessages}
                fetchAPI={fetchAPI}
                onOpenThread={onOpenThread}
                isInThreadPanel={isInThreadPanel}
                currentUser={currentUser}
                moveSource={moveSource}
                onStartMove={onStartMove}
                onCompleteMove={onCompleteMove}
              />
            );
          })}
        </div>
      )}

      {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </div>
  );
};

export default Message;
