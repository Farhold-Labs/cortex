import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Avatar } from '../ui/SimpleComponents.jsx';
import { searchEmoji, resolveEmojiShortcodes, EMOJI_MAP } from '../../config/emojiData.js';
import { mediaEmbedHtml } from '../../utils/embed.js';

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
  fetchAPI,
}, ref) => {
  const [newMessage, setNewMessage] = useState('');
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [emojiIndex, setEmojiIndex] = useState(0);
  const [emojiStartPos, setEmojiStartPos] = useState(null);
  const [serverMentionResults, setServerMentionResults] = useState([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [gifSearch, setGifSearch] = useState('');
  const [gifResults, setGifResults] = useState([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifStartPos, setGifStartPos] = useState(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const fileAttachInputRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const gifSearchTimeoutRef = useRef(null);

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
    onSend(resolveEmojiShortcodes(newMessage));
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

  const insertEmoji = (emoji) => {
    const cursorPos = textareaRef.current?.selectionStart ?? newMessage.length;
    const before = newMessage.slice(0, emojiStartPos);
    const after = newMessage.slice(cursorPos);
    setNewMessage(before + emoji.char + ' ' + after);
    setShowEmojiPicker(false);
    setEmojiSearch('');
    setEmojiStartPos(null);
    setTimeout(() => {
      const pos = emojiStartPos + emoji.char.length + 1;
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    }, 0);
  };

  // Server search fallback for mentions — catches stale/missing local participant data
  useEffect(() => {
    if (!mentionSearch || !fetchAPI || !showMentionPicker) {
      setServerMentionResults([]);
      return;
    }
    const timer = setTimeout(() => {
      fetchAPI(`/users/search?q=${encodeURIComponent(mentionSearch)}`)
        .then(data => setServerMentionResults(data.users || []))
        .catch(() => setServerMentionResults([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [mentionSearch, showMentionPicker]);

  // Scroll active emoji row into view when index changes
  useEffect(() => {
    if (!showEmojiPicker || !emojiPickerRef.current) return;
    const active = emojiPickerRef.current.querySelector('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [emojiIndex, showEmojiPicker]);

  // Fetch GIFs when /gif search term changes
  useEffect(() => {
    if (!showGifPicker || !fetchAPI) return;
    if (gifSearchTimeoutRef.current) clearTimeout(gifSearchTimeoutRef.current);
    const delay = gifSearch.trim() ? 350 : 0;
    gifSearchTimeoutRef.current = setTimeout(async () => {
      setGifLoading(true);
      try {
        if (gifSearch.trim()) {
          const data = await fetchAPI(`/gifs/search?q=${encodeURIComponent(gifSearch.trim())}&limit=12`);
          setGifResults(data.gifs || []);
        } else {
          // No search term: show favorites first, then trending to fill.
          const [favData, trendData] = await Promise.all([
            fetchAPI('/gifs/favorites').catch(() => ({ gifs: [] })),
            fetchAPI('/gifs/trending?limit=12').catch(() => ({ gifs: [] })),
          ]);
          const favs = favData.gifs || [];
          const favKeys = new Set(favs.map(g => `${g.provider}:${g.id}`));
          const trend = (trendData.gifs || []).filter(g => !favKeys.has(`${g.provider}:${g.id}`));
          setGifResults([...favs, ...trend].slice(0, 12));
        }
      } catch { setGifResults([]); }
      finally { setGifLoading(false); }
    }, delay);
    return () => { if (gifSearchTimeoutRef.current) clearTimeout(gifSearchTimeoutRef.current); };
  }, [gifSearch, showGifPicker]);

  const insertGif = (gifUrl) => {
    const gifHtml = mediaEmbedHtml(gifUrl);
    const before = newMessage.slice(0, gifStartPos ?? 0);
    const after = newMessage.slice(textareaRef.current?.selectionStart ?? (gifStartPos ?? 0));
    setNewMessage(before + gifHtml + after);
    setShowGifPicker(false);
    setGifSearch('');
    setGifResults([]);
    setGifStartPos(null);
    textareaRef.current?.focus();
  };

  const getMentionableUsers = () => {
    const search = mentionSearch.toLowerCase();
    // @everyone — shown when search is empty or matches 'everyone'
    const everyoneOption = (!search || 'everyone'.includes(search))
      ? [{ id: '__everyone__', handle: 'everyone', displayName: 'Everyone', _isEveryone: true }]
      : [];

    const local = [...(contacts || []), ...(participants || [])]
      .filter(u => u.id !== currentUser?.id)
      .filter(u => {
        const name = (u.displayName || u.display_name || u.name || u.handle || '').toLowerCase();
        const handle = (u.handle || '').toLowerCase();
        return !search || name.includes(search) || handle.includes(search);
      });
    // Merge server results, deduplicating by id
    const merged = [...local, ...serverMentionResults.filter(u => u.id !== currentUser?.id)]
      .filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i);
    return [...everyoneOption, ...merged.slice(0, 8)];
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

      {/* Input row: [+] [textarea] [SEND] */}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
        <div style={{ position: 'relative', flexShrink: 0, alignSelf: 'flex-end' }}>
          <input type="file" ref={fileInputRef} onChange={(e) => { const file = e.target.files?.[0]; if (file) handleImageFile(file); }} accept="image/jpeg,image/jpg,image/png,image/gif,image/webp" style={{ display: 'none' }} />
          <input type="file" ref={fileAttachInputRef} onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileAttach(file); }} style={{ display: 'none' }} />
          <button
            onClick={() => setShowAttachMenu(!showAttachMenu)}
            title="Attach media or file"
            style={{
              padding: isMobile ? '8px 10px' : '5px 8px',
              minHeight: isMobile ? '36px' : '28px',
              background: showAttachMenu ? 'var(--bg-hover)' : 'transparent',
              border: `1px solid ${showAttachMenu ? 'var(--border-primary)' : 'var(--border-subtle)'}`,
              color: showAttachMenu ? 'var(--accent-amber)' : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '1.1rem' : '1rem',
              lineHeight: 1,
            }}
          >⋮</button>
          {showAttachMenu && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, marginBottom: '4px',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)', zIndex: 100, minWidth: '148px',
            }}>
              {showGifButton && onGifClick && (
                <button onClick={() => { setShowAttachMenu(false); onGifClick(); }}
                  style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-subtle)', color: 'var(--accent-teal)', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 700 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >GIF</button>
              )}
              {showPhotoButton && (
                <button onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }}
                  style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.75rem' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >📁 Upload Image</button>
              )}
              {showPhotoButton && onCameraClick && (
                <button onClick={() => { setShowAttachMenu(false); onCameraClick(); }}
                  style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.75rem' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >📷 Take Photo</button>
              )}
              {showFileButton && (
                <button onClick={() => { setShowAttachMenu(false); fileAttachInputRef.current?.click(); }}
                  style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.75rem' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >📎 Attach File</button>
              )}
              {onAudioRecord && (
                <button onClick={() => { setShowAttachMenu(false); onAudioRecord(); }} disabled={uploadingMedia}
                  style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', cursor: uploadingMedia ? 'wait' : 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.75rem', opacity: uploadingMedia ? 0.7 : 1 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >🎤 Record Audio</button>
              )}
              {onVideoRecord && (
                <button onClick={() => { setShowAttachMenu(false); onVideoRecord(); }} disabled={uploadingMedia}
                  style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-primary)', cursor: uploadingMedia ? 'wait' : 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.75rem', opacity: uploadingMedia ? 0.7 : 1 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >🎥 Record Video</button>
              )}
              {plexConnections.length > 0 && onPlexClick && (
                <button onClick={() => { setShowAttachMenu(false); onPlexClick(); }}
                  style={{ display: 'block', width: '100%', padding: '9px 12px', background: 'transparent', border: 'none', color: '#e5a00d', cursor: 'pointer', textAlign: 'left', fontFamily: 'monospace', fontSize: '0.75rem' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >🎬 Share Plex</button>
              )}
            </div>
          )}
        </div>
        <div style={{ position: 'relative', flex: 1 }}>
        <textarea
          ref={textareaRef}
          value={newMessage}
          onChange={(e) => {
            const value = e.target.value;
            const cursorPos = e.target.selectionStart;
            setNewMessage(value);
            onTyping?.();

            const textBeforeCursor = value.slice(0, cursorPos);

            // Detect @ mention
            const atMatch = textBeforeCursor.match(/@(\w*)$/);
            if (atMatch) {
              setShowMentionPicker(true);
              setMentionSearch(atMatch[1].toLowerCase());
              setMentionStartPos(cursorPos - atMatch[0].length);
              setMentionIndex(0);
              setShowEmojiPicker(false);
            } else {
              setShowMentionPicker(false);
              setMentionSearch('');
              setMentionStartPos(null);
            }

            // Detect :emoji shortcode
            const completedMatch = !atMatch && textBeforeCursor.match(/:([a-z0-9_+\-]+):$/);
            if (completedMatch) {
              const emojiChar = EMOJI_MAP.get(completedMatch[1].toLowerCase());
              if (emojiChar) {
                const matchStart = cursorPos - completedMatch[0].length;
                setNewMessage(value.slice(0, matchStart) + emojiChar + ' ' + value.slice(cursorPos));
                const newPos = matchStart + emojiChar.length + 1;
                setTimeout(() => { textareaRef.current?.setSelectionRange(newPos, newPos); }, 0);
              }
              setShowEmojiPicker(false);
              setEmojiSearch('');
              setEmojiStartPos(null);
            } else {
              const colonMatch = !atMatch && textBeforeCursor.match(/:([a-z0-9_+\-]*)$/);
              if (colonMatch) {
                setShowEmojiPicker(true);
                setEmojiSearch(colonMatch[1].toLowerCase());
                setEmojiStartPos(cursorPos - colonMatch[0].length);
                setEmojiIndex(0);
              } else if (!atMatch) {
                setShowEmojiPicker(false);
                setEmojiSearch('');
                setEmojiStartPos(null);
              }

              // Detect /gif command
              const gifMatch = !atMatch && textBeforeCursor.match(/(^|\s)(\/gif(\s+.*)?)$/);
              if (gifMatch) {
                const gifText = gifMatch[2]; // "/gif" or "/gif searchterm"
                const search = gifText.replace(/^\/gif\s*/, '');
                if (compact && onGifClick) {
                  // In tight panels (threads/focus) the inline popup is clipped by
                  // overflow:hidden ancestors, so /gif appeared to do nothing.
                  // Strip the "/gif" text and open the full-screen GIF modal instead.
                  const startPos = cursorPos - gifText.length;
                  setNewMessage(v => v.slice(0, startPos) + v.slice(cursorPos));
                  setShowGifPicker(false);
                  setGifSearch('');
                  setGifStartPos(null);
                  onGifClick();
                } else {
                  setShowGifPicker(true);
                  setGifSearch(search);
                  setGifStartPos(cursorPos - gifText.length);
                }
              } else {
                setShowGifPicker(false);
                setGifSearch('');
                setGifStartPos(null);
              }
            }
          }}
          onKeyDown={(e) => {
            // Handle GIF picker dismiss
            if (showGifPicker && e.key === 'Escape') {
              e.preventDefault();
              setShowGifPicker(false); setGifSearch(''); setGifResults([]); setGifStartPos(null); return;
            }

            // Handle emoji picker navigation
            if (showEmojiPicker) {
              const results = searchEmoji(emojiSearch);
              if (e.key === 'ArrowDown') { e.preventDefault(); setEmojiIndex(i => Math.min(i + 1, results.length - 1)); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setEmojiIndex(i => Math.max(i - 1, 0)); return; }
              if (e.key === 'Enter' || e.key === 'Tab') {
                if (results.length > 0) { e.preventDefault(); insertEmoji(results[emojiIndex]); return; }
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setShowEmojiPicker(false); setEmojiSearch(''); setEmojiStartPos(null); return;
              }
            }

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
          placeholder={placeholder || 'Shift+Enter for new line, @ to mention'}
          rows={1}
          style={{
            width: '100%',
            padding: isMobile ? '10px 12px' : (compact ? '7px 10px' : '8px 10px'),
            minHeight: isMobile ? '44px' : (compact ? '40px' : 'auto'),
            maxHeight: compact ? '150px' : '200px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)',
            fontSize: isMobile ? '1rem' : (compact ? '0.85rem' : '0.9rem'),
            fontFamily: 'var(--message-font, inherit)',
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
                  {user._isEveryone ? (
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%',
                      background: 'var(--accent-amber)20', border: '1px solid var(--accent-amber)60',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.7rem', color: 'var(--accent-amber)', flexShrink: 0,
                    }}>@</div>
                  ) : (
                    <Avatar
                      letter={(user.displayName || user.display_name || user.handle || '?')[0]}
                      color="var(--accent-teal)"
                      size={24}
                      imageUrl={user.avatarUrl || user.avatar_url}
                    />
                  )}
                  <div>
                    <div style={{ color: user._isEveryone ? 'var(--accent-amber)' : 'var(--text-primary)', fontSize: '0.85rem' }}>
                      {user.displayName || user.display_name || user.handle}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                      @{user.handle}{user._isEveryone ? ' — notify all participants' : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Emoji Picker */}
        {showEmojiPicker && (() => {
          const results = searchEmoji(emojiSearch);
          if (results.length === 0) return null;
          return (
            <div ref={emojiPickerRef} style={{
              position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: '4px',
              background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
              maxHeight: '200px', overflowY: 'auto', zIndex: 20,
            }}>
              {results.map((emoji, idx) => (
                <div
                  key={emoji.name}
                  data-active={idx === emojiIndex ? 'true' : 'false'}
                  onClick={() => insertEmoji(emoji)}
                  style={{
                    padding: isMobile ? '10px 12px' : '6px 12px',
                    display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                    background: idx === emojiIndex ? 'var(--bg-hover)' : 'transparent',
                    borderBottom: idx < results.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                  }}
                >
                  <span style={{ fontSize: '1.2rem', lineHeight: 1, width: 24, textAlign: 'center' }}>{emoji.char}</span>
                  <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.8rem' }}>:{emoji.name}:</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* GIF Picker (triggered by /gif search) */}
        {showGifPicker && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: '4px',
            background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
            maxHeight: '220px', overflowY: 'auto', zIndex: 20,
          }}>
            <div style={{ padding: '4px 8px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: 'var(--accent-teal)', fontFamily: 'monospace', fontSize: '0.65rem', fontWeight: 700 }}>GIF</span>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.65rem' }}>{gifSearch ? `"${gifSearch}"` : '★ favorites + trending'}</span>
              <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.6rem', marginLeft: 'auto' }}>esc to close</span>
            </div>
            {gifLoading ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-dim)', fontFamily: 'monospace', fontSize: '0.75rem' }}>searching...</div>
            ) : gifResults.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.75rem' }}>no results</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '3px', padding: '3px' }}>
                {gifResults.map((gif) => (
                  <button
                    key={gif.id}
                    onClick={() => insertGif(gif.url)}
                    title={gif.title}
                    style={{ padding: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', cursor: 'pointer', aspectRatio: '1', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <img src={gif.preview} alt={gif.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        </div>

        <button
          onClick={handleSend}
          disabled={!newMessage.trim() || uploading}
          style={{
            padding: isMobile ? '8px 16px' : '6px 12px',
            minHeight: isMobile ? '36px' : '28px',
            background: newMessage.trim() ? 'var(--accent-amber)20' : 'transparent',
            border: `1px solid ${newMessage.trim() ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
            color: newMessage.trim() ? 'var(--accent-amber)' : 'var(--text-muted)',
            cursor: newMessage.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'monospace',
            fontSize: isMobile ? '0.85rem' : '0.75rem',
            flexShrink: 0,
            alignSelf: 'flex-end',
          }}
        >
          SEND
        </button>
      </div>

      {/* (toolbar removed — all attach options in ⋮ menu) */}
      {false && <div>
          {/* GIF button */}
          {showGifButton && onGifClick && (
            <button
              onClick={onGifClick}
              style={{
                padding: isMobile ? '8px 10px' : '6px 8px',
                minHeight: isMobile ? '36px' : '28px',
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--accent-teal)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.7rem' : '0.65rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
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
        </div>}

      {showAttachMenu && (
        <div
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }}
          onClick={() => setShowAttachMenu(false)}
        />
      )}
    </div>
  );
});

MessageComposer.displayName = 'MessageComposer';

export default MessageComposer;
