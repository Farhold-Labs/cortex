import React, { useState, useEffect } from 'react';
import { BASE_URL, PRIVACY_LEVELS } from '../../config/constants.js';
import { OFFLINE, VERSION_CHECK } from '../../../messages.js';

// ============ SCAN LINES EFFECT ============
export const ScanLines = ({ enabled = true }) => {
  if (!enabled) return null;
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1000,
      background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)' }} />
  );
};

// ============ GLOW TEXT ============
export const GlowText = ({ children, color = 'var(--accent-amber)', size = '1rem', weight = 400 }) => (
  <span style={{ color, fontSize: size, fontWeight: weight, textShadow: `0 0 10px ${color}80, 0 0 20px ${color}40` }}>
    {children}
  </span>
);

// ============ AVATAR ============
export const Avatar = ({ letter, color = 'var(--accent-amber)', size = 40, status, imageUrl }) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [imageUrl]);

  const showImage = imageUrl && !imgError;

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{
        width: size, height: size,
        background: showImage ? 'transparent' : `linear-gradient(135deg, ${color}40, ${color}10)`,
        border: `1px solid ${color}60`, borderRadius: '2px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'monospace', color, fontSize: size * 0.4,
        overflow: 'hidden',
      }}>
        {showImage ? (
          <img
            src={`${BASE_URL}${imageUrl}`}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          letter
        )}
      </div>
      {status && (
        <div style={{
          position: 'absolute', bottom: -2, right: -2,
          width: '8px', height: '8px', borderRadius: '50%',
          background: status === 'online' ? 'var(--accent-green)' : status === 'away' ? 'var(--accent-amber)' : 'var(--text-muted)',
          boxShadow: status === 'online' ? '0 0 6px var(--accent-green)' : 'none',
        }} />
      )}
    </div>
  );
};

// ============ PRIVACY BADGE ============
export const PrivacyBadge = ({ level, compact = false }) => {
  const config = PRIVACY_LEVELS[level] || PRIVACY_LEVELS.private;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: compact ? '2px 8px' : '4px 12px',
      background: config.bgColor,
      border: `1px solid ${config.color}50`,
      borderRadius: '2px',
      fontSize: compact ? '0.7rem' : '0.75rem',
      flexShrink: 0,
    }}>
      <span style={{ color: config.color }}>{config.icon}</span>
      {!compact && <span style={{ color: config.color }}>{config.name}</span>}
    </div>
  );
};

// ============ TOAST NOTIFICATION ============
export const Toast = ({ message, type = 'info', duration = 4000, dismissible, onClose }) => {
  const colors = { success: 'var(--accent-green)', error: 'var(--accent-orange)', info: 'var(--accent-amber)' };
  useEffect(() => { const t = setTimeout(onClose, duration); return () => clearTimeout(t); }, [onClose, duration]);
  return (
    <div style={{
      position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
      padding: dismissible ? '12px 32px 12px 24px' : '12px 24px', background: 'var(--bg-surface)',
      border: `1px solid ${colors[type]}`, color: colors[type],
      fontFamily: 'monospace', fontSize: '0.85rem', zIndex: 200,
      maxWidth: '90vw', textAlign: 'center',
    }}>
      {message}
      {dismissible && (
        <button onClick={onClose} style={{
          position: 'absolute', top: '4px', right: '6px',
          background: 'none', border: 'none', color: colors[type],
          cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.8rem',
          padding: '2px 4px', opacity: 0.7,
        }}>✕</button>
      )}
    </div>
  );
};

// ============ LOADING SPINNER ============
export const LoadingSpinner = ({ size = 40, color = 'var(--accent-amber)' }) => (
  <div style={{
    width: size,
    height: size,
    border: `3px solid ${color}30`,
    borderTop: `3px solid ${color}`,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  }} />
);

// ============ OFFLINE INDICATOR ============
export const OfflineIndicator = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      background: 'var(--accent-orange)',
      color: 'var(--bg-base)',
      padding: '8px',
      textAlign: 'center',
      fontFamily: 'monospace',
      fontSize: '0.85rem',
      fontWeight: 'bold',
      zIndex: 9999
    }}>
      {OFFLINE.message}
    </div>
  );
};

// ============ VERSION MISMATCH BANNER ============
export const VersionMismatchBanner = ({ serverVersion, clientVersion }) => {
  const [dismissed, setDismissed] = useState(false);

  // Only show banner when server version is newer (upgrade), not older (downgrade)
  const isNewer = (server, client) => {
    const s = (server || '').split('.').map(Number);
    const c = (client || '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((s[i] || 0) > (c[i] || 0)) return true;
      if ((s[i] || 0) < (c[i] || 0)) return false;
    }
    return false;
  };
  if (dismissed || !serverVersion || !isNewer(serverVersion, clientVersion)) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      background: 'var(--accent-amber)',
      color: 'var(--bg-base)',
      padding: 'calc(8px + env(safe-area-inset-top)) 16px 8px',
      textAlign: 'center',
      fontFamily: 'monospace',
      fontSize: '0.85rem',
      fontWeight: 'bold',
      zIndex: 9998,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '12px',
    }}>
      <span>{VERSION_CHECK.outdated} (v{serverVersion})</span>
      <button
        onClick={() => {
          if (window.electronAPI?.clearCacheAndReload) {
            window.electronAPI.clearCacheAndReload();
          } else {
            window.location.reload();
          }
        }}
        style={{
          background: 'var(--bg-base)',
          color: 'var(--accent-amber)',
          border: 'none',
          padding: '2px 10px',
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          fontWeight: 'bold',
          cursor: 'pointer',
        }}
      >
        {VERSION_CHECK.refresh}
      </button>
      <button
        onClick={() => setDismissed(true)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--bg-base)',
          fontSize: '1rem',
          cursor: 'pointer',
          padding: '0 4px',
          lineHeight: 1,
        }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
};

// ============ PULL TO REFRESH INDICATOR ============
export const PullIndicator = ({ pulling, pullDistance, refreshing, threshold = 60 }) => {
  const progress = Math.min(pullDistance / threshold, 1);
  const rotation = progress * 360;

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: `${Math.max(pullDistance, 0)}px`,
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      paddingBottom: '10px',
      background: 'linear-gradient(to bottom, var(--bg-surface), transparent)',
      transition: refreshing ? 'height 0.3s ease' : 'none',
      pointerEvents: 'none',
      zIndex: 100,
    }}>
      {(pulling || refreshing) && (
        <div style={{
          width: '24px',
          height: '24px',
          border: '2px solid var(--border-subtle)',
          borderTop: '2px solid var(--accent-green)',
          borderRadius: '50%',
          transform: refreshing ? 'none' : `rotate(${rotation}deg)`,
          animation: refreshing ? 'spin 1s linear infinite' : 'none',
          opacity: Math.max(progress, 0.3),
        }} />
      )}
    </div>
  );
};
