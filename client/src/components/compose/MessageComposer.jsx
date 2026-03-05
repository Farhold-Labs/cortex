import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Avatar } from '../ui/SimpleComponents.jsx';

const MessageComposer = forwardRef(({
  participants = [],
  contacts = [],
  currentUser,
  isMobile,
  onSend,
  onTyping,
  onImageUpload,
  onFileUpload,
  onPaste,
  placeholder,
  replyingTo,
  onCancelReply,
  uploading = false,
  uploadingMedia = false,
  mediaUploadStatus,
  showGifButton = true,
  onGifClick,
  showPhotoButton = true,
  showFileButton = true,
  showMoreMenu = true,
  onCameraClick,
  onAudioRecord,
  onVideoRecord,
  plexConnections = [],
  onPlexClick,
  compact = false,
}, ref) => {
  const [newMessage, setNewMessage] = useState('');
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(null);
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const fileAttachInputRef = useRef(null);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    getMessage: () => newMessage,
    setMessage: (msg) => setNewMessage(msg),
    appendMessage: (text) => setNewMessage(prev => prev + (prev ? '\n' : '') + text),
    clear: () => setNewMessage(''),
  }));

  const handleSend = () => {
    if (!newMessage.trim()) return;
    onSend(newMessage);
    setNewMessage('');
  };

  const handleImageFile = (file) => {
    if (file && onImageUpload) {
      onImageUpload(file, {
        appendMessage: (text) => setNewMessage(prev => prev + (prev ? '\n' : '') + text),
        focus: () => textareaRef.current?.focus(),
        resetFileInput: () => { if (fileInputRef.current) fileInputRef.current.value = ''; },
      });
    }
  };

  const handleFileAttach = (file) => {
    if (file && onFileUpload) {
      onFileUpload(file, {
        appendMessage: (text) => setNewMessage(prev => prev + (prev ? '\n' : '') + text),
        focus: () => textareaRef.current?.focus(),
        resetFileInput: () => { if (fileAttachInputRef.current) fileAttachInputRef.current.value = ''; },
      });
    }
  };

  const insertMention = (user) => {
    const handle = user.handle || user.displayName || user.display_name;
    const before = newMessage.slice(0, mentionStartPos);
    const after = newMessage.slice(textareaRef.current?.selectionStart || mentionStartPos);
    setNewMessage(before + '@' + handle + ' ' + after);
    setShowMentionPicker(false);
    setMentionSearch('');
    setMentionStartPos(null);
    textareaRef.current?.focus();
  };

  const getMentionableUsers = () => {
    return [...(contacts || []), ...(participants || [])]
      .filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i)
      .filter(u => u.id !== currentUser?.id)
      .filter(u => {
        const name = (u.displayName || u.display_name || u.handle || '').toLowerCase();
        const handle = (u.handle || '').toLowerCase();
        return name.includes(mentionSearch) || handle.includes(mentionSearch);
      })
      .slice(0, 8);
  };

  return (
    <div style={{ padding: compact ? '8px' : undefined }}>
      {/* Reply indicator */}
      {replyingTo && (
        <div style={{
          marginBottom: '8px',
          padding: '8px 12px',
          background: 'var(--bg-hover)',
          border: '1px solid var(--border-primary)',
          borderLeft: '3px solid var(--accent-amber)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginBottom: '2px' }}>
              Replying to {replyingTo.sender_name}
            </div>
            <div style={{
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {replyingTo.content?.replace(/<[^>]*>/g, '').substring(0, 50)}...
            </div>
          </div>
          <button
            onClick={onCancelReply}
            style={{
              padding: '4px 8px',
              background: 'transparent',
              border: '1px solid var(--text-dim)',
              color: 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '0.7rem',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Media upload status */}
      {uploadingMedia && mediaUploadStatus && (
        <div style={{
          padding: '12px 16px',
          marginBottom: '10px',
          background: 'var(--accent-amber)15',
          border: '1px solid var(--accent-amber)',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: 'var(--accent-amber)',
          fontSize: '0.85rem',
          fontFamily: 'monospace',
        }}>
          <span style={{
            display: 'inline-block',
            width: '16px',
            height: '16px',
            border: '2px solid var(--accent-amber)',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          {mediaUploadStatus}
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Textarea with mention picker */}
      <div style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={newMessage}
          onChange={(e) => {
            const value = e.target.value;
            const cursorPos = e.target.selectionStart;
            setNewMessage(value);
            onTyping?.();

            // Detect @ mention
            const textBeforeCursor = value.slice(0, cursorPos);
            const atMatch = textBeforeCursor.match(/@(\w*)$/);
            if (atMatch) {
              setShowMentionPicker(true);
              setMentionSearch(atMatch[1].toLowerCase());
              setMentionStartPos(cursorPos - atMatch[0].length);
              setMentionIndex(0);
            } else {
              setShowMentionPicker(false);
              setMentionSearch('');
              setMentionStartPos(null);
            }
          }}
          onKeyDown={(e) => {
            // Handle mention picker navigation
            if (showMentionPicker) {
              const mentionableUsers = getMentionableUsers();

              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMentionIndex(i => Math.min(i + 1, mentionableUsers.length - 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex(i => Math.max(i - 1, 0));
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                if (mentionableUsers.length > 0) {
                  e.preventDefault();
                  insertMention(mentionableUsers[mentionIndex]);
                  return;
                }
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setShowMentionPicker(false);
                setMentionSearch('');
                setMentionStartPos(null);
                return;
              }
            }

            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          onPaste={(e) => {
            if (onPaste) {
              onPaste(e, {
                appendMessage: (text) => setNewMessage(prev => prev + (prev ? '\n' : '') + text),
              });
              return;
            }
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
              if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) handleImageFile(file);
                return;
              }
            }
          }}
          placeholder={placeholder || 'Type a ping... (Shift+Enter for new line, @ to mention)'}
          rows={1}
          style={{
            width: '100%',
            padding: isMobile ? '14px 16px' : (compact ? '10px 12px' : '12px 16px'),
            minHeight: isMobile ? '44px' : (compact ? '40px' : 'auto'),
            maxHeight: compact ? '150px' : '200px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            fontSize: isMobile ? '1rem' : (compact ? '0.85rem' : '0.9rem'),
            fontFamily: 'inherit',
            resize: compact ? 'vertical' : 'none',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
        />

        {/* Mention Picker */}
        {showMentionPicker && (() => {
          const mentionableUsers = getMentionableUsers();
          if (mentionableUsers.length === 0) return null;

          return (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              marginBottom: '4px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-primary)',
              maxHeight: '200px',
              overflowY: 'auto',
              zIndex: 20,
            }}>
              {mentionableUsers.map((user, idx) => (
                <div
                  key={user.id}
                  onClick={() => insertMention(user)}
                  style={{
                    padding: isMobile ? '12px' : '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    cursor: 'pointer',
                    background: idx === mentionIndex ? 'var(--bg-hover)' : 'transparent',
                    borderBottom: idx < mentionableUsers.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                >
                  <Avatar
                    letter={(user.displayName || user.display_name || user.handle || '?')[0]}
                    color="var(--accent-teal)"
                    size={24}
                    imageUrl={user.avatarUrl || user.avatar_url}
                  />
                  <div>
                    <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                      {user.displayName || user.display_name || user.handle}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                      @{user.handle}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Button row */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center', position: 'relative' }}>
        {/* Left side: media buttons */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {/* GIF button */}
          {showGifButton && onGifClick && (
            <button
              onClick={onGifClick}
              style={{
                padding: isMobile ? '8px 10px' : '8px 10px',
                minHeight: isMobile ? '38px' : '32px',
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--accent-teal)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.7rem' : '0.65rem',
                fontWeight: 700,
              }}
              title="Insert GIF"
            >
              GIF
            </button>
          )}

          {/* Photo button */}
          {showPhotoButton && (
            <div style={{ position: 'relative' }}>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageFile(file);
                }}
                accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                style={{ display: 'none' }}
              />
              <button
                onClick={() => setShowPhotoOptions(!showPhotoOptions)}
                disabled={uploading}
                style={{
                  padding: isMobile ? '8px 10px' : '8px 10px',
                  minHeight: isMobile ? '38px' : '32px',
                  background: showPhotoOptions ? 'var(--accent-orange)20' : 'transparent',
                  border: `1px solid ${showPhotoOptions ? 'var(--accent-orange)' : 'var(--border-subtle)'}`,
                  color: 'var(--accent-orange)',
                  cursor: uploading ? 'wait' : 'pointer',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.7rem' : '0.65rem',
                  fontWeight: 700,
                  opacity: uploading ? 0.7 : 1,
                }}
                title="Photo options"
              >
                {uploading ? '...' : '📷'}
              </button>
              {showPhotoOptions && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: '4px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  zIndex: 100,
                  minWidth: '120px',
                }}>
                  <button
                    onClick={() => { setShowPhotoOptions(false); fileInputRef.current?.click(); }}
                    style={{
                      display: 'block', width: '100%', padding: '10px 12px',
                      background: 'transparent', border: 'none', color: 'var(--text-primary)',
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.75rem',
                    }}
                    onMouseEnter={(e) => e.target.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                  >
                    📁 Upload Image
                  </button>
                  <button
                    onClick={() => { setShowPhotoOptions(false); onCameraClick?.(); }}
                    style={{
                      display: 'block', width: '100%', padding: '10px 12px',
                      background: 'transparent', border: 'none', color: 'var(--text-primary)',
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.75rem',
                    }}
                    onMouseEnter={(e) => e.target.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.target.style.background = 'transparent'}
                  >
                    📷 Take Photo
                  </button>
                </div>
              )}
            </div>
          )}

          {/* File attach */}
          {showFileButton && (
            <>
              <input
                type="file"
                ref={fileAttachInputRef}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileAttach(file);
                }}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileAttachInputRef.current?.click()}
                disabled={uploading}
                style={{
                  padding: isMobile ? '8px 10px' : '8px 10px',
                  minHeight: isMobile ? '38px' : '32px',
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  cursor: uploading ? 'wait' : 'pointer',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.7rem' : '0.65rem',
                  fontWeight: 700,
                  opacity: uploading ? 0.7 : 1,
                }}
                title="Attach file"
              >
                {uploading ? '...' : '📎'}
              </button>
            </>
          )}

          {/* More actions menu */}
          {showMoreMenu && (
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowActionMenu(!showActionMenu)}
                style={{
                  padding: isMobile ? '8px 10px' : '8px 10px',
                  minHeight: isMobile ? '38px' : '32px',
                  background: showActionMenu ? 'var(--bg-hover)' : 'transparent',
                  border: `1px solid ${showActionMenu ? 'var(--border-primary)' : 'var(--border-subtle)'}`,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '1rem' : '0.85rem',
                  fontWeight: 700,
                }}
                title="More actions"
              >
                ⋮
              </button>
              {showActionMenu && (
                <div style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: 0,
                  marginBottom: '4px',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-primary)',
                  borderRadius: '4px',
                  overflow: 'hidden',
                  zIndex: 100,
                  minWidth: '140px',
                }}>
                  {onAudioRecord && (
                    <button
                      onClick={() => { setShowActionMenu(false); onAudioRecord(); }}
                      disabled={uploadingMedia}
                      style={{
                        display: 'block', width: '100%', padding: '10px 12px',
                        background: 'transparent', border: 'none', color: 'var(--text-primary)',
                        cursor: uploadingMedia ? 'wait' : 'pointer', textAlign: 'left',
                        fontFamily: 'monospace', fontSize: '0.75rem',
                        opacity: uploadingMedia ? 0.7 : 1,
                      }}
                      onMouseEnter={(e) => e.target.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.target.style.background = 'transparent'}
                    >
                      🎤 Record Audio
                    </button>
                  )}
                  {onVideoRecord && (
                    <button
                      onClick={() => { setShowActionMenu(false); onVideoRecord(); }}
                      disabled={uploadingMedia}
                      style={{
                        display: 'block', width: '100%', padding: '10px 12px',
                        background: 'transparent', border: 'none', color: 'var(--text-primary)',
                        cursor: uploadingMedia ? 'wait' : 'pointer', textAlign: 'left',
                        fontFamily: 'monospace', fontSize: '0.75rem',
                        opacity: uploadingMedia ? 0.7 : 1,
                      }}
                      onMouseEnter={(e) => e.target.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.target.style.background = 'transparent'}
                    >
                      🎥 Record Video
                    </button>
                  )}
                  {plexConnections.length > 0 && onPlexClick && (
                    <button
                      onClick={() => { setShowActionMenu(false); onPlexClick(); }}
                      style={{
                        display: 'block', width: '100%', padding: '10px 12px',
                        background: 'transparent', border: 'none', color: '#e5a00d',
                        cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.75rem',
                      }}
                      onMouseEnter={(e) => e.target.style.background = 'var(--bg-hover)'}
                      onMouseLeave={(e) => e.target.style.background = 'transparent'}
                    >
                      🎬 Share Plex
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!newMessage.trim() || uploading}
          style={{
            padding: isMobile ? '10px 20px' : '8px 20px',
            minHeight: isMobile ? '38px' : '32px',
            background: newMessage.trim() ? 'var(--accent-amber)20' : 'transparent',
            border: `1px solid ${newMessage.trim() ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
            color: newMessage.trim() ? 'var(--accent-amber)' : 'var(--text-muted)',
            cursor: newMessage.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'monospace',
            fontSize: isMobile ? '0.85rem' : '0.75rem',
            flexShrink: 0,
          }}
        >
          SEND
        </button>
      </div>

      {/* Click outside handler for dropdowns */}
      {(showPhotoOptions || showActionMenu) && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
          onClick={() => { setShowPhotoOptions(false); setShowActionMenu(false); }}
        />
      )}
    </div>
  );
});

MessageComposer.displayName = 'MessageComposer';

export default MessageComposer;
