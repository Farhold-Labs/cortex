import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useE2EE } from '../../../e2ee-context.jsx';
import { useSwipeGesture } from '../../hooks/useSwipeGesture.js';
import { SUCCESS, EMPTY, formatError, CONFIRM_DIALOG } from '../../../messages.js';
import { PRIVACY_LEVELS, API_URL, BASE_URL } from '../../config/constants.js';
import { Avatar, GlowText, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { storage } from '../../utils/storage.js';
import Message from '../messages/Message.jsx';
import MessageComposer from '../compose/MessageComposer.jsx';
import GifSearchModal from '../search/GifSearchModal.jsx';

const FocusView = ({
  wave,
  focusStack, // Array of { pingId, ping } entries
  onBack, // Go back one level
  onClose, // Return to wave list
  onFocusDeeper, // Focus on a child ping
  fetchAPI,
  showToast,
  currentUser,
  isMobile,
  sendWSMessage,
  typingUsers,
  reloadTrigger,
  onShowProfile,
  blockedUsers,
  mutedUsers,
  contacts = [],
  onWaveUpdate
}) => {
  const e2ee = useE2EE();
  const currentFocus = focusStack[focusStack.length - 1];
  const initialPing = currentFocus?.ping;

  const [replyingTo, setReplyingTo] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [livePing, setLivePing] = useState(initialPing); // Live data that updates
  const [uploading, setUploading] = useState(false);
  const [showGifSearch, setShowGifSearch] = useState(false);
  const containerRef = useRef(null);
  const messagesRef = useRef(null);
  const composerRef = useRef(null);
  const lastTypingSentRef = useRef(null);

  // Swipe-back gesture for mobile navigation
  useSwipeGesture(containerRef, {
    onSwipeRight: isMobile ? () => {
      // Swipe right to go back
      if (focusStack.length > 1) {
        onBack();
      } else {
        onClose();
      }
    } : undefined,
    threshold: 80 // Slightly lower threshold for easier back navigation
  });

  // Update livePing when focus changes
  useEffect(() => {
    setLivePing(initialPing);
  }, [initialPing?.id]);

  // E2EE: Helper to decrypt a single ping and its children recursively
  const decryptPingTree = useCallback(async (node, waveId) => {
    if (!e2ee.isUnlocked) return node;

    // Decrypt this node if needed
    let decryptedNode = node;
    if (node.encrypted && node.nonce) {
      try {
        const plaintext = await e2ee.decryptPing(
          node.content,
          node.nonce,
          waveId,
          node.keyVersion
        );
        decryptedNode = { ...node, content: plaintext, _decrypted: true };
      } catch (err) {
        console.error('Failed to decrypt ping in focus view:', node.id, err);
        decryptedNode = { ...node, content: '[Unable to decrypt]', _decryptError: true };
      }
    }

    // Decrypt children recursively
    if (decryptedNode.children && decryptedNode.children.length > 0) {
      decryptedNode.children = await Promise.all(
        decryptedNode.children.map(child => decryptPingTree(child, waveId))
      );
    }

    return decryptedNode;
  }, [e2ee]);

  // Function to fetch fresh ping data
  const fetchFreshData = useCallback(async () => {
    if (!wave?.id || !initialPing?.id) return;
    try {
      // Fetch all messages for the wave and find our focused ping with updated children
      const data = await fetchAPI(`/waves/${wave.id}`);
      if (data.messages) {
        // Build tree and find our ping
        const findPing = (messages, targetId) => {
          for (const msg of messages) {
            if (msg.id === targetId) return msg;
            if (msg.children) {
              const found = findPing(msg.children, targetId);
              if (found) return found;
            }
          }
          return null;
        };
        let updated = findPing(data.messages, initialPing.id);

        // E2EE: Decrypt the focused ping and its children if wave is encrypted
        if (updated && data.encrypted && e2ee.isUnlocked) {
          updated = await decryptPingTree(updated, wave.id);
        }

        if (updated) {
          setLivePing(updated);
        }
      }
    } catch (err) {
      console.error('Failed to refresh focus view:', err);
    }
  }, [wave?.id, initialPing?.id, fetchAPI, e2ee, decryptPingTree]);

  // Fetch fresh ping data when reloadTrigger changes
  useEffect(() => {
    if (reloadTrigger > 0) {
      fetchFreshData();
    }
  }, [reloadTrigger, fetchFreshData]);

  // Use livePing for display (falls back to initialPing)
  const focusedPing = livePing || initialPing;

  // Build pings array from focused ping and its children
  const focusPings = focusedPing ? [focusedPing] : [];
  const participants = wave?.participants || [];

  // Filter out pings from blocked/muted users
  const isBlocked = (userId) => blockedUsers?.some(u => u.blockedUserId === userId) || false;
  const isMuted = (userId) => mutedUsers?.some(u => u.mutedUserId === userId) || false;

  const filterPings = (msgs) => {
    return msgs.filter(msg => {
      if (isBlocked(msg.author_id) || isMuted(msg.author_id)) return false;
      if (msg.children) {
        msg.children = filterPings(msg.children);
      }
      return true;
    });
  };

  const filteredPings = filterPings([...focusPings]);

  const config = PRIVACY_LEVELS[wave?.privacy] || PRIVACY_LEVELS.private;

  // Typing indicator
  const sendTypingIndicator = () => {
    const now = Date.now();
    if (!lastTypingSentRef.current || now - lastTypingSentRef.current > 3000) {
      sendWSMessage?.({
        type: 'typing',
        waveId: wave?.id,
        userId: currentUser?.id,
        userName: currentUser?.displayName || currentUser?.handle
      });
      lastTypingSentRef.current = now;
    }
  };

  // Handle reply - set the target and focus the textarea
  const handleReply = (message) => {
    setReplyingTo(message);
    setTimeout(() => {
      composerRef.current?.focus();
    }, 0);
  };

  const handleSend = async (content) => {
    if (!content?.trim() || !wave?.id) return;

    try {
      const parentId = replyingTo?.id || focusedPing?.id;
      await fetchAPI('/pings', {
        method: 'POST',
        body: { wave_id: wave.id, parent_id: parentId, content }
      });
      setReplyingTo(null);
      showToast(SUCCESS.pingSent, 'success');
      fetchFreshData();
    } catch (err) {
      showToast(err.message || formatError('Failed to send'), 'error');
    }
  };

  const handleImageUpload = async (file) => {
    if (!file) return;
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      showToast('Invalid file type. Allowed: jpg, png, gif, webp', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('File too large. Maximum size is 10MB', 'error');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const token = storage.getToken();
      const response = await fetch(`${API_URL}/uploads`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }
      const data = await response.json();
      composerRef.current?.appendMessage(data.url);
      composerRef.current?.focus();
      showToast('Image uploaded', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to upload image'), 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (imageTypes.includes(file.type)) { handleImageUpload(file); return; }
    if (file.size > 25 * 1024 * 1024) {
      showToast('File too large. Maximum size is 25MB', 'error');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const token = storage.getToken();
      const response = await fetch(`${API_URL}/uploads/file`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Upload failed');
      }
      const data = await response.json();
      const marker = `[file:${data.filename}:${data.size}]${data.url}`;
      composerRef.current?.appendMessage(marker);
      composerRef.current?.focus();
      showToast('File attached', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to upload file', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleReaction = async (messageId, emoji) => {
    // Save scroll position before updating
    const scrollTop = messagesRef.current?.scrollTop;
    try {
      await fetchAPI(`/pings/${messageId}/react`, {
        method: 'POST',
        body: { emoji }
      });
      // Refresh data to show reaction
      await fetchFreshData();
      // Restore scroll position
      if (messagesRef.current && scrollTop !== undefined) {
        messagesRef.current.scrollTop = scrollTop;
      }
    } catch (err) {
      showToast(formatError('Failed to react'), 'error');
    }
  };

  // Mark ping as read when clicked
  const handleMessageClick = async (messageId) => {
    try {
      await fetchAPI(`/pings/${messageId}/read`, { method: 'POST' });
      // Refresh to update UI
      await fetchFreshData();
      // Also refresh wave list to update unread counts
      onWaveUpdate?.();
    } catch (err) {
      console.error('Failed to mark ping as read:', err);
    }
  };

  const handleDeleteMessage = async (message) => {
    if (!confirm(CONFIRM_DIALOG.deleteMessage)) return;
    try {
      await fetchAPI(`/pings/${message.id}`, { method: 'DELETE' });
      showToast(SUCCESS.messageDeleted, 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to delete'), 'error');
    }
  };

  const handleStartEdit = (message) => {
    setEditingMessageId(message.id);
    setEditContent(message.content?.replace(/<[^>]*>/g, '') || '');
  };

  const handleSaveEdit = async (messageId) => {
    try {
      await fetchAPI(`/pings/${messageId}`, {
        method: 'PUT',
        body: { content: editContent }
      });
      setEditingMessageId(null);
      setEditContent('');
      showToast(SUCCESS.messageUpdated, 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to update'), 'error');
    }
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const toggleThreadCollapse = (messageId) => {
    setCollapsed(prev => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  // Share ping to external platforms
  const handleSharePing = async (ping) => {
    const shareUrl = `${BASE_URL}/share/${ping.id}`;
    const shareTitle = wave?.title || wave?.name || 'Cortex';
    const shareText = `Check out this conversation on Cortex`;

    // Try native Web Share API first
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
        showToast(SUCCESS.shared, 'success');
        return;
      } catch (err) {
        if (err.name !== 'AbortError') console.error('Share failed:', err);
      }
    }

    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(SUCCESS.copied, 'success');
    } catch (err) {
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      showToast(SUCCESS.copied, 'success');
    }
  };

  // Build breadcrumb from focus stack
  const buildBreadcrumb = () => {
    // On mobile, show more compact breadcrumb
    const maxLabelLength = isMobile ? 15 : 30;
    const truncateThreshold = isMobile ? 3 : 4;

    const waveName = wave?.name || wave?.title || 'Wave';
    const items = [
      { label: isMobile ? (waveName.substring(0, 12) + (waveName.length > 12 ? '…' : '')) : waveName, onClick: onClose, isWave: true }
    ];

    focusStack.forEach((item, index) => {
      const rawContent = item.ping?.content?.replace(/<[^>]*>/g, '') || '';
      const truncatedContent = rawContent.substring(0, maxLabelLength) +
        (rawContent.length > maxLabelLength ? '…' : '');

      if (index < focusStack.length - 1) {
        // Previous items are clickable
        items.push({
          label: truncatedContent || 'Ping',
          onClick: () => {
            // Pop stack back to this level
            for (let i = focusStack.length - 1; i > index; i--) {
              onBack();
            }
          }
        });
      } else {
        // Current item is not clickable
        items.push({ label: truncatedContent || 'Ping', current: true });
      }
    });

    // Truncate middle items based on screen size
    if (items.length > truncateThreshold) {
      const first = items[0];
      const last = items[items.length - 1];
      if (isMobile) {
        // On mobile, just show wave and current
        return [first, { label: '…', ellipsis: true }, last];
      } else {
        const secondLast = items[items.length - 2];
        return [first, { label: '...', ellipsis: true }, secondLast, last];
      }
    }

    return items;
  };

  const breadcrumb = buildBreadcrumb();

  if (!focusedPing) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)' }}>
        No ping focused
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Mobile swipe hint - shown briefly on first focus */}
      {isMobile && (
        <div style={{
          padding: '4px 12px',
          background: 'var(--accent-teal)10',
          borderBottom: '1px solid var(--accent-teal)20',
          fontSize: '0.65rem',
          color: 'var(--text-muted)',
          textAlign: 'center',
          fontFamily: 'monospace'
        }}>
          ← Swipe right to go back
        </div>
      )}
      {/* Breadcrumb Header */}
      <div style={{
        padding: isMobile ? '8px 12px' : '12px 16px',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        borderBottom: `2px solid ${config.color}40`,
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? '6px' : '8px',
        flexWrap: isMobile ? 'nowrap' : 'wrap',
        overflow: isMobile ? 'hidden' : 'visible'
      }}>
        {/* Back button */}
        <button
          onClick={focusStack.length > 1 ? onBack : onClose}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            minHeight: isMobile ? '44px' : 'auto',
            background: 'transparent',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: isMobile ? '0.85rem' : '0.75rem',
          }}
        >
          ← {focusStack.length > 1 ? 'BACK' : 'WAVE'}
        </button>

        {/* Breadcrumb trail */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
          overflow: 'hidden'
        }}>
          {breadcrumb.map((item, index) => (
            <React.Fragment key={index}>
              {index > 0 && <span style={{ color: 'var(--border-primary)' }}>›</span>}
              {item.ellipsis ? (
                <span style={{ color: 'var(--text-muted)', fontSize: isMobile ? '0.8rem' : '0.75rem' }}>...</span>
              ) : item.current ? (
                <span style={{
                  color: 'var(--accent-teal)',
                  fontSize: isMobile ? '0.85rem' : '0.8rem',
                  fontWeight: 600,
                  maxWidth: '150px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {item.label}
                </span>
              ) : (
                <button
                  onClick={item.onClick}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: item.isWave ? config.color : 'var(--text-dim)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: isMobile ? '0.85rem' : '0.8rem',
                    padding: '2px 4px',
                    maxWidth: '120px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={item.label}
                >
                  {item.label}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            minHeight: isMobile ? '44px' : 'auto',
            background: 'transparent',
            border: '1px solid var(--accent-orange)40',
            color: 'var(--accent-orange)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: isMobile ? '0.85rem' : '0.75rem',
          }}
          title="Return to wave"
        >
          ✕
        </button>
      </div>

      {/* Focus indicator */}
      <div style={{
        padding: '6px 16px',
        background: 'var(--accent-teal)10',
        borderBottom: '1px solid var(--accent-teal)30',
        fontSize: isMobile ? '0.75rem' : '0.7rem',
        color: 'var(--accent-teal)',
        fontFamily: 'monospace',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <span>⤢</span>
        <span>FOCUS VIEW</span>
        <span style={{ color: 'var(--text-muted)' }}>•</span>
        <span style={{ color: 'var(--text-dim)' }}>
          {focusedPing.children?.length || 0} {focusedPing.children?.length === 1 ? 'reply' : 'replies'}
        </span>
      </div>

      {/* Messages area */}
      <div
        ref={messagesRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: isMobile ? '12px' : '16px',
        }}
      >
        {filteredPings.map((msg) => (
          <Message
            key={msg.id}
            message={msg}
            onReply={handleReply}
            onDelete={handleDeleteMessage}
            onEdit={handleStartEdit}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            editingMessageId={editingMessageId}
            editContent={editContent}
            setEditContent={setEditContent}
            currentUserId={currentUser?.id}
            highlightId={replyingTo?.id}
            playbackIndex={null}
            collapsed={collapsed}
            onToggleCollapse={toggleThreadCollapse}
            isMobile={isMobile}
            onReact={handleReaction}
            onMessageClick={handleMessageClick}
            participants={participants}
            contacts={contacts}
            onShowProfile={onShowProfile}
            onFocus={onFocusDeeper ? (ping) => onFocusDeeper(ping) : undefined}
            onShare={handleSharePing}
            wave={wave}
            currentWaveId={wave?.id}
            fetchAPI={fetchAPI}
          />
        ))}
      </div>

      {/* Typing Indicator */}
      {typingUsers && Object.keys(typingUsers).length > 0 && (
        <div style={{
          padding: isMobile ? '8px 12px' : '6px 20px',
          color: 'var(--text-dim)',
          fontSize: isMobile ? '0.85rem' : '0.75rem',
          fontStyle: 'italic',
          borderTop: '1px solid var(--bg-hover)',
          background: 'var(--bg-elevated)',
        }}>
          {Object.values(typingUsers).map(u => u.name).join(', ')} {Object.keys(typingUsers).length === 1 ? 'is' : 'are'} typing...
        </div>
      )}

      {/* Compose area */}
      <div style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        padding: isMobile ? '12px' : '16px',
      }}>
        <MessageComposer
          ref={composerRef}
          participants={participants}
          contacts={contacts}
          currentUser={currentUser}
          isMobile={isMobile}
          onSend={handleSend}
          onTyping={sendTypingIndicator}
          placeholder={replyingTo ? `Reply to ${replyingTo.sender_name}...` : 'Type a ping... (Shift+Enter for new line, @ to mention)'}
          replyingTo={replyingTo}
          onCancelReply={() => setReplyingTo(null)}
          uploading={uploading}
          onGifClick={() => setShowGifSearch(true)}
          onImageUpload={(file) => handleImageUpload(file)}
          onFileUpload={(file) => handleFileUpload(file)}
          onCameraClick={null}
          showMoreMenu={false}
          compact
        />
      </div>

      {showGifSearch && (
        <GifSearchModal
          isOpen={showGifSearch}
          onClose={() => setShowGifSearch(false)}
          onSelect={(gifUrl) => {
            composerRef.current?.appendMessage(gifUrl);
            setShowGifSearch(false);
          }}
          fetchAPI={fetchAPI}
          isMobile={isMobile}
        />
      )}
    </div>
  );
};


export default FocusView;
