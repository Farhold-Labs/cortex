import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useE2EE } from '../../../e2ee-context.jsx';
import { SUCCESS, formatError, CONFIRM_DIALOG } from '../../../messages.js';
import { PRIVACY_LEVELS, API_URL, THREAD_DEPTH_LIMIT } from '../../config/constants.js';
import { Avatar } from '../ui/SimpleComponents.jsx';
import { storage } from '../../utils/storage.js';
import Message from '../messages/Message.jsx';
import MessageComposer from '../compose/MessageComposer.jsx';
import GifSearchModal from '../search/GifSearchModal.jsx';

const ThreadPanel = ({
  wave,
  rootMessage,
  onClose,
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
  participants = [],
  onWaveUpdate,
  moveSource,
  onStartMove,
  onCompleteMove,
}) => {
  const e2ee = useE2EE();

  const [replyingTo, setReplyingTo] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [liveRoot, setLiveRoot] = useState(rootMessage);
  const [uploading, setUploading] = useState(false);
  const [showGifSearch, setShowGifSearch] = useState(false);
  const [useOverlay, setUseOverlay] = useState(false);
  const messagesRef = useRef(null);
  const composerRef = useRef(null);
  const lastTypingSentRef = useRef(null);
  const panelRef = useRef(null);

  // Update liveRoot when rootMessage prop changes
  useEffect(() => {
    setLiveRoot(rootMessage);
  }, [rootMessage?.id]);

  // Desktop: switch to overlay when wave view would be < 40% of container
  useEffect(() => {
    if (isMobile) return;
    const panel = panelRef.current;
    if (!panel) return;
    const container = panel.parentElement;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      const containerWidth = entry.contentRect.width;
      // Panel is 400px; if wave view gets < 40% of container, overlay instead
      const waveViewWidth = containerWidth - 400;
      setUseOverlay(waveViewWidth < containerWidth * 0.4);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [isMobile]);

  // E2EE: Decrypt a ping tree recursively
  const decryptPingTree = useCallback(async (node, waveId) => {
    if (!e2ee.isUnlocked) return node;

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
        console.error('Failed to decrypt ping in thread panel:', node.id, err);
        decryptedNode = { ...node, content: '[Unable to decrypt]', _decryptError: true };
      }
    }

    if (decryptedNode.children && decryptedNode.children.length > 0) {
      decryptedNode.children = await Promise.all(
        decryptedNode.children.map(child => decryptPingTree(child, waveId))
      );
    }

    return decryptedNode;
  }, [e2ee]);

  // Fetch fresh data for the root message
  const fetchFreshData = useCallback(async () => {
    if (!wave?.id || !rootMessage?.id) return;
    try {
      const data = await fetchAPI(`/waves/${wave.id}`);
      if (data.messages) {
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
        let updated = findPing(data.messages, rootMessage.id);

        if (updated && data.encrypted && e2ee.isUnlocked) {
          updated = await decryptPingTree(updated, wave.id);
        }

        if (updated) {
          setLiveRoot(updated);
        }
      }
    } catch (err) {
      console.error('Failed to refresh thread panel:', err);
    }
  }, [wave?.id, rootMessage?.id, fetchAPI, e2ee, decryptPingTree]);

  // Track if user is at bottom before reload, so we can auto-scroll after
  const wasAtBottomRef = useRef(true);

  // Refresh when reloadTrigger changes
  useEffect(() => {
    if (reloadTrigger > 0) {
      const container = messagesRef.current;
      if (container) {
        wasAtBottomRef.current = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
      }
      fetchFreshData();
    }
  }, [reloadTrigger, fetchFreshData]);

  // Auto-scroll to bottom when liveRoot updates and user was at bottom
  useEffect(() => {
    if (wasAtBottomRef.current && messagesRef.current) {
      setTimeout(() => {
        if (messagesRef.current) {
          messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
        }
      }, 50);
    }
  }, [liveRoot]);

  const focusedRoot = liveRoot || rootMessage;
  const config = PRIVACY_LEVELS[wave?.privacy] || PRIVACY_LEVELS.private;

  // Filter out blocked/muted users
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

  const handleReply = (message) => {
    setReplyingTo(message);
    setTimeout(() => {
      composerRef.current?.focus();
    }, 0);
  };

  const handleSend = async (content) => {
    if (!content?.trim() || !wave?.id) return;

    try {
      // Determine parent: if replying to something, use that; otherwise reply to root
      let parentId = replyingTo?.id || focusedRoot?.id;

      // Enforce depth 2 max: if target is at depth 1 within thread, replies go to it
      // If target is at depth 2+, re-parent to its depth-1 ancestor
      if (replyingTo && replyingTo._threadDepth >= THREAD_DEPTH_LIMIT) {
        // Find the depth-1 ancestor
        parentId = replyingTo._threadParentId || focusedRoot?.id;
      }

      await fetchAPI('/pings', {
        method: 'POST',
        body: { wave_id: wave.id, parent_id: parentId, content, isThreadReply: true }
      });
      setReplyingTo(null);
      showToast(SUCCESS.pingSent, 'success');
      wasAtBottomRef.current = true; // Always scroll to bottom after own send
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
    const scrollTop = messagesRef.current?.scrollTop;
    try {
      await fetchAPI(`/pings/${messageId}/react`, {
        method: 'POST',
        body: { emoji }
      });
      await fetchFreshData();
      if (messagesRef.current && scrollTop !== undefined) {
        messagesRef.current.scrollTop = scrollTop;
      }
    } catch (err) {
      showToast(formatError('Failed to react'), 'error');
    }
  };

  const handleMessageClick = async (messageId) => {
    try {
      await fetchAPI(`/pings/${messageId}/read`, { method: 'POST' });
      await fetchFreshData();
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

  if (!focusedRoot) return null;

  // Annotate children with thread depth info for depth limiting
  const annotateDepth = (node, depth = 0) => {
    const annotated = { ...node, _threadDepth: depth, _threadParentId: depth > 0 ? focusedRoot.id : null };
    if (node.children) {
      annotated.children = node.children.map(child => {
        const childAnnotated = annotateDepth(child, depth + 1);
        // At depth 1, track the parent so depth-2 replies can re-parent
        if (depth === 0) {
          childAnnotated._threadParentId = child.id;
        } else {
          childAnnotated._threadParentId = node._threadParentId || node.id;
        }
        return childAnnotated;
      });
    }
    return annotated;
  };

  const annotatedRoot = annotateDepth(focusedRoot);
  const threadReplies = annotatedRoot.children ? filterPings([...annotatedRoot.children]) : [];
  const replyCount = focusedRoot.reply_count || focusedRoot.children?.length || 0;

  // Get parent message content preview
  const parentPreview = focusedRoot.content?.replace(/<[^>]*>/g, '').substring(0, 120) || '';
  const parentAuthor = focusedRoot.user_display_name || focusedRoot.sender_name || 'Unknown';

  // Desktop: side panel (or overlay when narrow). Mobile: fills content area (like FocusView).
  const panelStyle = isMobile
    ? {
        flex: 1,
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-base)',
        minHeight: 0, overflow: 'hidden',
      }
    : useOverlay
    ? {
        position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 40,
        width: '100%',
        display: 'flex', flexDirection: 'column',
        borderLeft: `2px solid ${config.color}40`,
        background: 'var(--bg-base)',
      }
    : {
        width: '400px', flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        borderLeft: `2px solid ${config.color}40`,
        background: 'var(--bg-base)',
        minHeight: 0, overflow: 'hidden',
      };

  return (
    <div ref={panelRef} style={panelStyle}>
      {/* Header */}
      <div style={{
        padding: isMobile ? '12px 16px' : '10px 14px',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        borderBottom: `2px solid ${config.color}40`,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
      }}>
        <button
          onClick={onClose}
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
          {isMobile ? '← BACK' : '✕'}
        </button>
        <div style={{ flex: 1 }}>
          <div style={{
            color: 'var(--accent-teal)',
            fontSize: isMobile ? '0.85rem' : '0.8rem',
            fontWeight: 600,
            fontFamily: 'monospace',
          }}>
            THREAD
          </div>
          <div style={{
            color: 'var(--text-muted)',
            fontSize: '0.7rem',
            fontFamily: 'monospace',
          }}>
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </div>
        </div>
      </div>

      {/* Parent message context */}
      <div style={{
        padding: isMobile ? '12px 16px' : '10px 14px',
        background: 'var(--accent-teal)08',
        borderBottom: '1px solid var(--accent-teal)20',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px',
        }}>
          <Avatar user={focusedRoot} size={isMobile ? '24px' : '20px'} />
          <span style={{
            color: 'var(--accent-teal)',
            fontSize: '0.8rem',
            fontWeight: 600,
          }}>
            {parentAuthor}
          </span>
        </div>
        <div style={{
          color: 'var(--text-dim)',
          fontSize: '0.75rem',
          lineHeight: 1.4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
        }}>
          {parentPreview}
        </div>
      </div>

      {/* Thread replies */}
      <div
        ref={messagesRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: isMobile ? '12px' : '12px 14px',
        }}
      >
        {threadReplies.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '24px',
            color: 'var(--text-muted)', fontSize: '0.8rem',
            fontFamily: 'monospace',
          }}>
            No replies yet
          </div>
        ) : (
          threadReplies.map((msg) => (
            <Message
              key={msg.id}
              message={msg}
              depth={0}
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
              isInThreadPanel
              wave={wave}
              currentWaveId={wave?.id}
              fetchAPI={fetchAPI}
              currentUser={currentUser} moveSource={moveSource} onStartMove={onStartMove} onCompleteMove={onCompleteMove}
            />
          ))
        )}
      </div>

      {/* Typing indicator */}
      {typingUsers && Object.keys(typingUsers).length > 0 && (
        <div style={{
          padding: isMobile ? '8px 12px' : '6px 14px',
          color: 'var(--text-dim)',
          fontSize: isMobile ? '0.85rem' : '0.75rem',
          fontStyle: 'italic',
          borderTop: '1px solid var(--bg-hover)',
          background: 'var(--bg-elevated)',
        }}>
          {Object.values(typingUsers).map(u => u.name).join(', ')} {Object.keys(typingUsers).length === 1 ? 'is' : 'are'} typing...
        </div>
      )}

      {/* Composer */}
      <div style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-elevated)',
        padding: isMobile ? '12px' : '10px 14px',
        flexShrink: 0,
      }}>
        <MessageComposer
          ref={composerRef}
          participants={participants}
          contacts={contacts}
          currentUser={currentUser}
          isMobile={isMobile}
          onSend={handleSend}
          onTyping={sendTypingIndicator}
          placeholder={replyingTo ? `Reply to ${replyingTo.sender_name || replyingTo.user_display_name}...` : 'Reply in thread...'}
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

export default ThreadPanel;
