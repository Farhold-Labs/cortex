import React, { useState, useEffect, useCallback } from 'react';
import { GlowText, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { T } from '../../config/terminology.js';

/**
 * JellyfinImportModal (v2.14.0)
 *
 * Placeholder for future media import functionality.
 * Will allow users to download/cache Jellyfin media locally.
 *
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - fetchAPI: function
 * - showToast: (msg, type) => void
 * - isMobile: boolean
 */
const JellyfinImportModal = ({ isOpen, onClose, fetchAPI, showToast, isMobile }) => {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    const loadConnections = async () => {
      setLoading(true);
      try {
        const data = await fetchAPI('/jellyfin/connections');
        setConnections(data.connections || []);
      } catch (err) {
        console.error('Failed to load Jellyfin connections:', err);
      } finally {
        setLoading(false);
      }
    };

    loadConnections();
  }, [isOpen, fetchAPI]);

  if (!isOpen) return null;

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: isMobile ? '16px' : '24px',
    },
    modal: {
      background: 'var(--bg-surface, #0a0f0a)',
      border: '1px solid var(--accent-color, #ffd23f)',
      maxWidth: '500px',
      width: '100%',
      maxHeight: '80vh',
      overflow: 'auto',
    },
    header: {
      padding: '16px',
      borderBottom: '1px solid var(--border-subtle)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    content: {
      padding: '24px',
      textAlign: 'center',
    },
    icon: {
      fontSize: '48px',
      marginBottom: '16px',
    },
    message: {
      color: 'var(--text-secondary)',
      fontSize: '0.9rem',
      lineHeight: 1.6,
      marginBottom: '24px',
    },
    closeButton: {
      background: 'transparent',
      border: '1px solid var(--accent-color)',
      color: 'var(--accent-color)',
      padding: '8px 16px',
      cursor: 'pointer',
      fontFamily: 'monospace',
    },
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <GlowText color="var(--accent-color)" size="1rem">
            MEDIA IMPORT
          </GlowText>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '1.2rem',
              cursor: 'pointer',
            }}
          >
            x
          </button>
        </div>

        <div style={styles.content}>
          {loading ? (
            <LoadingSpinner />
          ) : connections.length === 0 ? (
            <>
              <div style={styles.icon}>📺</div>
              <div style={styles.message}>
                No Jellyfin servers connected.<br />
                Add a connection in your profile settings to import media.
              </div>
            </>
          ) : (
            <>
              <div style={styles.icon}>🚧</div>
              <GlowText color="var(--accent-color)" size="1.1rem" style={{ marginBottom: '16px', display: 'block' }}>
                Coming Soon
              </GlowText>
              <div style={styles.message}>
                Media import functionality will allow you to download and cache
                content from your Jellyfin server for offline viewing and faster
                sharing in {T.waves}.
                <br /><br />
                For now, you can share Jellyfin content directly in {T.waves} using
                the media picker in the compose area.
              </div>
            </>
          )}

          <button style={styles.closeButton} onClick={onClose}>
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};

export default JellyfinImportModal;
