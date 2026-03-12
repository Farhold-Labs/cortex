import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useE2EE } from '../../../e2ee-context.jsx';
import { useVoiceCall } from '../../hooks/useVoiceCall.js';
import { SUCCESS, EMPTY, CONFIRM, CONFIRM_DIALOG, formatError, GHOST_PROTOCOL } from '../../../messages.js';
import { PRIVACY_LEVELS, API_URL, BASE_URL } from '../../config/constants.js';
import { Avatar, GlowText, PrivacyBadge, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { LegacyWaveNotice, PartialEncryptionBanner } from '../../../e2ee-components.jsx';
import ImageLightbox from '../ui/ImageLightbox.jsx';
import Message from '../messages/Message.jsx';
import GifSearchModal from '../search/GifSearchModal.jsx';
import PlaybackControls from './PlaybackControls.jsx';
import DeleteConfirmModal from './DeleteConfirmModal.jsx';
import WaveSettingsModal from './WaveSettingsModal.jsx';
import ReportModal from '../reports/ReportModal.jsx';
// BurstModal removed in v2.38.0 — replaced by ThreadPanel
import CallModal from '../calls/CallModal.jsx';
import InviteToWaveModal from './InviteToWaveModal.jsx';
import InviteFederatedModal from './InviteFederatedModal.jsx';
import MediaRecorder from '../media/MediaRecorder.jsx';
import CameraCapture from '../media/CameraCapture.jsx';
import PlexBrowserModal from '../media/PlexBrowserModal.jsx';
import { createPlexUrl } from '../media/PlexEmbed.jsx';
import WatchPartyBanner from '../media/WatchPartyBanner.jsx';
import { storage } from '../../utils/storage.js';
import MessageComposer from '../compose/MessageComposer.jsx';

const WaveView = ({ wave, onBack, fetchAPI, showToast, currentUser, groups, onWaveUpdate, isMobile, sendWSMessage, typingUsers, reloadTrigger, contacts, contactRequests, sentContactRequests, onRequestsChange, onContactsChange, blockedUsers, mutedUsers, onBlockUser, onUnblockUser, onMuteUser, onUnmuteUser, onBlockedMutedChange, onShowProfile, onFocusPing, onNavigateToWave, scrollToMessageId, onScrollToMessageComplete, federationEnabled, activeWatchParty, onJoinWatchParty, onLeaveWatchParty, onOpenWatchParty, onWatchPartiesChange, onOpenThread, moveSource, onStartMove, onCompleteMove }) => {
  // E2EE context
  const e2ee = useE2EE();

  // Voice call hook (v2.4.0 - LiveKit)
  const voiceCall = useVoiceCall(wave?.id);

  const [waveData, setWaveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState(null);
  const [newMessage, setNewMessage] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    // Load collapsed state from localStorage per wave
    try {
      const saved = localStorage.getItem(`farhold_collapsed_${wave.id}`);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  // Content collapse state (v2.23.0 - for message body, separate from thread collapse)
  const [contentCollapsed, setContentCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(`farhold_content_collapsed_${wave.id}`);
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState(null);
  const [showGifSearch, setShowGifSearch] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(null);
  const [showPlayback, setShowPlayback] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [requestModalParticipant, setRequestModalParticipant] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reportTarget, setReportTarget] = useState(null); // { type, targetId, targetPreview }
  const [showFederateModal, setShowFederateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [decryptionErrors, setDecryptionErrors] = useState({}); // Track pings that failed to decrypt
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState('');
  const [decryptingWave, setDecryptingWave] = useState(false); // Wave decryption in progress
  const [showWaveMenu, setShowWaveMenu] = useState(false); // Wave header actions menu
  const [showCallModal, setShowCallModal] = useState(false); // Voice/Video call modal
  const [showMediaRecorder, setShowMediaRecorder] = useState(null); // 'audio' | 'video' | null (v2.7.0)
  const [uploadingMedia, setUploadingMedia] = useState(false); // Media upload in progress
  const [mediaUploadStatus, setMediaUploadStatus] = useState(''); // Status message during upload
  const [showCameraCapture, setShowCameraCapture] = useState(false); // Camera capture for image upload (v2.7.0)
  const [showPlexBrowser, setShowPlexBrowser] = useState(false); // Plex media browser (v2.15.0)
  const [plexConnections, setPlexConnections] = useState([]); // User's Plex connections
  const [showActionMenu, setShowActionMenu] = useState(false); // Overflow menu for additional actions
  const [showPhotoOptions, setShowPhotoOptions] = useState(false); // Photo button dropdown (IMG/CAM)

  // E2EE Migration state
  const [encryptionStatus, setEncryptionStatus] = useState(null); // { state, progress, participantsWithE2EE, totalParticipants }
  const [isEnablingEncryption, setIsEnablingEncryption] = useState(false);
  const [isEncryptingBatch, setIsEncryptingBatch] = useState(false);

  // Auto-open call modal if URL has call parameter (for pop-out windows)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const callWaveId = urlParams.get('call');
    const isPopout = urlParams.get('popout') === 'true';

    if (callWaveId && isPopout && callWaveId === wave?.id && !showCallModal) {
      // Auto-join the call in pop-out window
      setShowCallModal(true);
      setTimeout(() => {
        if (voiceCall.connectionState === 'disconnected') {
          voiceCall.startCall();
        }
      }, 500);
    }
  }, [wave?.id, showCallModal, voiceCall]);

  // Note: Call status polling is handled by useVoiceCall hook when waveId is provided

  // Load Plex connections (v2.15.0)
  useEffect(() => {
    const loadPlexConnections = async () => {
      try {
        const data = await fetchAPI('/plex/connections');
        setPlexConnections(data.connections || []);
      } catch (err) {
        // Silently fail - user may not have Plex feature enabled
        console.debug('Plex connections not available:', err.message);
      }
    };
    loadPlexConnections();
  }, [fetchAPI]);

  const playbackRef = useRef(null);
  const fileInputRef = useRef(null);
  const fileAttachInputRef = useRef(null);

  // Helper functions for participant contact status
  const isContact = (userId) => contacts?.some(c => c.id === userId) || false;
  const hasSentRequestTo = (userId) => sentContactRequests?.some(r => r.to_user_id === userId) || false;
  const hasReceivedRequestFrom = (userId) => contactRequests?.some(r => r.from_user_id === userId) || false;

  // Helper functions for blocked/muted status
  const isBlocked = (userId) => blockedUsers?.some(u => u.blockedUserId === userId) || false;
  const isMuted = (userId) => mutedUsers?.some(u => u.mutedUserId === userId) || false;

  // E2EE: Helper to decrypt pings
  const decryptMessages = useCallback(async (pings, waveId) => {
    if (!e2ee.isUnlocked) return pings;

    const errors = {};
    const decrypted = await Promise.all(
      pings.map(async (ping) => {
        if (!ping.encrypted || !ping.nonce) {
          return ping; // Not encrypted
        }
        try {
          const plaintext = await e2ee.decryptPing(
            ping.content,
            ping.nonce,
            waveId,
            ping.keyVersion
          );
          return { ...ping, content: plaintext, _decrypted: true };
        } catch (err) {
          console.error(`❌ Failed to decrypt ping ${ping.id}:`, err.message);
          errors[ping.id] = err.message;
          return { ...ping, content: '[Unable to decrypt]', _decryptError: true };
        }
      })
    );
    setDecryptionErrors(prev => ({ ...prev, ...errors }));
    return decrypted;
  }, [e2ee]);

  // E2EE: Helper to decrypt a tree of pings recursively
  const decryptPingTree = useCallback(async (tree, waveId) => {
    const decryptNode = async (node) => {
      const decrypted = await decryptMessages([node], waveId);
      const result = decrypted[0];
      if (result.children && result.children.length > 0) {
        result.children = await Promise.all(result.children.map(child => decryptNode(child)));
      }
      return result;
    };
    return Promise.all(tree.map(node => decryptNode(node)));
  }, [decryptMessages]);

  // State for showing moderation menu
  const [showModMenu, setShowModMenu] = useState(null); // participant.id or null

  const handleToggleBlock = async (participant) => {
    const wasBlocked = isBlocked(participant.id);
    const success = wasBlocked
      ? await onUnblockUser(participant.id)
      : await onBlockUser(participant.id);
    if (success) {
      showToast(wasBlocked ? `Unblocked ${participant.name}` : `Blocked ${participant.name}`, 'success');
      onBlockedMutedChange?.();
      // Reload wave to show/hide blocked user's pings
      loadWave(true);
    } else {
      showToast(formatError(`Failed to ${wasBlocked ? 'unblock' : 'block'} user`), 'error');
    }
    setShowModMenu(null);
  };

  const handleToggleMute = async (participant) => {
    const wasMuted = isMuted(participant.id);
    const success = wasMuted
      ? await onUnmuteUser(participant.id)
      : await onMuteUser(participant.id);
    if (success) {
      showToast(wasMuted ? `Unmuted ${participant.name}` : `Muted ${participant.name}`, 'success');
      onBlockedMutedChange?.();
      // Reload wave to show/hide muted user's pings
      loadWave(true);
    } else {
      showToast(formatError(`Failed to ${wasMuted ? 'unmute' : 'mute'} user`), 'error');
    }
    setShowModMenu(null);
  };

  const handleQuickSendRequest = async (participant) => {
    try {
      await fetchAPI('/contacts/request', {
        method: 'POST',
        body: { toUserId: participant.id }
      });
      showToast(`Contact request sent to ${participant.name}`, 'success');
      onRequestsChange?.();
    } catch (err) {
      showToast(err.message || formatError('Failed to send request'), 'error');
    }
  };

  const handleAcceptRequest = async (participant) => {
    const request = contactRequests?.find(r => r.from_user_id === participant.id);
    if (!request) return;
    try {
      await fetchAPI(`/contacts/requests/${request.id}/accept`, { method: 'POST' });
      showToast(`${participant.name} is now a contact!`, 'success');
      onRequestsChange?.();
      onContactsChange?.();
    } catch (err) {
      showToast(err.message || formatError('Failed to accept request'), 'error');
    }
  };

  // Thread collapse/expand functions with localStorage persistence
  const toggleThreadCollapse = (messageId) => {
    setCollapsed(prev => {
      const next = { ...prev, [messageId]: !prev[messageId] };
      // Persist to localStorage
      try {
        localStorage.setItem(`farhold_collapsed_${wave.id}`, JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save collapse state:', e);
      }
      return next;
    });
  };

  const collapseAllThreads = () => {
    // Get all pings with children and collapse them
    const newCollapsed = {};
    const countThreads = (msgs) => {
      msgs.forEach(msg => {
        if (msg.children && msg.children.length > 0) {
          newCollapsed[msg.id] = true;
          countThreads(msg.children);
        }
      });
    };
    countThreads(waveData?.messages || []);
    setCollapsed(newCollapsed);
    try {
      localStorage.setItem(`farhold_collapsed_${wave.id}`, JSON.stringify(newCollapsed));
    } catch (e) {
      console.error('Failed to save collapse state:', e);
    }
    showToast('All threads collapsed', 'success');
  };

  const expandAllThreads = () => {
    setCollapsed({});
    try {
      localStorage.setItem(`farhold_collapsed_${wave.id}`, JSON.stringify({}));
    } catch (e) {
      console.error('Failed to save collapse state:', e);
    }
    showToast('All threads expanded', 'success');
  };

  // Content collapse functions (v2.23.0)
  const toggleContentCollapse = (messageId) => {
    setContentCollapsed(prev => {
      const next = { ...prev, [messageId]: !prev[messageId] };
      try {
        localStorage.setItem(`farhold_content_collapsed_${wave.id}`, JSON.stringify(next));
      } catch (e) {
        console.error('Failed to save content collapse state:', e);
      }
      return next;
    });
  };

  // Helper to check if a message is collapsible (long text, audio, video, or images)
  const isMessageCollapsible = (msg) => {
    if (msg.deleted) return false;
    if (msg.media_type === 'audio' || msg.media_type === 'video') return true;
    if (!msg.content) return false;
    if (msg.content.length > 150) return true;
    if (msg.content.includes('<img')) return true;
    return false;
  };

  const collapseAllContent = () => {
    const newContentCollapsed = {};
    const checkMessage = (msg) => {
      if (isMessageCollapsible(msg)) {
        newContentCollapsed[msg.id] = true;
      }
      msg.children?.forEach(checkMessage);
    };
    (waveData?.messages || []).forEach(checkMessage);
    setContentCollapsed(newContentCollapsed);
    try {
      localStorage.setItem(`farhold_content_collapsed_${wave.id}`, JSON.stringify(newContentCollapsed));
    } catch (e) {
      console.error('Failed to save content collapse state:', e);
    }
    showToast('All messages collapsed', 'success');
  };

  const expandAllContent = () => {
    setContentCollapsed({});
    try {
      localStorage.setItem(`farhold_content_collapsed_${wave.id}`, JSON.stringify({}));
    } catch (e) {
      console.error('Failed to save content collapse state:', e);
    }
    showToast('All messages expanded', 'success');
  };

  // Share ping to external platforms
  const handleSharePing = async (ping) => {
    const shareUrl = `${BASE_URL}/share/${ping.id}`;
    const shareTitle = wave?.title || waveData?.title || 'Cortex';
    const shareText = `Check out this conversation on Cortex`;

    // Try native Web Share API first (mobile-friendly)
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        showToast(SUCCESS.shared, 'success');
        return;
      } catch (err) {
        // User cancelled or share failed - fall through to clipboard
        if (err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    }

    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(SUCCESS.copied, 'success');
    } catch (err) {
      // Final fallback for older browsers
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

  const composeRef = useRef(null);
  const messagesRef = useRef(null);
  const textareaRef = useRef(null);
  const composerRef = useRef(null);
  const hasMarkedAsReadRef = useRef(false);
  const hasCheckedInitialPositionRef = useRef(false); // Only check scroll position once per wave
  const scrollPositionToRestore = useRef(null);
  const lastTypingSentRef = useRef(null);
  const hasScrolledToUnreadRef = useRef(false);
  const userActionInProgressRef = useRef(false); // Suppress WebSocket reloads during user actions

  useEffect(() => {
    loadWave();
    hasMarkedAsReadRef.current = false; // Reset when switching waves
    hasCheckedInitialPositionRef.current = false; // Reset initial position check for new wave
    hasScrolledToUnreadRef.current = false; // Reset scroll-to-unread for new wave

    // Notify server that user is viewing this wave (for notification suppression)
    if (sendWSMessage) {
      sendWSMessage({ type: 'viewing_wave', waveId: wave.id });
    }

    // Cleanup: notify server when leaving wave
    return () => {
      if (sendWSMessage) {
        sendWSMessage({ type: 'viewing_wave', waveId: null });
      }
    };
  }, [wave.id, sendWSMessage]);

  // Reload wave when reloadTrigger changes (from WebSocket events)
  useEffect(() => {
    if (reloadTrigger > 0) {
      // Skip WebSocket-triggered reloads when a user action (send/edit/delete) is in progress
      // The user action will handle its own reload and scroll restoration
      if (userActionInProgressRef.current) {
        return;
      }
      // Only save scroll position if not already pending restoration
      // (prevents overwriting correct position during race conditions)
      if (messagesRef.current && scrollPositionToRestore.current === null) {
        const container = messagesRef.current;
        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
        // Use Infinity sentinel to mean "scroll to bottom" after reload
        scrollPositionToRestore.current = isAtBottom ? Infinity : container.scrollTop;
      }
      loadWave(true);
    }
  }, [reloadTrigger]);

  // Restore scroll position after wave data updates (for click-to-read and similar actions)
  // Use useLayoutEffect to restore scroll synchronously before browser paint
  useLayoutEffect(() => {
    if (scrollPositionToRestore.current !== null && messagesRef.current) {
      // Set flag to suppress scroll handler during restoration
      userActionInProgressRef.current = true;
      const target = scrollPositionToRestore.current === Infinity
        ? messagesRef.current.scrollHeight
        : scrollPositionToRestore.current;
      messagesRef.current.scrollTop = target;
      scrollPositionToRestore.current = null;
      // Clear flag after scroll events have settled
      setTimeout(() => {
        userActionInProgressRef.current = false;
      }, 100);
    }
  }, [waveData]);

  // Scroll to first unread message or bottom on initial wave load
  useEffect(() => {
    // Skip if: no data, no container, already scrolled, still loading, pending scroll restoration, OR navigating to specific ping
    if (!waveData || !messagesRef.current || hasScrolledToUnreadRef.current || loading || scrollPositionToRestore.current !== null || scrollToMessageId) return;

    // Only run once per wave
    hasScrolledToUnreadRef.current = true;

    const allPings = waveData.all_messages || [];

    // Find first unread ping (not authored by current user)
    const firstUnreadPing = allPings.find(m =>
      m.is_unread && m.author_id !== currentUser?.id
    );

    // Use requestAnimationFrame to ensure DOM is painted before scrolling
    requestAnimationFrame(() => {
      const container = messagesRef.current;
      if (!container) return;

      const scrollToTarget = () => {
        if (firstUnreadPing) {
          const pingElement = container.querySelector(`[data-message-id="${firstUnreadPing.id}"]`);
          if (pingElement) {
            // Use instant scroll first to ensure we reach the target
            pingElement.scrollIntoView({ behavior: 'instant', block: 'start' });
            // Then verify position after images/content may have loaded
            setTimeout(() => {
              if (messagesRef.current) {
                pingElement.scrollIntoView({ behavior: 'instant', block: 'start' });
              }
            }, 300);
            return;
          }
        }
        // No unread pings or element not found - scroll to bottom
        container.scrollTop = container.scrollHeight;
      };

      // Small delay to let React finish rendering message components
      setTimeout(scrollToTarget, 50);
    });
  }, [waveData, loading, currentUser?.id]);

  // Scroll to specific ping when navigating from notification
  useEffect(() => {
    if (!scrollToMessageId || !waveData || loading) {
      if (scrollToMessageId) {
        console.log(`🎯 Scroll to ping deferred - waveData: ${!!waveData}, loading: ${loading}`);
      }
      return;
    }

    console.log(`🎯 Attempting to scroll to ping ${scrollToMessageId}`);

    // Check if the ping exists in our data
    const pingInData = waveData.all_messages?.some(m => m.id === scrollToMessageId);
    if (!pingInData) {
      console.log(`⚠️ Target ping ${scrollToMessageId} not found in wave data (${waveData.all_messages?.length || 0} messages loaded)`);
    }

    // Wait for render to complete, with multiple retries
    let retryCount = 0;
    const maxRetries = 5;
    const retryDelay = 150;

    const scrollToTarget = () => {
      const element = document.querySelector(`[data-message-id="${scrollToMessageId}"]`);
      if (element) {
        console.log(`✅ Found ping ${scrollToMessageId} in DOM, scrolling...`);
        // Use instant scroll first to ensure we reach the target immediately
        element.scrollIntoView({ behavior: 'instant', block: 'center' });

        // Brief highlight effect
        element.style.transition = 'background-color 0.3s, outline 0.3s';
        element.style.backgroundColor = 'var(--accent-amber)20';
        element.style.outline = '2px solid var(--accent-amber)';

        // Verify scroll position after content (images, embeds) may have loaded
        // This corrects for lazy-loaded content changing the layout
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'instant', block: 'center' });
        }, 200);

        // Second verification for slower-loading content
        setTimeout(() => {
          element.scrollIntoView({ behavior: 'instant', block: 'center' });
        }, 500);

        setTimeout(() => {
          element.style.backgroundColor = '';
          element.style.outline = '';
        }, 1500);

        // Clear the target
        onScrollToMessageComplete?.();
      } else if (retryCount < maxRetries) {
        // Ping not in DOM - might be rendering, retry
        retryCount++;
        console.log(`⏳ Ping ${scrollToMessageId} not in DOM yet, retry ${retryCount}/${maxRetries}...`);
        setTimeout(scrollToTarget, retryDelay);
      } else {
        // Give up after max retries
        console.log(`❌ Could not find ping ${scrollToMessageId} in DOM after ${maxRetries} retries`);
        onScrollToMessageComplete?.();
      }
    };

    // Use requestAnimationFrame for better timing with React render cycle
    requestAnimationFrame(() => {
      setTimeout(scrollToTarget, 50);
    });
  }, [scrollToMessageId, waveData, loading, onScrollToMessageComplete]);

  // Auto-collapse messages when preference enabled (v2.23.0)
  const hasAutoCollapsedRef = useRef(false);
  useEffect(() => {
    // Only run once per wave load when auto-collapse is enabled
    if (!waveData || !currentUser?.preferences?.autoCollapseMessages || hasAutoCollapsedRef.current) return;
    hasAutoCollapsedRef.current = true;

    const autoCollapsed = {};
    const checkMessage = (msg) => {
      if (isMessageCollapsible(msg)) {
        autoCollapsed[msg.id] = true;
      }
      msg.children?.forEach(checkMessage);
    };
    (waveData.messages || []).forEach(checkMessage);

    if (Object.keys(autoCollapsed).length > 0) {
      // Merge with any existing saved state (user's manual changes take precedence)
      setContentCollapsed(prev => ({ ...autoCollapsed, ...prev }));
    }
  }, [waveData, currentUser?.preferences?.autoCollapseMessages]);

  // Reset auto-collapse flag when switching waves
  useEffect(() => {
    hasAutoCollapsedRef.current = false;
  }, [wave.id]);

  // Mark wave as read when user scrolls to bottom or views unread messages
  useEffect(() => {
    if (!waveData || !messagesRef.current || hasMarkedAsReadRef.current) return;

    const markAsRead = () => {
      if (hasMarkedAsReadRef.current) return; // Prevent duplicate calls
      hasMarkedAsReadRef.current = true;

      console.log(`📖 Marking wave ${wave.id} as read...`);
      fetchAPI(`/waves/${wave.id}/read`, { method: 'POST' })
        .then(() => {
          console.log(`✅ Wave ${wave.id} marked as read, refreshing wave list`);
          onWaveUpdate?.();
        })
        .catch((err) => {
          console.error(`❌ Failed to mark wave ${wave.id} as read:`, err);
          hasMarkedAsReadRef.current = false; // Allow retry on error
        });
    };

    // Check if user has scrolled to bottom
    const handleScroll = () => {
      const container = messagesRef.current;
      // Skip if: no container, already marked, or user action in progress (e.g., clicking a ping)
      if (!container || hasMarkedAsReadRef.current || userActionInProgressRef.current) return;

      const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
      if (isAtBottom) {
        markAsRead();
      }
    };

    const container = messagesRef.current;
    container.addEventListener('scroll', handleScroll);

    // Also mark as read if already at bottom on load (only check once per wave, not on refreshes)
    const checkInitialPosition = () => {
      if (hasMarkedAsReadRef.current || hasCheckedInitialPositionRef.current) return;
      hasCheckedInitialPositionRef.current = true; // Only check once per wave
      const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
      if (isAtBottom) {
        markAsRead();
      }
    };
    // Only run initial position check if we haven't already
    if (!hasCheckedInitialPositionRef.current) {
      setTimeout(checkInitialPosition, 500);
    }

    return () => container.removeEventListener('scroll', handleScroll);
  }, [waveData, wave.id, fetchAPI, onWaveUpdate]);

  useEffect(() => {
    if (isPlaying && waveData && waveData.all_messages) {
      const total = waveData.all_messages.length;
      playbackRef.current = setInterval(() => {
        setPlaybackIndex(prev => {
          const next = (prev ?? -1) + 1;
          if (next >= total) { setIsPlaying(false); return total - 1; }
          return next;
        });
      }, 1500 / playbackSpeed);
    }
    return () => { if (playbackRef.current) clearInterval(playbackRef.current); };
  }, [isPlaying, playbackSpeed, waveData]);

  // Scroll to current playback message when playbackIndex changes
  useEffect(() => {
    if (playbackIndex === null || !waveData?.all_messages || !messagesRef.current) return;

    // Find the message with the current playback index
    const findMessageByIndex = (messages, targetIndex) => {
      for (const msg of messages) {
        if (msg._index === targetIndex) return msg;
        if (msg.children) {
          const found = findMessageByIndex(msg.children, targetIndex);
          if (found) return found;
        }
      }
      return null;
    };

    const currentMessage = findMessageByIndex(waveData.messages || [], playbackIndex);
    if (currentMessage) {
      // Use setTimeout to ensure React has re-rendered and the element is in the DOM
      // This is needed because the element only appears when playbackIndex >= its _index
      setTimeout(() => {
        const container = messagesRef.current;
        const element = container?.querySelector(`[data-message-id="${currentMessage.id}"]`);
        if (element && container) {
          // Calculate element's position relative to the scroll container
          const containerRect = container.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();

          // Current scroll position + element's visual offset from container top
          // minus half the container height to center it
          const elementVisualTop = elementRect.top - containerRect.top;
          const targetScrollTop = container.scrollTop + elementVisualTop - (containerRect.height / 2) + (elementRect.height / 2);

          // Scroll to the target position (instant for reliability, highlight provides visual feedback)
          container.scrollTo({
            top: Math.max(0, targetScrollTop),
            behavior: 'auto'
          });

          // Brief highlight effect to show current playback position
          element.style.transition = 'background-color 0.3s';
          element.style.backgroundColor = 'var(--accent-amber)30';
          element.style.outline = '2px solid var(--accent-amber)';
          setTimeout(() => {
            element.style.backgroundColor = '';
            element.style.outline = '';
          }, 800);
        }
      }, 50);
    }
  }, [playbackIndex, waveData]);

  // Scroll to compose area when replying on mobile
  useEffect(() => {
    if (replyingTo && isMobile && composeRef.current) {
      setTimeout(() => {
        composeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 100);
    }
  }, [replyingTo, isMobile]);

  // Auto-focus textarea when replying
  useEffect(() => {
    if (replyingTo && textareaRef.current) {
      setTimeout(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.focus();
          const length = textarea.value.length;
          textarea.setSelectionRange(length, length);
        }
      }, 150);
    }
  }, [replyingTo]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }, [newMessage]);

  const loadWave = async (isRefresh = false) => {
    // Only show loading spinner on initial load, not on refresh
    // This prevents scroll position from being lost when the container is unmounted
    if (!isRefresh) {
      setLoading(true);
    }
    try {
      const data = await fetchAPI(`/waves/${wave.id}`);
      console.log('Wave API response:', data);

      // Ensure required fields exist with defaults
      if (!data.messages) data.messages = [];
      if (!data.all_messages) data.all_messages = [];
      if (!data.participants) data.participants = [];

      // E2EE: Decrypt messages if wave is encrypted and E2EE is unlocked
      if (data.encrypted && e2ee.isUnlocked) {
        try {
          // Decrypt all_messages flat list
          data.all_messages = await decryptMessages(data.all_messages, wave.id);
          // Decrypt the tree structure
          data.messages = await decryptPingTree(data.messages, wave.id);
        } catch (decryptErr) {
          console.error('Failed to decrypt wave messages:', decryptErr);
        }
      }

      // Assign chronological indices based on created_at for proper playback order
      // Sort all_messages by created_at and create a map of id -> chronoIndex
      const sortedByTime = [...data.all_messages].sort((a, b) =>
        new Date(a.created_at) - new Date(b.created_at)
      );
      const chronoIndexMap = new Map();
      sortedByTime.forEach((m, idx) => chronoIndexMap.set(m.id, idx));

      // Apply chronological indices to the tree structure
      const addIndices = (msgs) => msgs.forEach(m => {
        m._index = chronoIndexMap.get(m.id) ?? 0;
        if (m.children) addIndices(m.children);
      });
      addIndices(data.messages);
      console.log('Wave data loaded:', {
        title: data.title,
        privacy: data.privacy,
        can_edit: data.can_edit,
        createdBy: data.createdBy,
        currentUserId: currentUser?.id,
        totalMessages: data.total_messages,
        hasMoreMessages: data.hasMoreMessages,
        messageCount: data.messages?.length,
        allMessagesCount: data.all_messages?.length,
        encrypted: data.encrypted
      });
      setWaveData(data);
      setHasMoreMessages(data.hasMoreMessages || false);
    } catch (err) {
      console.error('Failed to load wave:', err);
      showToast(formatError('Failed to load wave'), 'error');
    }
    if (!isRefresh) {
      setLoading(false);
    }
  };

  // E2EE: Load encryption status for legacy/partial waves
  const loadEncryptionStatus = useCallback(async () => {
    if (!e2ee.isE2EEEnabled || !waveData) return;

    // Only check for legacy (0) or partial (2) waves
    if (waveData.encrypted === 1) {
      setEncryptionStatus(null);
      return;
    }

    try {
      const status = await e2ee.getWaveEncryptionStatus(wave.id);
      setEncryptionStatus(status);
    } catch (err) {
      console.error('Failed to load encryption status:', err);
    }
  }, [e2ee, wave.id, waveData]);

  // Load encryption status when wave data changes
  useEffect(() => {
    if (waveData && e2ee.isE2EEEnabled && waveData.encrypted !== 1) {
      loadEncryptionStatus();
    }
  }, [waveData?.id, waveData?.encrypted, e2ee.isE2EEEnabled, loadEncryptionStatus]);

  // E2EE: Enable encryption for a legacy wave
  const handleEnableEncryption = async () => {
    if (!e2ee.isUnlocked) {
      showToast('Please unlock E2EE first', 'error');
      return;
    }

    setIsEnablingEncryption(true);
    try {
      const participantIds = waveData.participants
        .filter(p => p.id !== currentUser.id)
        .map(p => p.id);

      const result = await e2ee.enableWaveEncryption(wave.id, participantIds);

      if (result.success) {
        showToast('Encryption enabled! Starting migration...', 'success');
        // Refresh encryption status
        await loadEncryptionStatus();
        // Start encrypting first batch
        await handleContinueEncryption();
      }
    } catch (err) {
      console.error('Failed to enable encryption:', err);
      showToast(err.message || formatError('Failed to enable encryption'), 'error');
    } finally {
      setIsEnablingEncryption(false);
    }
  };

  // E2EE: Continue encrypting pings in batches
  const handleContinueEncryption = async () => {
    if (!e2ee.isUnlocked || isEncryptingBatch) return;

    setIsEncryptingBatch(true);
    try {
      let hasMore = true;
      let totalEncrypted = 0;

      // Process batches until done or error
      while (hasMore) {
        const result = await e2ee.encryptLegacyWaveBatch(wave.id, 50);
        totalEncrypted += result.encrypted;
        hasMore = result.hasMore;

        // Update progress
        setEncryptionStatus(prev => ({
          ...prev,
          progress: result.progress,
          encryptionState: result.encryptionState
        }));

        // Small delay between batches to avoid overwhelming
        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      if (totalEncrypted > 0) {
        showToast(`Encrypted ${totalEncrypted} messages`, 'success');
      }

      // Refresh wave data to show encrypted content
      await loadWave(true);
      await loadEncryptionStatus();
    } catch (err) {
      console.error('Failed to encrypt batch:', err);
      showToast(err.message || formatError('Failed to encrypt messages'), 'error');
    } finally {
      setIsEncryptingBatch(false);
    }
  };

  // Load older messages (pagination)
  const loadMoreMessages = async () => {
    if (loadingMore || !waveData?.all_messages?.length) return;

    setLoadingMore(true);
    try {
      // Get the oldest message ID from current set
      const oldestMessage = waveData.all_messages[0]; // First message is oldest (sorted by created_at)
      const data = await fetchAPI(`/waves/${wave.id}/messages?limit=50&before=${oldestMessage.id}`);

      if (data.messages.length > 0) {
        // Save scroll position before adding messages
        const container = messagesRef.current;
        const scrollHeightBefore = container?.scrollHeight || 0;

        // E2EE: Decrypt new messages if wave is encrypted
        let decryptedMessages = data.messages;
        if (waveData?.encrypted && e2ee.isUnlocked) {
          try {
            decryptedMessages = await decryptMessages(data.messages, wave.id);
          } catch (decryptErr) {
            console.error('Failed to decrypt older messages:', decryptErr);
          }
        }

        // Merge older messages with existing ones
        const mergedMessages = [...decryptedMessages, ...waveData.all_messages];

        // Rebuild the message tree - treat orphaned replies (parent not in set) as roots
        const messageIds = new Set(mergedMessages.map(m => m.id));
        function buildMessageTree(messages, parentId = null) {
          return messages
            .filter(m => {
              if (parentId === null) {
                // Root level: include messages with no parent OR whose parent isn't loaded
                return m.parent_id === null || !messageIds.has(m.parent_id);
              }
              return m.parent_id === parentId;
            })
            .map(m => ({ ...m, children: buildMessageTree(messages, m.id) }));
        }

        const tree = buildMessageTree(mergedMessages);

        // Assign chronological indices based on created_at for proper playback order
        const sortedByTime = [...mergedMessages].sort((a, b) =>
          new Date(a.created_at) - new Date(b.created_at)
        );
        const chronoIndexMap = new Map();
        sortedByTime.forEach((m, idx) => chronoIndexMap.set(m.id, idx));

        const addIndices = (msgs) => msgs.forEach(m => {
          m._index = chronoIndexMap.get(m.id) ?? 0;
          if (m.children) addIndices(m.children);
        });
        addIndices(tree);

        setWaveData(prev => ({
          ...prev,
          messages: tree,
          all_messages: mergedMessages,
        }));
        setHasMoreMessages(data.hasMore);

        // Restore scroll position after DOM updates
        setTimeout(() => {
          if (container) {
            const scrollHeightAfter = container.scrollHeight;
            container.scrollTop = scrollHeightAfter - scrollHeightBefore;
          }
        }, 50);
      } else {
        setHasMoreMessages(false);
      }
    } catch (err) {
      showToast(formatError('Failed to load older messages'), 'error');
    }
    setLoadingMore(false);
  };

  // Handle playback toggle - load all messages first if needed
  const handlePlaybackToggle = async () => {
    if (isPlaying) {
      // Stopping playback
      setIsPlaying(false);
      return;
    }

    // Starting playback - load all messages first if there are more
    if (hasMoreMessages) {
      showToast('Loading all messages for playback...', 'info');
      try {
        // Keep loading until we have all messages
        let allMessages = [...(waveData?.all_messages || [])];
        let hasMore = true;

        while (hasMore) {
          const oldestMessage = allMessages.reduce((oldest, m) =>
            new Date(m.created_at) < new Date(oldest.created_at) ? m : oldest
          );
          const data = await fetchAPI(`/waves/${wave.id}/messages?limit=100&before=${oldestMessage.id}`);

          if (data.messages.length > 0) {
            allMessages = [...data.messages, ...allMessages];
            hasMore = data.hasMore;
          } else {
            hasMore = false;
          }
        }

        // Rebuild the tree with all messages
        const messageIds = new Set(allMessages.map(m => m.id));
        function buildMessageTree(messages, parentId = null) {
          return messages
            .filter(m => {
              if (parentId === null) {
                return m.parent_id === null || !messageIds.has(m.parent_id);
              }
              return m.parent_id === parentId;
            })
            .map(m => ({ ...m, children: buildMessageTree(messages, m.id) }));
        }

        const tree = buildMessageTree(allMessages);

        // Assign chronological indices
        const sortedByTime = [...allMessages].sort((a, b) =>
          new Date(a.created_at) - new Date(b.created_at)
        );
        const chronoIndexMap = new Map();
        sortedByTime.forEach((m, idx) => chronoIndexMap.set(m.id, idx));

        const addIndices = (msgs) => msgs.forEach(m => {
          m._index = chronoIndexMap.get(m.id) ?? 0;
          if (m.children) addIndices(m.children);
        });
        addIndices(tree);

        setWaveData(prev => ({
          ...prev,
          messages: tree,
          all_messages: allMessages,
        }));
        setHasMoreMessages(false);
        showToast(`Loaded ${allMessages.length} messages`, 'success');
      } catch (err) {
        showToast(formatError('Failed to load all messages for playback'), 'error');
        return;
      }
    }

    // Start playback from the beginning
    setPlaybackIndex(0);
    setIsPlaying(true);
  };

  const handleSendMessage = async (messageContent) => {
    const content = messageContent || newMessage;
    if (!content.trim()) return;
    const isReply = replyingTo !== null;

    // Suppress WebSocket-triggered reloads during this operation
    userActionInProgressRef.current = true;

    try {
      // Save scroll position if replying (so we don't jump around)
      if (isReply && messagesRef.current) {
        scrollPositionToRestore.current = messagesRef.current.scrollTop;
      }

      // E2EE: Encrypt message if wave is encrypted and E2EE is unlocked
      let messageBody = { wave_id: wave.id, parent_id: replyingTo?.id || null, content };

      if (waveData?.encrypted && e2ee.isUnlocked) {
        try {
          const { ciphertext, nonce } = await e2ee.encryptPing(content, wave.id);
          const waveKeyVersion = await fetchAPI(`/waves/${wave.id}/key`).then(r => r.keyVersion).catch(() => 1);
          messageBody = {
            ...messageBody,
            content: ciphertext,
            encrypted: true,
            nonce,
            keyVersion: waveKeyVersion || 1
          };
        } catch (encryptErr) {
          console.error('Failed to encrypt message:', encryptErr);
          showToast(formatError('Failed to encrypt message'), 'error');
          userActionInProgressRef.current = false;
          return;
        }
      }

      await fetchAPI('/pings', {
        method: 'POST',
        body: messageBody,
      });
      setNewMessage('');
      setReplyingTo(null);
      showToast(SUCCESS.messageSent, 'success');
      await loadWave(true);

      // Only scroll to bottom if posting a root message (not a reply)
      if (!isReply) {
        setTimeout(() => {
          if (messagesRef.current) {
            messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
          }
          // Clear the flag after scroll completes
          userActionInProgressRef.current = false;
        }, 150);
      } else {
        // For replies, clear the flag after scroll restoration has time to complete
        setTimeout(() => {
          userActionInProgressRef.current = false;
        }, 150);
      }
    } catch (err) {
      showToast(formatError('Failed to send message'), 'error');
      scrollPositionToRestore.current = null; // Clear on error
      userActionInProgressRef.current = false;
    }
  };

  // Handle image upload for messages
  const handleImageUpload = async (file) => {
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      showToast('Invalid file type. Allowed: jpg, png, gif, webp', 'error');
      return;
    }

    // Validate file size (10MB max)
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
      // Insert the image URL into the message - it will auto-embed when sent
      if (composerRef.current) {
        composerRef.current.appendMessage(data.url);
        composerRef.current.focus();
      } else {
        setNewMessage(prev => prev + (prev ? '\n' : '') + data.url);
        textareaRef.current?.focus();
      }
      showToast('Image uploaded', 'success');
    } catch (err) {
      showToast(err.message || formatError('Failed to upload image'), 'error');
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle general file upload for messages
  const handleFileUpload = async (file) => {
    if (!file) return;

    // If it's an image, delegate to existing image upload handler
    const imageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (imageTypes.includes(file.type)) {
      handleImageUpload(file);
      return;
    }

    // Validate file size (25MB max)
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
      // Insert file marker into the message
      const marker = `[file:${data.filename}:${data.size}]${data.url}`;
      if (composerRef.current) {
        composerRef.current.appendMessage(marker);
        composerRef.current.focus();
      } else {
        setNewMessage(prev => prev + (prev ? '\n' : '') + marker);
        textareaRef.current?.focus();
      }
      showToast('File attached', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to upload file', 'error');
    } finally {
      setUploading(false);
      if (fileAttachInputRef.current) {
        fileAttachInputRef.current.value = '';
      }
    }
  };

  // Handle media recording completion (v2.7.0)
  const handleMediaRecordingComplete = async (blob, duration) => {
    if (!blob) return;

    const mediaType = showMediaRecorder; // 'audio' or 'video'
    setUploadingMedia(true);
    setShowMediaRecorder(null); // Close recorder immediately

    try {
      // Show upload status - video files are transcoded server-side
      if (mediaType === 'video') {
        setMediaUploadStatus('Uploading and transcoding video...');
      } else {
        setMediaUploadStatus('Uploading audio...');
      }

      // Upload the media file - explicitly set MIME type based on recording type
      // Don't rely on blob.type as it may be empty or incorrect in some browsers
      const mimeType = mediaType === 'video' ? 'video/webm' : 'audio/webm';
      const file = new File([blob], `recording.webm`, { type: mimeType });
      console.log(`Uploading media: blob.type=${blob.type}, file.type=${file.type}, size=${file.size}`);

      const formData = new FormData();
      formData.append('media', file);
      formData.append('duration', Math.round(duration * 1000).toString()); // Convert to ms

      const token = storage.getToken();
      const uploadResponse = await fetch(`${API_URL}/uploads/media`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!uploadResponse.ok) {
        const data = await uploadResponse.json();
        throw new Error(data.error || 'Upload failed');
      }

      setMediaUploadStatus('Sending message...');
      const uploadData = await uploadResponse.json();

      // Create ping with media
      let messageBody = {
        wave_id: wave.id,
        parent_id: replyingTo?.id || null,
        content: '', // Empty content for media pings
        mediaType: uploadData.type,
        mediaUrl: uploadData.url,
        mediaDuration: uploadData.duration,
      };

      // Handle E2EE - for now, just mark media as not encrypted
      // TODO: Implement media encryption in Phase 5
      if (waveData?.encrypted && e2ee.isUnlocked) {
        try {
          // For encrypted waves, we'll encrypt the content (empty for media pings)
          // The media file itself is stored unencrypted for now
          const { ciphertext, nonce } = await e2ee.encryptPing('', wave.id);
          const waveKeyVersion = await fetchAPI(`/waves/${wave.id}/key`).then(r => r.keyVersion).catch(() => 1);
          messageBody = {
            ...messageBody,
            content: ciphertext,
            encrypted: true,
            nonce,
            keyVersion: waveKeyVersion || 1,
            mediaEncrypted: false, // Media not encrypted yet
          };
        } catch (encryptErr) {
          console.error('Failed to encrypt message:', encryptErr);
          showToast(formatError('Failed to encrypt message'), 'error');
          setUploadingMedia(false);
          setMediaUploadStatus('');
          return;
        }
      }

      await fetchAPI('/pings', {
        method: 'POST',
        body: messageBody,
      });

      showToast(`${mediaType === 'video' ? 'Video' : 'Voice'} message sent`, 'success');
      setReplyingTo(null);
      await loadWave(true);

      // Scroll to bottom
      setTimeout(() => {
        if (messagesRef.current) {
          messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
        }
      }, 150);
    } catch (err) {
      showToast(err.message || formatError('Failed to send media'), 'error');
    } finally {
      setUploadingMedia(false);
      setMediaUploadStatus('');
    }
  };

  const handleArchive = async () => {
    try {
      await fetchAPI(`/waves/${wave.id}/archive`, {
        method: 'POST',
        body: { archived: !waveData?.is_archived },
      });
      showToast(waveData?.is_archived ? SUCCESS.waveRestored : SUCCESS.waveArchived, 'success');
      onWaveUpdate?.();
      onBack();
    } catch (err) {
      showToast(formatError('Failed to archive wave'), 'error');
    }
  };

  const handleHide = async () => {
    try {
      const isHidden = waveData?.is_hidden;
      await fetchAPI(`/waves/${wave.id}/hide`, {
        method: 'POST',
        body: { hidden: !isHidden },
      });
      showToast(isHidden ? GHOST_PROTOCOL.waveRevealed : GHOST_PROTOCOL.waveHidden, 'success');
      onWaveUpdate?.();
      onBack();
    } catch (err) {
      showToast(err.message || 'Failed to update wave visibility', 'error');
    }
  };

  const handleDeleteWave = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDeleteWave = async () => {
    try {
      await fetchAPI(`/waves/${wave.id}`, { method: 'DELETE' });
      showToast(SUCCESS.waveDeleted, 'success');
      onBack();
      onWaveUpdate?.();
    } catch (err) {
      showToast(err.message || formatError('Failed to delete wave'), 'error');
    }
  };

  const handleDecryptWave = async () => {
    if (!waveData.encrypted) {
      showToast('Wave is not encrypted', 'error');
      return;
    }

    if (!e2ee.isUnlocked) {
      showToast('Unlock E2EE first to decrypt this wave', 'error');
      return;
    }

    const confirmed = window.confirm(
      'This will permanently decrypt all messages in this wave. Encrypted content will be converted to plain text. This cannot be undone.\n\nContinue?'
    );
    if (!confirmed) return;

    setDecryptingWave(true);
    try {
      // Fetch all pings in the wave
      const pingsData = await fetchAPI(`/waves/${wave.id}/pings`);
      const pings = pingsData.pings || [];

      console.log(`Decrypting ${pings.length} pings in wave ${wave.id}...`);

      // Decrypt each ping
      const decryptedPings = [];
      for (const ping of pings) {
        try {
          // Check if ping is encrypted (has nonce)
          if (ping.encrypted && ping.nonce) {
            const decryptedContent = await e2ee.decryptPing(ping.content, ping.nonce, wave.id, ping.keyVersion);
            decryptedPings.push({
              id: ping.id,
              content: decryptedContent
            });
          } else {
            // Already decrypted or not encrypted
            decryptedPings.push({
              id: ping.id,
              content: ping.content
            });
          }
        } catch (decryptErr) {
          console.error(`Failed to decrypt ping ${ping.id}:`, decryptErr);
          // If decryption fails, keep original content (might already be decrypted)
          decryptedPings.push({
            id: ping.id,
            content: ping.content
          });
        }
      }

      // Send decrypted pings to server
      await fetchAPI(`/waves/${wave.id}/decrypt`, {
        method: 'POST',
        body: { pings: decryptedPings }
      });

      showToast('Wave decrypted successfully! All messages are now unencrypted.', 'success');
      await loadWave(true);
      onWaveUpdate?.();
    } catch (err) {
      console.error('Wave decryption error:', err);
      showToast(err.message || formatError('Failed to decrypt wave'), 'error');
    } finally {
      setDecryptingWave(false);
    }
  };

  const handleDeleteMessage = (message) => {
    setMessageToDelete(message);
  };

  const handleStartEdit = (message) => {
    setEditingMessageId(message.id);
    // Strip HTML tags to get plain text for editing
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = message.content;
    setEditContent(tempDiv.textContent || tempDiv.innerText || '');
  };

  const handleSaveEdit = async (messageId) => {
    if (!editContent.trim()) {
      showToast('Ping cannot be empty', 'error');
      return;
    }

    // Suppress WebSocket-triggered reloads and preserve scroll
    userActionInProgressRef.current = true;
    if (messagesRef.current) {
      scrollPositionToRestore.current = messagesRef.current.scrollTop;
    }

    try {
      await fetchAPI(`/pings/${messageId}`, {
        method: 'PUT',
        body: { content: editContent },
      });
      showToast(SUCCESS.messageUpdated, 'success');
      setEditingMessageId(null);
      setEditContent('');
      await loadWave(true);
      // Clear flag after scroll restoration has time to complete
      setTimeout(() => {
        userActionInProgressRef.current = false;
      }, 150);
    } catch (err) {
      showToast(err.message || formatError('Failed to update message'), 'error');
      scrollPositionToRestore.current = null;
      userActionInProgressRef.current = false;
    }
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const handleReaction = async (messageId, emoji) => {
    // Suppress WebSocket-triggered reloads and preserve scroll
    userActionInProgressRef.current = true;
    if (messagesRef.current) {
      scrollPositionToRestore.current = messagesRef.current.scrollTop;
    }

    try {
      await fetchAPI(`/pings/${messageId}/react`, {
        method: 'POST',
        body: { emoji },
      });
      // Reload wave data immediately to show the reaction
      await loadWave(true);
      // Clear flag after scroll restoration has time to complete
      setTimeout(() => {
        userActionInProgressRef.current = false;
      }, 150);
    } catch (err) {
      showToast(err.message || formatError('Failed to add reaction'), 'error');
      scrollPositionToRestore.current = null;
      userActionInProgressRef.current = false;
    }
  };

  const handleReportMessage = (message) => {
    // Extract preview text from message content (strip HTML tags)
    const textContent = message.content?.replace(/<[^>]*>/g, '').slice(0, 100) || '';
    setReportTarget({
      type: 'ping',
      targetId: message.id,
      targetPreview: `${message.sender_name}: ${textContent}${message.content?.length > 100 ? '...' : ''}`,
    });
  };

  const confirmDeleteMessage = async () => {
    if (!messageToDelete) return;

    // Suppress WebSocket-triggered reloads and preserve scroll
    userActionInProgressRef.current = true;
    if (messagesRef.current) {
      scrollPositionToRestore.current = messagesRef.current.scrollTop;
    }

    try {
      await fetchAPI(`/pings/${messageToDelete.id}`, { method: 'DELETE' });
      showToast(SUCCESS.messageDeleted, 'success');
      await loadWave(true);
      // Clear flag after scroll restoration has time to complete
      setTimeout(() => {
        userActionInProgressRef.current = false;
      }, 150);
    } catch (err) {
      showToast(err.message || formatError('Failed to delete message'), 'error');
      scrollPositionToRestore.current = null;
      userActionInProgressRef.current = false;
    }
  };

  const handleMessageClick = async (messageId) => {
    // Suppress WebSocket-triggered reloads and preserve scroll
    userActionInProgressRef.current = true;
    if (messagesRef.current) {
      scrollPositionToRestore.current = messagesRef.current.scrollTop;
    }

    try {
      console.log(`📖 Marking ping ${messageId} as read...`);
      await fetchAPI(`/pings/${messageId}/read`, { method: 'POST' });
      // Reload wave to update unread status
      await loadWave(true);
      // Also refresh wave list to update unread counts
      console.log('📋 Calling onWaveUpdate to refresh wave list...', { onWaveUpdate: typeof onWaveUpdate });
      if (onWaveUpdate) {
        onWaveUpdate();
      } else {
        console.warn('⚠️ onWaveUpdate is not defined!');
      }
      // Clear flag after scroll restoration has time to complete
      setTimeout(() => {
        userActionInProgressRef.current = false;
      }, 150);
    } catch (err) {
      console.error(`❌ Failed to mark ping ${messageId} as read:`, err);
      showToast(formatError('Failed to mark ping as read'), 'error');
      scrollPositionToRestore.current = null;
      userActionInProgressRef.current = false;
    }
  };

  const handleTyping = () => {
    if (!newMessage.trim() || !sendWSMessage) return;
    const now = Date.now();
    // Throttle: Send typing event max once every 2 seconds
    if (!lastTypingSentRef.current || now - lastTypingSentRef.current > 2000) {
      sendWSMessage({
        type: 'user_typing',
        waveId: wave.id
      });
      lastTypingSentRef.current = now;
    }
  };

  const config = PRIVACY_LEVELS[wave.privacy] || PRIVACY_LEVELS.private;
  if (loading) return <LoadingSpinner />;
  if (!waveData) return <div style={{ padding: '20px', color: 'var(--text-dim)' }}>Wave not found</div>;

  // Safe access with fallbacks for pagination fields
  // Note: API returns `messages` and `all_messages` but we use `pings` internally (v1.11.0)
  const allPings = waveData.all_messages || [];
  const participants = waveData.participants || [];
  const pings = waveData.messages || [];
  const total = allPings.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: isMobile ? '12px' : '16px 20px', background: 'linear-gradient(90deg, var(--bg-surface), var(--bg-hover), var(--bg-surface))',
        borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px', flexWrap: 'wrap',
        flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          padding: '6px 10px', background: 'transparent', border: '1px solid var(--border-primary)',
          color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem',
        }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Breadcrumb for burst waves (v2.1.0) */}
          {waveData.parent_wave && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '4px',
              fontSize: '0.7rem',
              color: 'var(--text-dim)',
            }}>
              <button
                onClick={() => onNavigateToWave({ id: waveData.parent_wave.id, title: waveData.parent_wave.title })}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--accent-teal)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: '0.7rem',
                  padding: '0',
                  textDecoration: 'underline',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '200px',
                }}
                title={`Return to ${waveData.parent_wave.title}`}
              >
                {waveData.parent_wave.title}
              </button>
              <span style={{ color: 'var(--text-dim)' }}>→</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-primary)', fontSize: isMobile ? '0.9rem' : '1.1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{waveData.title}</span>
            {waveData.group_name && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({waveData.group_name})</span>}
          </div>
          {editingTopic ? (
            <input
              autoFocus
              value={topicDraft}
              onChange={(e) => setTopicDraft(e.target.value)}
              onBlur={async () => {
                const trimmed = topicDraft.trim();
                if (trimmed !== (waveData.topic || '')) {
                  try {
                    await fetchAPI(`/waves/${wave.id}`, { method: 'PUT', body: { topic: trimmed } });
                    waveData.topic = trimmed || null;
                  } catch (e) { showToast('Failed to update topic', 'error'); }
                }
                setEditingTopic(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.target.blur();
                if (e.key === 'Escape') { setTopicDraft(waveData.topic || ''); setEditingTopic(false); }
              }}
              placeholder="Set a topic..."
              maxLength={300}
              style={{
                width: '100%', padding: '2px 4px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border-primary)', color: 'var(--text-muted)',
                fontSize: '0.75rem', fontStyle: 'italic', fontFamily: 'inherit',
              }}
            />
          ) : waveData.topic ? (
            <div
              onClick={() => {
                if (waveData.createdBy === currentUser?.id) {
                  setTopicDraft(waveData.topic || '');
                  setEditingTopic(true);
                }
              }}
              style={{
                color: 'var(--text-muted)', fontSize: '0.75rem', fontStyle: 'italic',
                cursor: waveData.createdBy === currentUser?.id ? 'pointer' : 'default',
              }}
              title={waveData.createdBy === currentUser?.id ? 'Click to edit topic' : ''}
            >
              {waveData.topic}
            </div>
          ) : waveData.createdBy === currentUser?.id ? (
            <div
              onClick={() => { setTopicDraft(''); setEditingTopic(true); }}
              style={{ color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer', opacity: 0.5 }}
            >
              + Set topic
            </div>
          ) : null}
          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
            {participants.length} participants • {total} pings
          </div>
        </div>
        {/* Wave header actions: three-dot menu + privacy badge */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Three-dot menu */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowWaveMenu(!showWaveMenu)}
              title="Wave actions"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontSize: '1.2rem',
                padding: isMobile ? '8px 10px' : '4px 8px',
                lineHeight: 1,
                minHeight: isMobile ? '44px' : 'auto',
              }}
            >
              ⋮
            </button>
            {/* Wave actions dropdown */}
            {showWaveMenu && (
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
                  minWidth: '180px',
                  zIndex: 1000,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ padding: '4px 0' }}>
                  {/* Voice/Video Call */}
                  <div
                    onClick={() => {
                      setShowCallModal(true);
                      setShowWaveMenu(false);
                      if (voiceCall.isDocked) {
                        voiceCall.hideDock(); // Hide dock when opening modal
                      }
                    }}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: 'var(--accent-green)',
                      background: 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span>📞</span>
                    <span>Voice/Video Call</span>
                  </div>

                  {/* Archive/Restore */}
                  <div
                    onClick={() => {
                      handleArchive();
                      setShowWaveMenu(false);
                    }}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: 'var(--text-primary)',
                      background: 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span>{waveData.is_archived ? '📬' : '📦'}</span>
                    <span>{waveData.is_archived ? 'Restore from Archive' : 'Archive Wave'}</span>
                  </div>

                  {/* Go Dark / Reveal Signal (v2.27.0) */}
                  <div
                    onClick={() => {
                      handleHide();
                      setShowWaveMenu(false);
                    }}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: 'var(--accent-orange)',
                      background: 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span>{waveData.is_hidden ? '📡' : '👻'}</span>
                    <span>{waveData.is_hidden ? GHOST_PROTOCOL.revealWave : GHOST_PROTOCOL.hideWave}</span>
                  </div>

                  {/* Decrypt (if encrypted) */}
                  {waveData.encrypted && (
                    <div
                      onClick={() => {
                        if (!decryptingWave) {
                          handleDecryptWave();
                          setShowWaveMenu(false);
                        }
                      }}
                      style={{
                        padding: '10px 14px',
                        cursor: decryptingWave ? 'wait' : 'pointer',
                        fontSize: '0.85rem',
                        color: 'var(--accent-orange)',
                        background: 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        opacity: decryptingWave ? 0.6 : 1,
                      }}
                      onMouseEnter={(e) => !decryptingWave && (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <span>{decryptingWave ? '⏳' : '🔓'}</span>
                      <span>Decrypt Wave</span>
                    </div>
                  )}

                  {/* Collapse/Expand All Messages (v2.23.0) */}
                  <div
                    onClick={() => {
                      collapseAllContent();
                      setShowWaveMenu(false);
                    }}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: 'var(--text-primary)',
                      background: 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span>▼</span>
                    <span>Collapse All Messages</span>
                  </div>
                  <div
                    onClick={() => {
                      expandAllContent();
                      setShowWaveMenu(false);
                    }}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      color: 'var(--text-primary)',
                      background: 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <span>▶</span>
                    <span>Expand All Messages</span>
                  </div>

                  {/* Settings (creator only) */}
                  {waveData.can_edit && (
                    <>
                      <div
                        onClick={() => {
                          setShowSettings(true);
                          setShowWaveMenu(false);
                        }}
                        style={{
                          padding: '10px 14px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          color: 'var(--accent-teal)',
                          background: 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          borderTop: '1px solid var(--border-subtle)',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        <span>⚙</span>
                        <span>Wave Settings</span>
                      </div>

                      {/* Delete (creator only) */}
                      <div
                        onClick={() => {
                          handleDeleteWave();
                          setShowWaveMenu(false);
                        }}
                        style={{
                          padding: '10px 14px',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
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
                        <span>Delete Wave</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* Call indicator badge (when call is active in THIS wave) */}
          {voiceCall.callActive && voiceCall.serverParticipantCount > 0 && voiceCall.activeCallWaveId === wave.id && (
            <div
              onClick={() => {
                setShowCallModal(true);
                if (voiceCall.isDocked) {
                  voiceCall.hideDock(); // Hide dock when opening modal
                }
              }}
              style={{
                padding: '4px 10px',
                background: 'var(--accent-green-bg)',
                border: '1px solid var(--accent-green)',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.75rem',
                color: 'var(--accent-green)',
                fontFamily: 'monospace',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              title="Join call"
            >
              <span>📞</span>
              <span>{voiceCall.serverParticipantCount}</span>
            </div>
          )}
          {/* Dock call button (v2.6.1) - only show in the wave where call is active */}
          {voiceCall.connectionState === 'connected' && voiceCall.roomName === wave.id && (
            <button
              onClick={() => {
                if (voiceCall.isDocked) {
                  voiceCall.hideDock();
                } else {
                  voiceCall.showDock();
                  setShowCallModal(false); // Close modal when docking to avoid dual LiveKitRoom
                }
              }}
              style={{
                padding: '4px 10px',
                background: voiceCall.isDocked ? 'var(--accent-teal-bg)' : 'transparent',
                border: '1px solid var(--accent-teal)',
                borderRadius: '3px',
                cursor: 'pointer',
                fontSize: '0.75rem',
                color: 'var(--accent-teal)',
                fontFamily: 'monospace',
                fontWeight: 'bold',
              }}
              title={voiceCall.isDocked ? 'Hide docked call' : 'Dock call window'}
            >
              {voiceCall.isDocked ? '📍 Docked' : '📌 Dock'}
            </button>
          )}
          {/* Privacy badge (always visible, farthest right) */}
          <PrivacyBadge level={wave.privacy} compact={isMobile} />
        </div>
      </div>

      {/* Wave Toolbar - Participants & Playback */}
      {(participants.length > 0 || total > 0) && (
        <div style={{
          padding: isMobile ? '6px 12px' : '6px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)',
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? '8px' : '12px',
          flexShrink: 0
        }}>
          {/* Playback Toggle */}
          {total > 0 && (
            <button
              onClick={() => setShowPlayback(!showPlayback)}
              style={{
                padding: isMobile ? '8px 12px' : '6px 10px',
                background: showPlayback ? `${config.color}20` : 'transparent',
                border: `1px solid ${showPlayback ? config.color : 'var(--border-primary)'}`,
                color: showPlayback ? config.color : 'var(--text-dim)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.7rem' : '0.65rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>{showPlayback ? '▼' : '▶'}</span>
              PLAYBACK
            </button>
          )}

          {/* Thread Collapse/Expand Toggle */}
          {total > 0 && (
            <button
              onClick={() => {
                const allCollapsed = Object.keys(collapsed).length > 0;
                if (allCollapsed) {
                  expandAllThreads();
                } else {
                  collapseAllThreads();
                }
              }}
              style={{
                padding: isMobile ? '8px 12px' : '6px 10px',
                background: 'transparent',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.7rem' : '0.65rem',
              }}
              title={Object.keys(collapsed).length > 0 ? 'Expand all threads' : 'Collapse all threads'}
            >
              {Object.keys(collapsed).length > 0 ? '▼' : '▶'} ALL
            </button>
          )}

          {/* Mark All Read Button - always visible if unread */}
          {allPings.some(m => m.is_unread && m.author_id !== currentUser.id) && (
            <button
              onClick={async () => {
                try {
                  // Use is_unread flag from server for consistency
                  const unreadPings = allPings
                    .filter(m => m.is_unread && m.author_id !== currentUser.id);
                  if (unreadPings.length === 0) return;
                  await Promise.all(unreadPings.map(m => fetchAPI(`/pings/${m.id}/read`, { method: 'POST' })));
                  await loadWave(true);
                  onWaveUpdate?.();
                  showToast(`Marked ${unreadPings.length} ping${unreadPings.length !== 1 ? 's' : ''} as read`, 'success');
                } catch (err) {
                  showToast(formatError('Failed to mark pings as read'), 'error');
                }
              }}
              style={{
                padding: isMobile ? '8px 12px' : '6px 10px',
                marginLeft: 'auto',
                background: 'transparent',
                border: '1px solid var(--accent-amber)',
                color: 'var(--accent-amber)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.7rem' : '0.65rem',
              }}
            >
              MARK ALL READ
            </button>
          )}
        </div>
      )}

      {/* Expanded Participants Panel */}
      {showParticipants && participants.length > 0 && (
        <div style={{
          padding: isMobile ? '12px' : '12px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          flexShrink: 0
        }}>
          {/* Header with Invite button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', fontFamily: 'monospace' }}>
              PARTICIPANTS ({participants.length})
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {/* Invite button - only for private waves by creator, or any wave by participants */}
              {((waveData?.privacy === 'private' && waveData?.createdBy === currentUser?.id) ||
                (waveData?.privacy !== 'private' && participants.some(p => p.id === currentUser?.id))) && (
                <button
                  onClick={() => setShowInviteModal(true)}
                  style={{
                    padding: isMobile ? '6px 10px' : '4px 8px',
                    minHeight: isMobile ? '36px' : 'auto',
                    background: 'var(--accent-teal)20',
                    border: '1px solid var(--accent-teal)',
                    color: 'var(--accent-teal)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: '0.65rem',
                  }}
                >
                  + INVITE
                </button>
              )}
              {/* Leave button for non-creators */}
              {waveData?.createdBy !== currentUser?.id && participants.some(p => p.id === currentUser?.id) && (
                <button
                  onClick={async () => {
                    if (confirm(CONFIRM_DIALOG.leaveWave)) {
                      try {
                        await fetchAPI(`/waves/${wave.id}/participants/${currentUser.id}`, { method: 'DELETE' });
                        showToast('You have left the wave', 'success');
                        onBack();
                      } catch (err) {
                        showToast(err.message || formatError('Failed to leave wave'), 'error');
                      }
                    }
                  }}
                  style={{
                    padding: isMobile ? '6px 10px' : '4px 8px',
                    minHeight: isMobile ? '36px' : 'auto',
                    background: 'var(--accent-orange)20',
                    border: '1px solid var(--accent-orange)',
                    color: 'var(--accent-orange)',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                    fontSize: '0.65rem',
                  }}
                >
                  LEAVE
                </button>
              )}
            </div>
          </div>
          {participants.map(p => {
            const latestPing = allPings.length > 0 ? allPings[allPings.length - 1] : null;
            const hasReadLatest = latestPing ? (latestPing.readBy || [latestPing.author_id]).includes(p.id) : true;
            const isCurrentUser = p.id === currentUser?.id;
            const isAlreadyContact = isContact(p.id);
            const hasSentRequest = hasSentRequestTo(p.id);
            const hasReceivedRequest = hasReceivedRequestFrom(p.id);
            const userBlocked = isBlocked(p.id);
            const userMuted = isMuted(p.id);

            return (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '8px 12px',
                  background: userBlocked ? 'var(--accent-orange)10' : 'var(--bg-elevated)',
                  border: `1px solid ${userBlocked ? 'var(--accent-orange)40' : 'var(--border-subtle)'}`,
                }}
              >
                {/* Participant Info */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, cursor: onShowProfile ? 'pointer' : 'default' }}
                  onClick={onShowProfile ? () => onShowProfile(p.id) : undefined}
                  title={onShowProfile ? 'View profile' : undefined}
                >
                  <Avatar letter={p.avatar || p.name?.[0] || '?'} color={isCurrentUser ? 'var(--accent-amber)' : 'var(--accent-teal)'} size={isMobile ? 32 : 28} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      color: userBlocked ? 'var(--accent-orange)' : userMuted ? 'var(--text-dim)' : 'var(--text-primary)',
                      fontSize: isMobile ? '0.85rem' : '0.8rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {p.name}
                      {isCurrentUser && <span style={{ color: 'var(--accent-amber)', marginLeft: '4px' }}>(you)</span>}
                      {userBlocked && <span style={{ color: 'var(--accent-orange)', marginLeft: '4px', fontSize: '0.65rem' }}>⊘ BLOCKED</span>}
                      {userMuted && !userBlocked && <span style={{ color: 'var(--text-dim)', marginLeft: '4px', fontSize: '0.65rem' }}>🔇 MUTED</span>}
                    </div>
                  </div>
                </div>

                {/* Read Status */}
                <div style={{
                  padding: '2px 6px',
                  background: hasReadLatest ? 'var(--accent-green)20' : 'var(--border-subtle)',
                  border: `1px solid ${hasReadLatest ? 'var(--accent-green)50' : 'var(--border-primary)'}`,
                  fontSize: '0.6rem',
                  color: hasReadLatest ? 'var(--accent-green)' : 'var(--text-dim)',
                  fontFamily: 'monospace',
                }}>
                  {hasReadLatest ? '✓ READ' : '○ UNREAD'}
                </div>

                {/* Contact Action Button */}
                {!isCurrentUser && (
                  <>
                    {isAlreadyContact ? (
                      <span style={{
                        padding: '2px 8px',
                        background: 'var(--accent-green)20',
                        border: '1px solid var(--accent-green)50',
                        fontSize: '0.6rem',
                        color: 'var(--accent-green)',
                        fontFamily: 'monospace',
                      }}>✓ CONTACT</span>
                    ) : hasSentRequest ? (
                      <span style={{
                        padding: '2px 8px',
                        background: 'var(--accent-amber)20',
                        border: '1px solid var(--accent-amber)50',
                        fontSize: '0.6rem',
                        color: 'var(--accent-amber)',
                        fontFamily: 'monospace',
                      }}>PENDING</span>
                    ) : hasReceivedRequest ? (
                      <button
                        onClick={() => handleAcceptRequest(p)}
                        style={{
                          padding: isMobile ? '6px 10px' : '4px 8px',
                          minHeight: isMobile ? '36px' : 'auto',
                          background: 'var(--accent-teal)20',
                          border: '1px solid var(--accent-teal)',
                          color: 'var(--accent-teal)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: '0.6rem',
                        }}
                      >ACCEPT</button>
                    ) : (
                      <button
                        onClick={() => handleQuickSendRequest(p)}
                        style={{
                          padding: isMobile ? '6px 10px' : '4px 8px',
                          minHeight: isMobile ? '36px' : 'auto',
                          background: 'transparent',
                          border: '1px solid var(--accent-teal)50',
                          color: 'var(--accent-teal)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: '0.6rem',
                        }}
                      >+ ADD</button>
                    )}
                  </>
                )}

                {/* Moderation Menu Button */}
                {!isCurrentUser && (
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setShowModMenu(showModMenu === p.id ? null : p.id)}
                      style={{
                        padding: isMobile ? '6px 8px' : '4px 6px',
                        minHeight: isMobile ? '36px' : 'auto',
                        minWidth: isMobile ? '36px' : 'auto',
                        background: showModMenu === p.id ? 'var(--border-subtle)' : 'transparent',
                        border: '1px solid var(--border-primary)',
                        color: 'var(--text-dim)',
                        cursor: 'pointer',
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                      }}
                      title="Moderation options"
                    >⋮</button>

                    {/* Moderation Dropdown Menu */}
                    {showModMenu === p.id && (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        right: 0,
                        marginTop: '4px',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-primary)',
                        zIndex: 100,
                        minWidth: '120px',
                      }}>
                        <button
                          onClick={() => handleToggleMute(p)}
                          style={{
                            width: '100%',
                            padding: isMobile ? '12px' : '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: '1px solid var(--border-subtle)',
                            color: userMuted ? 'var(--accent-green)' : 'var(--text-dim)',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                            fontSize: '0.7rem',
                            textAlign: 'left',
                          }}
                        >
                          {userMuted ? '🔊 UNMUTE' : '🔇 MUTE'}
                        </button>
                        <button
                          onClick={() => handleToggleBlock(p)}
                          style={{
                            width: '100%',
                            padding: isMobile ? '12px' : '8px 12px',
                            background: 'transparent',
                            border: 'none',
                            borderBottom: waveData?.createdBy === currentUser?.id ? '1px solid var(--border-subtle)' : 'none',
                            color: userBlocked ? 'var(--accent-green)' : 'var(--accent-orange)',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                            fontSize: '0.7rem',
                            textAlign: 'left',
                          }}
                        >
                          {userBlocked ? '✓ UNBLOCK' : '⊘ BLOCK'}
                        </button>
                        {/* Remove from wave - only for wave creator */}
                        {waveData?.createdBy === currentUser?.id && (
                          <button
                            onClick={async () => {
                              if (confirm(CONFIRM_DIALOG.removeParticipant(p.name))) {
                                try {
                                  await fetchAPI(`/waves/${wave.id}/participants/${p.id}`, { method: 'DELETE' });
                                  showToast(`${p.name} removed from wave`, 'success');
                                  setShowModMenu(null);
                                  loadWave(); // Refresh participants
                                } catch (err) {
                                  showToast(err.message || formatError('Failed to remove participant'), 'error');
                                }
                              }
                            }}
                            style={{
                              width: '100%',
                              padding: isMobile ? '12px' : '8px 12px',
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--accent-orange)',
                              cursor: 'pointer',
                              fontFamily: 'monospace',
                              fontSize: '0.7rem',
                              textAlign: 'left',
                            }}
                          >
                            ✕ REMOVE
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Expanded Playback Panel */}
      {showPlayback && total > 0 && (
        <PlaybackControls isPlaying={isPlaying} onTogglePlay={handlePlaybackToggle}
          currentIndex={playbackIndex} totalMessages={total} onSeek={setPlaybackIndex}
          onReset={() => { setPlaybackIndex(null); setIsPlaying(false); }}
          playbackSpeed={playbackSpeed} onSpeedChange={setPlaybackSpeed} isMobile={isMobile} />
      )}

      {/* Messages */}
      <div ref={messagesRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: isMobile ? '12px' : '20px' }}>
        {/* E2EE: Show encryption status banners */}
        {e2ee.isE2EEEnabled && waveData?.encrypted === 0 && (
          <LegacyWaveNotice
            isCreator={waveData?.createdBy === currentUser?.id}
            onEnableEncryption={e2ee.isUnlocked ? handleEnableEncryption : undefined}
            isEnabling={isEnablingEncryption}
          />
        )}
        {e2ee.isE2EEEnabled && waveData?.encrypted === 2 && encryptionStatus && (
          <PartialEncryptionBanner
            progress={encryptionStatus.progress || 0}
            participantsWithE2EE={encryptionStatus.readyCount || 0}
            totalParticipants={encryptionStatus.totalParticipants || 0}
            onContinue={waveData?.createdBy === currentUser?.id && e2ee.isUnlocked ? handleContinueEncryption : undefined}
            isContinuing={isEncryptingBatch}
          />
        )}
        {/* Watch Party Banner (v2.14.0) */}
        {activeWatchParty && (
          <WatchPartyBanner
            party={activeWatchParty}
            isHost={activeWatchParty.hostId === currentUser?.id}
            onJoin={() => onJoinWatchParty?.(activeWatchParty.id)}
            onLeave={() => onLeaveWatchParty?.(activeWatchParty.id)}
            onOpen={() => onOpenWatchParty?.(activeWatchParty.id)}
            isMobile={isMobile}
          />
        )}
        {/* Load Older Messages Button */}
        {hasMoreMessages && (
          <div style={{ textAlign: 'center', marginBottom: '16px' }}>
            <button
              onClick={loadMoreMessages}
              disabled={loadingMore}
              style={{
                padding: isMobile ? '10px 20px' : '8px 16px',
                background: 'transparent',
                border: '1px solid var(--border-primary)',
                color: loadingMore ? 'var(--text-muted)' : 'var(--accent-green)',
                cursor: loadingMore ? 'wait' : 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.75rem',
              }}
            >
              {loadingMore ? 'Loading...' : `↑ Load older pings (${(waveData.total_messages || 0) - allPings.length} more)`}
            </button>
          </div>
        )}
        {pings.map((msg) => (
          <Message key={msg.id} message={msg} onReply={setReplyingTo} onDelete={handleDeleteMessage}
            onEdit={handleStartEdit} onSaveEdit={handleSaveEdit} onCancelEdit={handleCancelEdit}
            editingMessageId={editingMessageId} editContent={editContent} setEditContent={setEditContent}
            currentUserId={currentUser?.id} highlightId={replyingTo?.id} playbackIndex={playbackIndex}
            collapsed={collapsed} onToggleCollapse={toggleThreadCollapse} isMobile={isMobile}
            contentCollapsed={contentCollapsed} onToggleContentCollapse={toggleContentCollapse}
            onReact={handleReaction} onMessageClick={handleMessageClick} participants={participants}
            contacts={contacts} onShowProfile={onShowProfile} onReport={handleReportMessage}
            onOpenThread={onOpenThread}
            onShare={handleSharePing} wave={wave || waveData}
            onNavigateToWave={onNavigateToWave} currentWaveId={wave.id}
            autoFocusMessages={currentUser?.preferences?.autoFocusMessages === true}
            fetchAPI={fetchAPI}
            currentUser={currentUser} moveSource={moveSource} onStartMove={onStartMove} onCompleteMove={onCompleteMove} />
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

      {/* Compose */}
      <div
        ref={composeRef}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) {
            handleFileUpload(file);
          }
        }}
        style={{
          flexShrink: 0,
          padding: isMobile ? '12px' : '16px 20px',
          paddingBottom: isMobile ? 'calc(12px + env(safe-area-inset-bottom, 0px))' : '16px',
          background: dragOver ? 'linear-gradient(0deg, var(--bg-hover), var(--border-subtle))' : 'linear-gradient(0deg, var(--bg-surface), var(--bg-hover))',
          borderTop: dragOver ? '2px dashed var(--accent-orange)' : '1px solid var(--border-subtle)',
          transition: 'all 0.2s ease',
        }}>
        {replyingTo && (
          <div style={{
            padding: isMobile ? '10px 14px' : '8px 12px',
            marginBottom: '10px', background: 'var(--bg-elevated)',
            border: `1px solid ${config.color}40`, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div>
              <span style={{ color: 'var(--text-muted)', fontSize: isMobile ? '0.85rem' : '0.7rem' }}>REPLYING TO </span>
              <span style={{ color: config.color, fontSize: isMobile ? '0.9rem' : '0.75rem' }}>{replyingTo.sender_name}</span>
            </div>
            <button onClick={() => setReplyingTo(null)} style={{
              background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer',
              minHeight: isMobile ? '44px' : 'auto',
              minWidth: isMobile ? '44px' : 'auto',
              padding: isMobile ? '12px' : '4px',
              fontSize: isMobile ? '1.2rem' : '1rem',
            }}>✕</button>
          </div>
        )}
        {dragOver && (
          <div style={{
            padding: '12px',
            marginBottom: '10px',
            background: 'var(--accent-orange)15',
            border: '2px dashed var(--accent-orange)',
            textAlign: 'center',
            color: 'var(--accent-orange)',
            fontSize: '0.85rem',
            fontFamily: 'monospace',
          }}>
            Drop file to upload
          </div>
        )}
        {/* Media Recorder (v2.7.0) */}
        {showMediaRecorder && (
          <MediaRecorder
            type={showMediaRecorder}
            onRecordingComplete={handleMediaRecordingComplete}
            onCancel={() => setShowMediaRecorder(null)}
            isMobile={isMobile}
          />
        )}
        {/* Media Upload Status Indicator */}
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
            <style>{`
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
            `}</style>
          </div>
        )}
        {/* Camera Capture (v2.7.0) */}
        {showCameraCapture && (
          <CameraCapture
            onCapture={(file) => {
              setShowCameraCapture(false);
              handleImageUpload(file);
            }}
            onCancel={() => setShowCameraCapture(false)}
            isMobile={isMobile}
          />
        )}
        <MessageComposer
          ref={composerRef}
          participants={participants}
          contacts={contacts}
          currentUser={currentUser}
          isMobile={isMobile}
          onSend={handleSendMessage}
          onTyping={handleTyping}
          onImageUpload={(file, helpers) => {
            handleImageUpload(file);
          }}
          onFileUpload={(file, helpers) => {
            handleFileUpload(file);
          }}
          onPaste={(e, helpers) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
              if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) handleImageUpload(file);
                return;
              }
            }
          }}
          placeholder={replyingTo ? `Reply to ${replyingTo.sender_name}... (Shift+Enter for new line)` : 'Type a ping... (Shift+Enter for new line, @ to mention)'}
          uploading={uploading}
          uploadingMedia={uploadingMedia}
          mediaUploadStatus={mediaUploadStatus}
          onGifClick={() => setShowGifSearch(true)}
          onCameraClick={() => setShowCameraCapture(true)}
          onAudioRecord={() => setShowMediaRecorder(showMediaRecorder === 'audio' ? null : 'audio')}
          onVideoRecord={() => setShowMediaRecorder(showMediaRecorder === 'video' ? null : 'video')}
          plexConnections={plexConnections}
          onPlexClick={() => setShowPlexBrowser(true)}
        />
      </div>

      <WaveSettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)}
        wave={waveData} groups={groups} fetchAPI={fetchAPI} showToast={showToast}
        onUpdate={() => { loadWave(true); onWaveUpdate?.(); }}
        participants={participants}
        showParticipants={showParticipants}
        setShowParticipants={setShowParticipants}
        federationEnabled={federationEnabled}
        currentUserId={currentUser?.id}
        onFederate={() => { setShowSettings(false); setShowFederateModal(true); }}
        isMobile={isMobile} />

      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        waveTitle={waveData.title}
        onConfirm={confirmDeleteWave}
        isMobile={isMobile}
      />

      {messageToDelete && (
        <DeleteConfirmModal
          isOpen={!!messageToDelete}
          onClose={() => setMessageToDelete(null)}
          waveTitle={`message from ${messageToDelete.sender_name}`}
          onConfirm={confirmDeleteMessage}
          isMobile={isMobile}
        />
      )}

      {showGifSearch && (
        <GifSearchModal
          isOpen={showGifSearch}
          onClose={() => setShowGifSearch(false)}
          onSelect={(gifUrl) => {
            if (composerRef.current) {
              composerRef.current.appendMessage(gifUrl);
            } else {
              setNewMessage(prev => prev + (prev.trim() ? ' ' : '') + gifUrl);
            }
            setShowGifSearch(false);
          }}
          fetchAPI={fetchAPI}
          isMobile={isMobile}
        />
      )}

      {showPlexBrowser && (
        <PlexBrowserModal
          isOpen={showPlexBrowser}
          onClose={() => setShowPlexBrowser(false)}
          onSelect={(media) => {
            // Create embed URL and add to message
            const embedUrl = createPlexUrl({
              connectionId: media.connectionId,
              ratingKey: media.ratingKey,
              name: media.name,
              type: media.type,
              duration: media.duration,
              summary: media.summary,
            });
            if (composerRef.current) {
              composerRef.current.appendMessage(embedUrl);
            } else {
              setNewMessage(prev => prev + (prev.trim() ? ' ' : '') + embedUrl);
            }
            setShowPlexBrowser(false);
          }}
          fetchAPI={fetchAPI}
          isMobile={isMobile}
          connections={plexConnections}
        />
      )}

      {reportTarget && (
        <ReportModal
          isOpen={!!reportTarget}
          onClose={() => setReportTarget(null)}
          type={reportTarget.type}
          targetId={reportTarget.targetId}
          targetPreview={reportTarget.targetPreview}
          fetchAPI={fetchAPI}
          showToast={showToast}
          isMobile={isMobile}
        />
      )}

      <CallModal
        isOpen={showCallModal}
        onClose={() => {
          // Auto-dock if connected, otherwise just close
          if (voiceCall.connectionState === 'connected') {
            voiceCall.showDock();
          }
          setShowCallModal(false);
        }}
        wave={wave}
        voiceCall={voiceCall}
        user={currentUser}
        isMobile={isMobile}
      />

      <InviteToWaveModal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        wave={waveData}
        contacts={contacts}
        participants={participants}
        fetchAPI={fetchAPI}
        showToast={showToast}
        isMobile={isMobile}
        onParticipantsChange={() => loadWave(true)}
      />

      {showFederateModal && waveData && (
        <InviteFederatedModal
          isOpen={showFederateModal}
          onClose={() => setShowFederateModal(false)}
          wave={waveData}
          fetchAPI={fetchAPI}
          showToast={showToast}
          isMobile={isMobile}
        />
      )}
    </div>
  );
};

// ============ CONTACT REQUEST COMPONENTS ============
const ContactRequestsPanel = ({ requests, fetchAPI, showToast, onRequestsChange, onContactsChange, isMobile }) => {
  const [processing, setProcessing] = useState({});

  const handleAccept = async (requestId) => {
    setProcessing(prev => ({ ...prev, [requestId]: 'accept' }));
    try {
      await fetchAPI(`/contacts/requests/${requestId}/accept`, { method: 'POST' });
      showToast(SUCCESS.contactRequestAccepted, 'success');
      onRequestsChange();
      onContactsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to accept request'), 'error');
    }
    setProcessing(prev => ({ ...prev, [requestId]: null }));
  };

  const handleDecline = async (requestId) => {
    setProcessing(prev => ({ ...prev, [requestId]: 'decline' }));
    try {
      await fetchAPI(`/contacts/requests/${requestId}/decline`, { method: 'POST' });
      showToast('Contact request declined', 'info');
      onRequestsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to decline request'), 'error');
    }
    setProcessing(prev => ({ ...prev, [requestId]: null }));
  };

  if (requests.length === 0) return null;

  return (
    <div style={{
      marginBottom: '24px', padding: '16px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-teal)40',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <span style={{ color: 'var(--accent-teal)', fontSize: '1rem' }}>INCOMING REQUESTS</span>
        <span style={{
          background: 'var(--accent-teal)', color: '#000', fontSize: '0.65rem',
          padding: '2px 6px', borderRadius: '10px', fontWeight: 700,
        }}>{requests.length}</span>
      </div>
      {requests.map(request => (
        <div key={request.id} style={{
          padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          marginBottom: '8px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', flexWrap: 'wrap', gap: '12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
            <Avatar letter={request.from_user?.avatar || request.from_user?.displayName?.[0] || '?'} color="var(--accent-teal)" size={isMobile ? 40 : 36} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {request.from_user?.displayName || 'Unknown'}
              </div>
              {request.message && (
                <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '4px', fontStyle: 'italic' }}>
                  "{request.message}"
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button
              onClick={() => handleAccept(request.id)}
              disabled={!!processing[request.id]}
              style={{
                padding: isMobile ? '10px 14px' : '6px 12px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-green)20', border: '1px solid var(--accent-green)',
                color: 'var(--accent-green)', cursor: processing[request.id] ? 'wait' : 'pointer',
                fontFamily: 'monospace', fontSize: '0.75rem',
                opacity: processing[request.id] ? 0.6 : 1,
              }}>
              {processing[request.id] === 'accept' ? '...' : 'ACCEPT'}
            </button>
            <button
              onClick={() => handleDecline(request.id)}
              disabled={!!processing[request.id]}
              style={{
                padding: isMobile ? '10px 14px' : '6px 12px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'transparent', border: '1px solid var(--accent-orange)50',
                color: 'var(--accent-orange)', cursor: processing[request.id] ? 'wait' : 'pointer',
                fontFamily: 'monospace', fontSize: '0.75rem',
                opacity: processing[request.id] ? 0.6 : 1,
              }}>
              {processing[request.id] === 'decline' ? '...' : 'DECLINE'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

const SentRequestsPanel = ({ requests, fetchAPI, showToast, onRequestsChange, isMobile }) => {
  const [cancelling, setCancelling] = useState({});
  const [expanded, setExpanded] = useState(false);

  const handleCancel = async (requestId) => {
    setCancelling(prev => ({ ...prev, [requestId]: true }));
    try {
      await fetchAPI(`/contacts/requests/${requestId}`, { method: 'DELETE' });
      showToast('Contact request cancelled', 'info');
      onRequestsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to cancel request'), 'error');
    }
    setCancelling(prev => ({ ...prev, [requestId]: false }));
  };

  if (requests.length === 0) return null;

  return (
    <div style={{
      marginBottom: '24px', padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-amber)40',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', fontWeight: 500 }}>PENDING SENT REQUESTS</span>
          <span style={{
            background: 'var(--accent-amber)', color: '#000', fontSize: '0.65rem',
            padding: '2px 6px', borderRadius: '10px', fontWeight: 700,
          }}>{requests.length}</span>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: expanded ? 'var(--accent-amber)20' : 'transparent',
            border: `1px solid ${expanded ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
            color: expanded ? 'var(--accent-amber)' : 'var(--text-dim)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '0.7rem',
          }}
        >
          {expanded ? '▼ HIDE' : '▶ SHOW'}
        </button>
      </div>
      {expanded && (
        <div style={{ marginTop: '12px' }}>
          {requests.map(request => (
            <div key={request.id} style={{
              padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              marginBottom: '8px', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', flexWrap: 'wrap', gap: '8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                <Avatar letter={request.to_user?.avatar || request.to_user?.displayName?.[0] || '?'} color="var(--accent-amber)" size={isMobile ? 40 : 36} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {request.to_user?.displayName || 'Unknown'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleCancel(request.id)}
                disabled={cancelling[request.id]}
                style={{
                  padding: isMobile ? '10px 14px' : '6px 10px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: 'transparent', border: '1px solid var(--accent-orange)50',
                  color: 'var(--accent-orange)', cursor: cancelling[request.id] ? 'wait' : 'pointer',
                  fontFamily: 'monospace', fontSize: '0.7rem',
                  opacity: cancelling[request.id] ? 0.6 : 1,
                }}>
                {cancelling[request.id] ? '...' : 'CANCEL'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SendContactRequestModal = ({ isOpen, onClose, toUser, fetchAPI, showToast, onRequestSent, isMobile }) => {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  if (!isOpen || !toUser) return null;

  const handleSend = async () => {
    setSending(true);
    try {
      await fetchAPI('/contacts/request', {
        method: 'POST',
        body: { toUserId: toUser.id, message: message.trim() || undefined }
      });
      showToast(`Contact request sent to ${toUser.displayName || toUser.handle}`, 'success');
      onRequestSent();
      setMessage('');
      onClose();
    } catch (err) {
      showToast(err.message || formatError('Failed to send request'), 'error');
    }
    setSending(false);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.8)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      padding: isMobile ? '16px' : '0',
    }} onClick={onClose}>
      <div style={{
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        border: '1px solid var(--accent-teal)', padding: isMobile ? '20px' : '24px',
        width: '100%', maxWidth: '400px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <GlowText color="var(--accent-teal)" size="1rem">SEND CONTACT REQUEST</GlowText>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: '1.2rem', padding: '4px',
          }}>×</button>
        </div>

        <div style={{
          padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <Avatar letter={toUser.avatar || toUser.displayName?.[0] || '?'} color="var(--accent-teal)" size={44} />
          <div>
            <div style={{ color: 'var(--text-primary)' }}>{toUser.displayName}</div>
          </div>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ color: 'var(--text-dim)', fontSize: '0.75rem', display: 'block', marginBottom: '6px' }}>
            Message (optional)
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a message to your request..."
            maxLength={200}
            style={{
              width: '100%', padding: '12px', boxSizing: 'border-box',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)', fontFamily: 'inherit', resize: 'vertical',
              minHeight: '80px',
            }}
          />
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textAlign: 'right', marginTop: '4px' }}>
            {message.length}/200
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: isMobile ? '12px 20px' : '10px 16px',
            minHeight: isMobile ? '44px' : 'auto',
            background: 'transparent', border: '1px solid var(--border-primary)',
            color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace',
          }}>CANCEL</button>
          <button onClick={handleSend} disabled={sending} style={{
            padding: isMobile ? '12px 20px' : '10px 16px',
            minHeight: isMobile ? '44px' : 'auto',
            background: 'var(--accent-teal)20', border: '1px solid var(--accent-teal)',
            color: 'var(--accent-teal)', cursor: sending ? 'wait' : 'pointer',
            fontFamily: 'monospace', opacity: sending ? 0.6 : 1,
          }}>{sending ? 'SENDING...' : 'SEND REQUEST'}</button>
        </div>
      </div>
    </div>
  );
};

// ============ GROUP INVITATIONS PANEL ============
const GroupInvitationsPanel = ({ invitations, fetchAPI, showToast, onInvitationsChange, onGroupsChange, isMobile }) => {
  const [processing, setProcessing] = useState({});

  const handleAccept = async (invitationId) => {
    setProcessing(prev => ({ ...prev, [invitationId]: 'accept' }));
    try {
      await fetchAPI(`/groups/invitations/${invitationId}/accept`, { method: 'POST' });
      showToast(SUCCESS.joined, 'success');
      onInvitationsChange();
      onGroupsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to accept invitation'), 'error');
    }
    setProcessing(prev => ({ ...prev, [invitationId]: null }));
  };

  const handleDecline = async (invitationId) => {
    setProcessing(prev => ({ ...prev, [invitationId]: 'decline' }));
    try {
      await fetchAPI(`/groups/invitations/${invitationId}/decline`, { method: 'POST' });
      showToast('Crew invitation declined', 'info');
      onInvitationsChange();
    } catch (err) {
      showToast(err.message || formatError('Failed to decline invitation'), 'error');
    }
    setProcessing(prev => ({ ...prev, [invitationId]: null }));
  };

  if (invitations.length === 0) return null;

  return (
    <div style={{
      marginBottom: '16px', padding: '16px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-amber)40',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <span style={{ color: 'var(--accent-amber)', fontSize: '0.9rem' }}>GROUP INVITATIONS</span>
        <span style={{
          background: 'var(--accent-amber)', color: '#000', fontSize: '0.65rem',
          padding: '2px 6px', borderRadius: '10px', fontWeight: 700,
        }}>{invitations.length}</span>
      </div>
      {invitations.map(invitation => (
        <div key={invitation.id} style={{
          padding: '12px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
          marginBottom: '8px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--accent-amber)', fontSize: '0.95rem', marginBottom: '4px' }}>
                {invitation.group?.name || 'Unknown Crew'}
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                Invited by {invitation.invited_by_user?.displayName || 'Someone'}
              </div>
              {invitation.message && (
                <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '6px', fontStyle: 'italic' }}>
                  "{invitation.message}"
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button
                onClick={() => handleAccept(invitation.id)}
                disabled={!!processing[invitation.id]}
                style={{
                  padding: isMobile ? '10px 14px' : '6px 12px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: 'var(--accent-green)20', border: '1px solid var(--accent-green)',
                  color: 'var(--accent-green)', cursor: processing[invitation.id] ? 'wait' : 'pointer',
                  fontFamily: 'monospace', fontSize: '0.75rem',
                  opacity: processing[invitation.id] ? 0.6 : 1,
                }}>
                {processing[invitation.id] === 'accept' ? '...' : 'JOIN'}
              </button>
              <button
                onClick={() => handleDecline(invitation.id)}
                disabled={!!processing[invitation.id]}
                style={{
                  padding: isMobile ? '10px 14px' : '6px 12px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: 'transparent', border: '1px solid var(--accent-orange)50',
                  color: 'var(--accent-orange)', cursor: processing[invitation.id] ? 'wait' : 'pointer',
                  fontFamily: 'monospace', fontSize: '0.75rem',
                  opacity: processing[invitation.id] ? 0.6 : 1,
                }}>
                {processing[invitation.id] === 'decline' ? '...' : 'DECLINE'}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ============ INVITE TO GROUP MODAL ============
const InviteToGroupModal = ({ isOpen, onClose, group, contacts, fetchAPI, showToast, isMobile }) => {
  const [selectedContacts, setSelectedContacts] = useState([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen || !group) return null;

  // Filter contacts that aren't already group members
  const availableContacts = contacts.filter(c => {
    // Check if contact matches search
    const matchesSearch = !searchQuery ||
      c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.handle?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const toggleContact = (contactId) => {
    setSelectedContacts(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  const handleSendInvites = async () => {
    if (selectedContacts.length === 0) return;
    setSending(true);
    try {
      const result = await fetchAPI(`/groups/${group.id}/invite`, {
        method: 'POST',
        body: { userIds: selectedContacts, message: message.trim() || undefined }
      });
      const successCount = result.invitations?.length || 0;
      const errorCount = result.errors?.length || 0;
      if (successCount > 0) {
        showToast(`Sent ${successCount} invitation${successCount > 1 ? 's' : ''}`, 'success');
      }
      if (errorCount > 0) {
        showToast(`${errorCount} invitation${errorCount > 1 ? 's' : ''} failed`, 'error');
      }
      setSelectedContacts([]);
      setMessage('');
      setSearchQuery('');
      onClose();
    } catch (err) {
      showToast(err.message || formatError('Failed to send invitations'), 'error');
    }
    setSending(false);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.85)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      padding: isMobile ? '16px' : '0',
    }} onClick={onClose}>
      <div style={{
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        border: '2px solid var(--accent-amber)40', padding: isMobile ? '20px' : '24px',
        width: '100%', maxWidth: '450px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <GlowText color="var(--accent-amber)" size="1rem">INVITE TO {group.name?.toUpperCase()}</GlowText>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: '1.2rem', padding: '4px',
          }}>×</button>
        </div>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search contacts..."
          style={{
            width: '100%', padding: '10px', boxSizing: 'border-box', marginBottom: '12px',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: 'inherit',
          }}
        />

        <div style={{
          flex: 1, overflowY: 'auto', marginBottom: '16px',
          border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
          maxHeight: '250px', minHeight: '150px',
        }}>
          {availableContacts.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
              {contacts.length === 0 ? 'No contacts to invite' : 'No matching contacts'}
            </div>
          ) : availableContacts.map(contact => {
            const isSelected = selectedContacts.includes(contact.id);
            return (
              <div
                key={contact.id}
                onClick={() => toggleContact(contact.id)}
                style={{
                  padding: '10px 12px', cursor: 'pointer',
                  background: isSelected ? 'var(--accent-amber)15' : 'transparent',
                  borderBottom: '1px solid var(--bg-hover)',
                  display: 'flex', alignItems: 'center', gap: '12px',
                }}>
                <div style={{
                  width: '20px', height: '20px', border: `2px solid ${isSelected ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
                  background: isSelected ? 'var(--accent-amber)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#000', fontSize: '0.8rem', fontWeight: 'bold',
                }}>
                  {isSelected && '✓'}
                </div>
                <Avatar letter={contact.avatar || contact.name?.[0] || '?'} color={isSelected ? 'var(--accent-amber)' : 'var(--text-dim)'} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {contact.name}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ color: 'var(--text-dim)', fontSize: '0.75rem', display: 'block', marginBottom: '6px' }}>
            Message (optional)
          </label>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a message to your invitation..."
            maxLength={200}
            style={{
              width: '100%', padding: '10px', boxSizing: 'border-box',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)', fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            {selectedContacts.length} selected
          </span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={onClose} style={{
              padding: isMobile ? '12px 20px' : '10px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: 'transparent', border: '1px solid var(--border-primary)',
              color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace',
            }}>CANCEL</button>
            <button
              onClick={handleSendInvites}
              disabled={sending || selectedContacts.length === 0}
              style={{
                padding: isMobile ? '12px 20px' : '10px 16px',
                minHeight: isMobile ? '44px' : 'auto',
                background: selectedContacts.length > 0 ? 'var(--accent-amber)20' : 'transparent',
                border: `1px solid ${selectedContacts.length > 0 ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
                color: selectedContacts.length > 0 ? 'var(--accent-amber)' : 'var(--text-muted)',
                cursor: sending || selectedContacts.length === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace', opacity: sending ? 0.6 : 1,
              }}>
              {sending ? 'SENDING...' : 'SEND INVITES'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


export default WaveView;
