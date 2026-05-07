import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EMPTY } from '../../../messages.js';

const NOTIFICATION_TYPES = {
  direct_mention: { icon: '@', color: 'var(--accent-amber)', label: 'Mentioned you' },
  reply: { icon: '↩', color: 'var(--accent-teal)', label: 'Replied to you' },
  reaction: { icon: '♡', color: 'var(--accent-pink, #ff6b9d)', label: 'Reacted to your message' },
  wave_activity: { icon: '◎', color: 'var(--accent-green)', label: 'Wave activity' },
  burst: { icon: '◈', color: 'var(--accent-purple)', label: 'Burst' },
  system: { icon: '⚡', color: 'var(--accent-orange)', label: 'System' },
};

const NotificationItem = ({ notification, onRead, onDismiss, onClick, decryptedPreview }) => {
  const typeConfig = NOTIFICATION_TYPES[notification.type] || NOTIFICATION_TYPES.system;
  const timeAgo = (date) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div
      onClick={() => onClick(notification)}
      style={{
        padding: '12px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        background: notification.read ? 'transparent' : 'var(--accent-amber)08',
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
        position: 'relative',
      }}
    >
      {/* Unread indicator */}
      {!notification.read && (
        <div style={{
          position: 'absolute',
          left: '4px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: typeConfig.color,
        }} />
      )}

      {/* Type icon */}
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: `${typeConfig.color}20`,
        border: `1px solid ${typeConfig.color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: typeConfig.color,
        fontSize: '0.9rem',
        fontWeight: 'bold',
        flexShrink: 0,
      }}>
        {typeConfig.icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
          <span style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', fontWeight: 500 }}>
            {notification.actorDisplayName || notification.title}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{timeAgo(notification.createdAt)}</span>
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>
          {notification.body || typeConfig.label}
        </div>
        {(decryptedPreview || notification.preview) && (() => {
          const preview = decryptedPreview || notification.preview;
          if (preview === '[E2E encrypted]') {
            return (
              <div style={{
                color: 'var(--accent-teal)',
                fontSize: '0.7rem',
                fontFamily: 'monospace',
                opacity: 0.8,
              }}>
                Encrypted message — open Cortex to read
              </div>
            );
          }
          return (
            <div style={{
              color: 'var(--text-dim)',
              fontSize: '0.7rem',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              "{preview.substring(0, 60)}{preview.length > 60 ? '...' : ''}"
            </div>
          );
        })()}
        {notification.waveTitle && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '4px' }}>
            in {notification.waveTitle}
          </div>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(notification.id); }}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          fontSize: '0.8rem',
          padding: '4px',
          opacity: 0.6,
        }}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
};

const NotificationDropdown = ({ notifications, unreadCount, onRead, onDismiss, onClick, onReadAll, onDismissAll, onClose, isMobile }) => {
  return (
    <div style={{
      position: isMobile ? 'fixed' : 'absolute',
      top: isMobile ? '0' : '100%',
      right: isMobile ? '0' : '-10px',
      left: isMobile ? '0' : 'auto',
      bottom: isMobile ? '0' : 'auto',
      width: isMobile ? '100%' : '360px',
      maxHeight: isMobile ? '100%' : '480px',
      background: 'var(--bg-surface)',
      border: isMobile ? 'none' : '1px solid var(--border-primary)',
      zIndex: 300,
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        paddingTop: isMobile ? 'calc(12px + env(safe-area-inset-top, 0px))' : '12px',
        borderBottom: '1px solid var(--border-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-hover)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--accent-amber)', fontSize: '0.9rem', fontWeight: 600 }}>Notifications</span>
          {unreadCount > 0 && (
            <span style={{
              background: 'var(--accent-orange)',
              color: '#fff',
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: '10px',
            }}>{unreadCount}</span>
          )}
          {unreadCount > 0 && (
            <button
              onClick={onReadAll}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-teal)',
                cursor: 'pointer',
                fontSize: '0.7rem',
                fontFamily: 'monospace',
              }}
            >
              Mark all read
            </button>
          )}
          {notifications.length > 0 && (
            <button
              onClick={onDismissAll}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--accent-orange)',
                cursor: 'pointer',
                fontSize: '0.7rem',
                fontFamily: 'monospace',
              }}
            >
              Clear all
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: '1rem',
            padding: '4px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Notification list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {notifications.length === 0 ? (
          <div style={{
            padding: '40px 20px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
          }}>
            {EMPTY.noNotifications}
          </div>
        ) : (
          notifications.map(n => (
            <NotificationItem
              key={n.id}
              notification={n}
              onRead={onRead}
              onDismiss={onDismiss}
              onClick={onClick}
              decryptedPreview={decryptedPreviews[n.id]}
            />
          ))
        )}
      </div>
    </div>
  );
};

const NotificationBell = ({ fetchAPI, onNavigateToWave, isMobile, refreshTrigger, onAllRead, e2ee }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [decryptedPreviews, setDecryptedPreviews] = useState({}); // { notifId: string }
  const bellRef = useRef(null);
  const decryptingRef = useRef(new Set()); // prevents concurrent duplicate decryption

  // Load notifications
  const loadNotifications = useCallback(async () => {
    try {
      const [notifData, countData] = await Promise.all([
        fetchAPI('/notifications?limit=20'),
        fetchAPI('/notifications/count'),
      ]);
      setNotifications(notifData.notifications || []);
      setUnreadCount(countData.total || 0);
    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  }, [fetchAPI]);

  // Load on mount and periodically
  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 120000); // Refresh every 2 min (sync routine handles freshness)
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Refresh when trigger changes (WebSocket notification received)
  useEffect(() => {
    if (refreshTrigger > 0) {
      loadNotifications();
    }
  }, [refreshTrigger, loadNotifications]);

  // Decrypt encrypted previews when bell opens or notifications change
  useEffect(() => {
    if (!showDropdown || !e2ee?.decryptPing) return;
    const encrypted = notifications.filter(
      n => n.preview === '[E2E encrypted]' && n.pingId && !decryptedPreviews[n.id] && !decryptingRef.current.has(n.id)
    );
    if (encrypted.length === 0) return;

    encrypted.forEach(async (notif) => {
      decryptingRef.current.add(notif.id);
      try {
        const res = await fetchAPI(`/pings/${notif.pingId}`);
        if (!res.ok) return;
        const ping = await res.json();
        if (!ping.encrypted || !ping.nonce) return;
        const plaintext = await e2ee.decryptPing(ping.content, ping.nonce, ping.waveId, ping.keyVersion);
        const preview = plaintext.replace(/<[^>]*>/g, '').substring(0, 100);
        setDecryptedPreviews(prev => ({ ...prev, [notif.id]: preview }));
      } catch {
        // Key not available or decryption failed — leave as encrypted sentinel
      } finally {
        decryptingRef.current.delete(notif.id);
      }
    });
  }, [showDropdown, notifications, e2ee, fetchAPI, decryptedPreviews]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (bellRef.current && !bellRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown && !isMobile) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown, isMobile]);

  const handleMarkRead = async (notificationId) => {
    try {
      await fetchAPI(`/notifications/${notificationId}/read`, { method: 'POST' });
      setNotifications(prev => prev.map(n =>
        n.id === notificationId ? { ...n, read: true } : n
      ));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetchAPI('/notifications/read-all', { method: 'POST' });
      setNotifications([]);
      setUnreadCount(0);
      setShowDropdown(false);
      // Notify parent to refresh wave list (clears wave unread badges)
      if (onAllRead) onAllRead();
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  const handleDismissAll = async () => {
    try {
      // Mark all as read first (clears wave unread badges too)
      await fetchAPI('/notifications/read-all', { method: 'POST' });
      // Then dismiss all notification cards
      await fetchAPI('/notifications', { method: 'DELETE' });
      setNotifications([]);
      setUnreadCount(0);
      setShowDropdown(false);
      if (onAllRead) onAllRead();
    } catch (err) {
      console.error('Failed to dismiss all notifications:', err);
    }
  };

  const handleDismiss = async (notificationId) => {
    try {
      await fetchAPI(`/notifications/${notificationId}`, { method: 'DELETE' });
      const notification = notifications.find(n => n.id === notificationId);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      if (notification && !notification.read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Failed to dismiss notification:', err);
    }
  };

  const handleNotificationClick = (notification) => {
    // Mark as read
    if (!notification.read) {
      handleMarkRead(notification.id);
    }

    // Navigate to the relevant content
    if (notification.waveId) {
      onNavigateToWave(notification.waveId, notification.pingId);
    }

    setShowDropdown(false);
  };

  return (
    <div ref={bellRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        style={{
          padding: '8px 12px',
          background: showDropdown ? 'var(--accent-amber)15' : 'transparent',
          border: `1px solid ${showDropdown ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
          color: showDropdown ? 'var(--accent-amber)' : 'var(--text-dim)',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: '0.9rem',
          position: 'relative',
        }}
        title="Notifications"
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '-6px',
            right: '-6px',
            background: 'var(--accent-orange)',
            color: '#fff',
            fontSize: '0.55rem',
            fontWeight: 700,
            padding: '2px 5px',
            borderRadius: '10px',
            minWidth: '16px',
            textAlign: 'center',
            boxShadow: '0 0 8px rgba(255, 107, 53, 0.8)',
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {showDropdown && (
        <NotificationDropdown
          notifications={notifications}
          unreadCount={unreadCount}
          onRead={handleMarkRead}
          onDismiss={handleDismiss}
          onClick={handleNotificationClick}
          onReadAll={handleMarkAllRead}
          onDismissAll={handleDismissAll}
          onClose={() => setShowDropdown(false)}
          isMobile={isMobile}
        />
      )}
    </div>
  );
};

export default NotificationBell;
