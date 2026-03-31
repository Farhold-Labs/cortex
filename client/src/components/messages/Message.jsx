import React, { useState, useEffect } from 'react';
import { PRIVACY_LEVELS, THREAD_DEPTH_LIMIT, canAccess } from '../../config/constants.js';
import { Avatar, PrivacyBadge } from '../ui/SimpleComponents.jsx';
import ImageLightbox from '../ui/ImageLightbox.jsx';
// BurstLinkCard import removed in v2.38.0 — burst waves migrated to threads
import MessageWithEmbeds from './MessageWithEmbeds.jsx';
import AudioPlayer from '../media/AudioPlayer.jsx';
import VideoPlayer from '../media/VideoPlayer.jsx';

// Helper to extract first line from content for collapsed view (v2.23.0)
const getFirstLine = (content) => {
  if (!content) return '';
  // Strip HTML tags
  const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  // Truncate to ~60 chars
  if (text.length <= 60) return text;
  return text.substring(0, 57) + '...';
};

const Message = ({ message, depth = 0, onReply, onDelete, onEdit, onSaveEdit, onCancelEdit, editingMessageId, editContent, setEditContent, currentUserId, highlightId, playbackIndex, collapsed, onToggleCollapse, isMobile, contentCollapsed = {}, onToggleContentCollapse, onReact, onMessageClick, participants = [], contacts = [], onShowProfile, onReport, onFocus, onShare, wave, onNavigateToWave, currentWaveId, unreadCountsByWave = {}, autoFocusMessages = false, fetchAPI, onOpenThread, isInThreadPanel = false, currentUser, moveSource, onStartMove, onCompleteMove }) => {
  const config = PRIVACY_LEVELS[message.privacy] || PRIVACY_LEVELS.private;
  const isHighlighted = highlightId === message.id;
  const isVisible = playbackIndex === null || message._index <= playbackIndex;

  // Check if there are any visible children (non-deleted or deleted with visible descendants)
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

  // Close menus when clicking outside all messages (document listener, blocked by stopPropagation inside messages)
  useEffect(() => {
    if (!showMessageMenu && !showReactionPicker) return;
    const handleOutsideClick = () => {
      setShowMessageMenu(false);
      setShowReactionPicker(false);
    };
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [showMessageMenu, showReactionPicker]);

  // Close menus when a different message's menu opens (stopPropagation blocks the document listener across messages)
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
  const isReply = depth > 0 && message.parentId;
  const isAtDepthLimit = depth >= THREAD_DEPTH_LIMIT;

  // Count all messages in children (recursive) - for collapsed thread indicator
  const countAllChildren = (children) => {
    if (!children) return 0;
    return children.reduce((count, child) => {
      return count + 1 + countAllChildren(child.children);
    }, 0);
  };
  const totalChildCount = hasChildren ? countAllChildren(message.children) : 0;

  // Count unread messages in children (recursive) - for collapsed thread indicator
  const countUnreadChildren = (children) => {
    if (!children) return 0;
    return children.reduce((count, child) => {
      const childUnread = !child.deleted && child.is_unread && child.author_id !== currentUserId ? 1 : 0;
      return count + childUnread + countUnreadChildren(child.children);
    }, 0);
  };
  const unreadChildCount = isCollapsed && hasChildren ? countUnreadChildren(message.children) : 0;

  // Content collapse detection (v2.23.0)
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

  // Don't render deleted messages unless they have children (replies)
  // Deleted messages with children show placeholder to preserve thread context
  if (isDeleted && !hasChildren) return null;

  // Move mode helpers (v2.39.0)
  const isMoving = moveSource && moveSource.messageId === message.id;
  const isDescendantOfSource = React.useMemo(() => {
    if (!moveSource) return false;
    const checkDescendant = (children, targetId) => {
      if (!children) return false;
      return children.some(c => c.id === targetId || checkDescendant(c.children, targetId));
    };
    // We can't easily walk up from here, so we check if this message's ID is the source
    // The parent component tree handles this — but we also skip via isMoving
    return false;
  }, [moveSource]);
  const isMoveTarget = moveSource && !isMoving && !isDeleted;
  const canMove = !isDeleted && currentUser && onStartMove && !moveSource &&
    (message.author_id === currentUserId || canAccess(currentUser, 'moderator'));

  const handleMessageClick = (e) => {
    e.stopPropagation(); // Prevent click from bubbling to parent messages
    // Close any open menus when clicking elsewhere in the message
    if (showMessageMenu || showReactionPicker) {
      setShowMessageMenu(false);
      setShowReactionPicker(false);
      return;
    }
    // Move mode: clicking a message selects it as the move target (v2.39.0)
    if (isMoveTarget && onCompleteMove) {
      onCompleteMove(message.id);
      return;
    }
    if (isUnread && onMessageClick) {
      onMessageClick(message.id);
    }
    // Auto-focus if preference enabled and message has children (replies)
    if (autoFocusMessages && hasChildren && onOpenThread && !isDeleted) {
      onOpenThread(message);
    }
  };

  // Compact styling
  const avatarSize = isMobile ? 24 : 20;

  return (
    <div data-message-id={message.id}>
      <div
        onClickCapture={isMoveTarget ? (e) => { e.stopPropagation(); e.preventDefault(); onCompleteMove(message.id); } : undefined}
        onClick={handleMessageClick}
        style={{
          padding: '0px 12px',
          marginTop: isMobile ? '8px' : '6px',
          background: isMoving ? 'rgba(255, 210, 63, 0.08)' : isHighlighted ? `${config.color}15` : isUnread ? 'var(--accent-amber)08' : 'transparent',
          borderLeft: isUnread ? '2px solid var(--accent-amber)' : isMoving ? '2px solid var(--accent-amber)' : '2px solid transparent',
          cursor: isMoveTarget ? 'pointer' : (isUnread || (autoFocusMessages && hasChildren && onOpenThread && !isDeleted)) ? 'pointer' : 'default',
          transition: 'background 0.15s ease',
          opacity: isDeleted ? 0.5 : isMoving ? 0.6 : 1,
        }}
        onMouseEnter={(e) => {
          if (isMoveTarget) {
            e.currentTarget.style.outline = '1px solid var(--accent-amber)';
            e.currentTarget.style.background = 'rgba(255, 210, 63, 0.06)';
          } else if (!isHighlighted && !isUnread) {
            e.currentTarget.style.background = 'var(--bg-hover)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.outline = 'none';
          if (!isHighlighted && !isUnread && !isMoving) {
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        {/* Header row with author info (left) and actions (right) */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden' }}>
            <div
              style={{ cursor: onShowProfile ? 'pointer' : 'default', flexShrink: 0 }}
              onClick={onShowProfile && message.author_id ? (e) => { e.stopPropagation(); onShowProfile(message.author_id); } : undefined}
            >
              <Avatar letter={message.sender_avatar || '?'} color={config.color} size={avatarSize} imageUrl={message.sender_avatar_url} />
            </div>
            <span
              style={{ color: config.color, fontSize: isMobile ? '0.85rem' : '0.8rem', fontWeight: 600, cursor: onShowProfile ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              onClick={onShowProfile && message.author_id ? (e) => { e.stopPropagation(); onShowProfile(message.author_id); } : undefined}
            >
              {message.sender_name}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: isMobile ? '0.7rem' : '0.65rem' }}>
              {new Date(message.created_at).toLocaleDateString([], { month: 'numeric', day: 'numeric', year: '2-digit' })} {new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </span>
            {wave?.privacy !== message.privacy && <PrivacyBadge level={message.privacy} compact />}
          </div>

          {/* Compact inline actions */}
          {!isDeleted && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: 0.6, transition: 'opacity 0.15s', position: 'relative', flexShrink: 0 }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
            >
              {/* Reply / Thread to Reply at depth limit */}
              {isAtDepthLimit && onOpenThread ? (
                <button onClick={() => onOpenThread(message)} title="Open thread to reply" style={{
                  padding: isMobile ? '8px 10px' : '2px 4px', background: 'transparent', border: 'none',
                  color: 'var(--accent-teal)', cursor: 'pointer', fontSize: isMobile ? '0.85rem' : '0.7rem',
                }}>↳</button>
              ) : (
                <button onClick={() => onReply(message)} title="Reply" style={{
                  padding: isMobile ? '8px 10px' : '2px 4px', background: 'transparent', border: 'none',
                  color: 'var(--text-dim)', cursor: 'pointer', fontSize: isMobile ? '0.85rem' : '0.7rem',
                }}>↵</button>
              )}
              {/* Collapse/Expand Thread */}
              {hasChildren && (
                <button onClick={() => onToggleCollapse(message.id)} title={isCollapsed ? 'Expand thread' : 'Collapse thread'} style={{
                  padding: isMobile ? '8px 10px' : '2px 4px', background: 'transparent', border: 'none',
                  color: 'var(--accent-amber)', cursor: 'pointer', fontSize: isMobile ? '0.8rem' : '0.65rem',
                }}>{isCollapsed ? `▶${totalChildCount}` : '▼'}</button>
              )}
              {/* Collapse/Expand Content (v2.23.0) */}
              {isLongMessage && onToggleContentCollapse && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleContentCollapse(message.id);
                  }}
                  title={isContentCollapsed ? 'Expand message' : 'Collapse message'}
                  style={{
                    padding: isMobile ? '8px 10px' : '2px 4px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--accent-teal)',
                    cursor: 'pointer',
                    fontSize: isMobile ? '0.8rem' : '0.65rem',
                  }}
                >
                  {isContentCollapsed ? '◀' : '◆'}
                </button>
              )}

              {/* Three-dot menu for additional actions */}
              {!isEditing && (
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!showMessageMenu) {
                        document.dispatchEvent(new CustomEvent('cortex:message-menu-open', { detail: message.id }));
                      }
                      setShowMessageMenu(!showMessageMenu);
                    }}
                    title="More actions"
                    style={{
                      padding: isMobile ? '8px 10px' : '2px 4px',
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-dim)',
                      cursor: 'pointer',
                      fontSize: isMobile ? '0.85rem' : '0.7rem',
                    }}
                  >
                    ⋮
                  </button>
                  {/* Message actions dropdown */}
                  {showMessageMenu && (
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
                        minWidth: '140px',
                        zIndex: 1000,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={{ padding: '4px 0' }}>
                        {/* Focus removed in v2.38.0 — merged into Thread */}
                        {/* Share */}
                        {wave?.privacy === 'public' && onShare && (
                          <div
                            onClick={() => {
                              onShare(message);
                              setShowMessageMenu(false);
                            }}
                            style={{
                              padding: '8px 12px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              color: 'var(--text-primary)',
                              background: 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <span>⤴</span>
                            <span>Share</span>
                          </div>
                        )}
                        {/* Thread / Unthread */}
                        {onOpenThread && !isInThreadPanel && (
                          <div
                            onClick={async () => {
                              setShowMessageMenu(false);
                              if (message.threaded) {
                                // Unthread: toggle off, just update server
                                if (fetchAPI) {
                                  try { await fetchAPI(`/pings/${message.id}/thread`, { method: 'POST' }); } catch (e) { console.error('Unthread failed:', e); }
                                }
                              } else {
                                // Thread: toggle on and open panel
                                if (fetchAPI) {
                                  try { await fetchAPI(`/pings/${message.id}/thread`, { method: 'POST' }); } catch (e) { console.error('Thread failed:', e); }
                                }
                                onOpenThread(message);
                              }
                            }}
                            style={{
                              padding: '8px 12px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              color: 'var(--accent-teal)',
                              background: 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <span>↳</span>
                            <span>{message.threaded ? 'Unthread' : 'Thread'}</span>
                          </div>
                        )}
                        {/* Move (v2.39.0) — author or moderator+ */}
                        {canMove && (
                          <div
                            onClick={() => {
                              onStartMove(message, wave?.id);
                              setShowMessageMenu(false);
                            }}
                            style={{
                              padding: '8px 12px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              color: 'var(--accent-amber)',
                              background: 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <span>↕</span>
                            <span>Move</span>
                          </div>
                        )}
                        {/* Edit (author only) */}
                        {canDelete && (
                          <div
                            onClick={() => {
                              onEdit(message);
                              setShowMessageMenu(false);
                            }}
                            style={{
                              padding: '8px 12px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              color: 'var(--accent-amber)',
                              background: 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              borderTop: '1px solid var(--border-subtle)',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <span>✏</span>
                            <span>Edit</span>
                          </div>
                        )}
                        {/* Delete (author only) */}
                        {canDelete && (
                          <div
                            onClick={() => {
                              onDelete(message);
                              setShowMessageMenu(false);
                            }}
                            style={{
                              padding: '8px 12px',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              color: 'var(--accent-orange)',
                              background: 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            <span>✕</span>
                            <span>Delete</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Reaction */}
              <button onClick={(e) => { e.stopPropagation(); if (!showReactionPicker) { document.dispatchEvent(new CustomEvent('cortex:message-menu-open', { detail: message.id })); } setShowReactionPicker(!showReactionPicker); }} title="React" style={{
                padding: isMobile ? '8px 10px' : '2px 4px', background: showReactionPicker ? 'var(--bg-hover)' : 'transparent', border: 'none',
                color: 'var(--text-dim)', cursor: 'pointer', fontSize: isMobile ? '0.85rem' : '0.7rem',
              }}>{showReactionPicker ? '✕' : '😀'}</button>
              {/* Reaction picker dropdown */}
              {showReactionPicker && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: '4px', zIndex: 10,
                    background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', padding: '4px',
                    display: 'flex', flexWrap: 'wrap', gap: '2px', maxWidth: '220px',
                  }}>
                  {quickReactions.map(emoji => (
                    <button key={emoji} onClick={() => { onReact(message.id, emoji); setShowReactionPicker(false); }}
                      style={{ padding: '4px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1rem' }}
                    >{emoji}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {/* Depth indicator for deep threads */}
        {isAtDepthLimit && (
          <div style={{
            marginBottom: '8px',
            padding: '6px 10px',
            background: 'var(--accent-teal)10',
            border: '1px solid var(--accent-teal)40',
            borderLeft: '3px solid var(--accent-teal)',
            fontSize: isMobile ? '0.7rem' : '0.65rem',
            color: 'var(--accent-teal)',
            fontFamily: 'monospace',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <span>⬡</span>
            <span>Thread depth limit reached</span>
            <span style={{ color: 'var(--text-dim)' }}>•</span>
            <span style={{ color: 'var(--text-dim)' }}>Open thread to continue deeper</span>
          </div>
        )}
        {depth > THREAD_DEPTH_LIMIT && (
          <div style={{
            marginBottom: '8px',
            padding: '4px 8px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderLeft: '2px solid var(--text-dim)',
            fontSize: isMobile ? '0.65rem' : '0.6rem',
            color: 'var(--text-dim)',
            fontFamily: 'monospace',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span>⬡</span>
            <span>Depth: {depth} levels</span>
          </div>
        )}
        {isEditing ? (
          <div style={{ marginBottom: '10px' }}>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  onSaveEdit(message.id);
                } else if (e.key === 'Escape') {
                  onCancelEdit();
                }
              }}
              style={{
                width: '100%',
                minHeight: '80px',
                padding: '8px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--accent-amber)',
                color: 'var(--text-secondary)',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.95rem' : '0.85rem',
                resize: 'vertical',
              }}
              placeholder="Edit your message..."
              autoFocus
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button onClick={() => onSaveEdit(message.id)} style={{
                padding: isMobile ? '10px 14px' : '6px 12px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-green)20',
                border: '1px solid var(--accent-green)',
                color: 'var(--accent-green)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.75rem',
              }}>💾 SAVE (Ctrl+Enter)</button>
              <button onClick={onCancelEdit} style={{
                padding: isMobile ? '10px 14px' : '6px 12px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'transparent',
                border: '1px solid var(--text-dim)',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.75rem',
              }}>✕ CANCEL (Esc)</button>
            </div>
          </div>
        ) : isDeleted ? (
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: isMobile ? '0.95rem' : '0.85rem',
              lineHeight: 1.6,
              marginBottom: '10px',
              fontStyle: 'italic',
            }}
          >
            [Message deleted]
          </div>
        ) : isContentCollapsed ? (
          /* Collapsed content view (v2.23.0) */
          <div
            onClick={(e) => {
              e.stopPropagation();
              onToggleContentCollapse?.(message.id);
            }}
            style={{
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: isMobile ? '0.85rem' : '0.8rem',
              marginBottom: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 8px',
              background: 'var(--bg-hover)',
              borderRadius: '4px',
            }}
          >
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
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
              // Handle image clicks for lightbox
              if (e.target.tagName === 'IMG' && e.target.classList.contains('zoomable-image')) {
                e.stopPropagation();
                setLightboxImage(e.target.src);
                return;
              }
            }}
            style={{
              color: 'var(--text-primary)',
              fontSize: isMobile ? '0.95rem' : '0.85rem',
              lineHeight: 1.6,
              marginBottom: '10px',
              wordBreak: 'break-word',
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
            }}
          >
            {/* Text content (if any) */}
            {message.content && (
              <MessageWithEmbeds
                content={message.content}
                participants={participants}
                contacts={contacts}
                onMentionClick={onShowProfile}
                fetchAPI={fetchAPI}
              />
            )}
            {/* Media content (v2.7.0) */}
            {message.media_type === 'audio' && message.media_url && (
              <div style={{ marginTop: message.content ? '8px' : 0 }}>
                <AudioPlayer
                  src={message.media_url}
                  duration={message.media_duration}
                  isMobile={isMobile}
                />
              </div>
            )}
            {message.media_type === 'video' && message.media_url && (
              <div style={{ marginTop: message.content ? '8px' : 0 }}>
                <VideoPlayer
                  src={message.media_url}
                  duration={message.media_duration}
                  isMobile={isMobile}
                />
              </div>
            )}
          </div>
        )}
        {/* Reactions and Read Receipts Row */}
        {!isDeleted && message.reactions && Object.keys(message.reactions).length > 0 && (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center', marginTop: '2px' }}>
            {Object.entries(message.reactions).map(([emoji, userIds]) => {
              const hasReacted = userIds.includes(currentUserId);
              return (
                <button
                  key={emoji}
                  onClick={() => onReact(message.id, emoji)}
                  style={{
                    padding: '1px 4px',
                    background: hasReacted ? 'var(--accent-amber)20' : 'var(--bg-hover)',
                    border: 'none',
                    color: hasReacted ? 'var(--accent-amber)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    fontSize: isMobile ? '0.8rem' : '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px',
                    borderRadius: '2px',
                  }}
                >
                  <span>{emoji}</span>
                  <span style={{ fontSize: '0.6rem', fontFamily: 'monospace' }}>{userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Read Receipts - compact display */}
        {!isDeleted && message.readBy && message.readBy.length > 0 && (
          <details style={{ marginTop: '6px', cursor: 'pointer' }}>
            <summary style={{
              color: 'var(--text-muted)',
              fontSize: isMobile ? '0.65rem' : '0.6rem',
              userSelect: 'none',
              fontFamily: 'monospace',
              listStyle: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px'
            }}>
              <span style={{ color: 'var(--accent-green)' }}>✓</span>
              {message.readBy.length}
            </summary>
            <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
              {message.readBy.map(userId => {
                const participant = participants.find(p => p.id === userId);
                return (
                  <span key={userId} title={participant?.handle || ''} style={{
                    padding: '1px 4px', background: 'var(--accent-green)15', border: '1px solid var(--accent-green)40',
                    color: 'var(--accent-green)', fontSize: isMobile ? '0.6rem' : '0.55rem', fontFamily: 'monospace'
                  }}>
                    {participant ? participant.name : userId}
                  </span>
                );
              })}
            </div>
          </details>
        )}

        {/* Threaded: show "N replies" indicator instead of inline children */}
        {hasChildren && message.threaded && !isInThreadPanel && onOpenThread && (
          <div
            onClick={() => onOpenThread(message)}
            style={{
              marginTop: '4px',
              padding: isMobile ? '6px 10px' : '4px 8px',
              cursor: 'pointer',
              fontSize: isMobile ? '0.75rem' : '0.7rem',
              color: 'var(--accent-teal)',
              fontFamily: 'monospace',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ opacity: 0.7 }}>↳</span>
            <span>{totalChildCount} {totalChildCount === 1 ? 'reply' : 'replies'}</span>
            <span style={{ opacity: 0.5, fontSize: '0.6rem' }}>— view thread</span>
          </div>
        )}

        {/* Nested replies rendered INSIDE parent message (not threaded, or inside thread panel) */}
        {hasChildren && !isCollapsed && !(message.threaded && !isInThreadPanel) && (
          <div style={{
            marginTop: '2px',
            marginLeft: '0px',
            paddingLeft: isMobile ? '4px' : '6px',
            borderLeft: '1px solid var(--border-subtle)',
          }}>
            {message.children.map((child) => (
              <Message key={child.id} message={child} depth={depth + 1} onReply={onReply} onDelete={onDelete}
                onEdit={onEdit} onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit}
                editingMessageId={editingMessageId} editContent={editContent} setEditContent={setEditContent}
                currentUserId={currentUserId} highlightId={highlightId} playbackIndex={playbackIndex} collapsed={collapsed}
                onToggleCollapse={onToggleCollapse} isMobile={isMobile}
                contentCollapsed={contentCollapsed} onToggleContentCollapse={onToggleContentCollapse}
                onReact={onReact} onMessageClick={onMessageClick}
                participants={participants} contacts={contacts} onShowProfile={onShowProfile} onReport={onReport}
                onFocus={onFocus} onShare={onShare} wave={wave} onNavigateToWave={onNavigateToWave} currentWaveId={currentWaveId}
                unreadCountsByWave={unreadCountsByWave} autoFocusMessages={autoFocusMessages} fetchAPI={fetchAPI}
                onOpenThread={onOpenThread} isInThreadPanel={isInThreadPanel}
                currentUser={currentUser} moveSource={moveSource} onStartMove={onStartMove} onCompleteMove={onCompleteMove} />
            ))}
          </div>
        )}
      </div>
      {lightboxImage && (
        <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />
      )}
    </div>
  );
};

export default Message;
