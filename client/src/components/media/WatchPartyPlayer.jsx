import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { API_URL } from '../../config/constants.js';
import { GlowText, Avatar } from '../ui/SimpleComponents.jsx';
import { storage } from '../../utils/storage.js';

/**
 * WatchPartyPlayer Component (v2.14.0)
 *
 * Synchronized video player for Jellyfin watch parties.
 * - Hosts can control playback for all viewers
 * - Sync events: play, pause, seek
 * - Shows list of party participants
 *
 * Props:
 * - party: { id, waveId, hostId, connectionId, itemId, name, type, state, position, participants }
 * - currentUserId: string
 * - onSyncEvent: (event) => void - Called when user performs action to sync
 * - onLeave: () => void
 * - isMobile: boolean
 */
const WatchPartyPlayer = ({
  party,
  currentUserId,
  onSyncEvent,
  onLeave,
  isMobile,
}) => {
  const [isPlaying, setIsPlaying] = useState(party?.state === 'playing');
  const [currentTime, setCurrentTime] = useState(party?.position || 0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showParticipants, setShowParticipants] = useState(false);
  const [syncPending, setSyncPending] = useState(false);

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const controlsTimeoutRef = useRef(null);
  const lastSyncRef = useRef(null);

  const isHost = party?.hostId === currentUserId;

  // Build authenticated stream URL
  const streamUrl = useMemo(() => {
    if (!party?.connectionId || !party?.itemId) return '';
    const token = storage.getToken();
    return `${API_URL}/jellyfin/video/${party.connectionId}/${party.itemId}?party=${encodeURIComponent(party.id)}&token=${encodeURIComponent(token || '')}`;
  }, [party?.id, party?.connectionId, party?.itemId]);

  // Format time as HH:MM:SS or MM:SS
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handle incoming sync events from other users
  useEffect(() => {
    if (!party || !videoRef.current) return;

    // Check if we need to sync (either state or position changed)
    const currentState = isPlaying ? 'playing' : 'paused';
    const positionDrift = Math.abs(currentTime - (party.position || 0));

    // Ignore our own events (within 1 second)
    if (lastSyncRef.current && Date.now() - lastSyncRef.current < 1000) {
      return;
    }

    // Sync state if different
    if (party.state && party.state !== currentState) {
      if (party.state === 'playing' && !isPlaying) {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      } else if (party.state === 'paused' && isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }

    // Sync position if drifted more than 3 seconds
    if (party.position !== undefined && positionDrift > 3) {
      setSyncPending(true);
      videoRef.current.currentTime = party.position;
      setCurrentTime(party.position);
      setTimeout(() => setSyncPending(false), 500);
    }
  }, [party?.state, party?.position]);

  // Handle video metadata loaded
  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setIsLoading(false);

      // Seek to party position if joining in progress
      if (party?.position && party.position > 0) {
        videoRef.current.currentTime = party.position;
        setCurrentTime(party.position);
      }

      // Start playing if party is in playing state
      if (party?.state === 'playing') {
        videoRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  }, [party?.position, party?.state]);

  // Handle time update
  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current && !syncPending) {
      setCurrentTime(videoRef.current.currentTime);
    }
  }, [syncPending]);

  // Handle playback ended
  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setShowControls(true);
    if (isHost && onSyncEvent) {
      onSyncEvent({ type: 'pause', position: duration });
    }
  }, [isHost, onSyncEvent, duration]);

  // Handle error
  const handleError = useCallback(() => {
    setError('Failed to load video. You may not have access to this Jellyfin server.');
    setIsLoading(false);
  }, []);

  // Toggle play/pause (host only)
  const togglePlay = useCallback(() => {
    if (!videoRef.current || !isHost) return;

    lastSyncRef.current = Date.now();

    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
      if (onSyncEvent) {
        onSyncEvent({ type: 'pause', position: videoRef.current.currentTime });
      }
    } else {
      videoRef.current.play();
      setIsPlaying(true);
      if (onSyncEvent) {
        onSyncEvent({ type: 'play', position: videoRef.current.currentTime });
      }
    }
  }, [isPlaying, isHost, onSyncEvent]);

  // Handle seek (host only)
  const handleSeek = useCallback((e) => {
    if (!videoRef.current || !duration || !isFinite(duration) || !isHost) return;

    lastSyncRef.current = Date.now();

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * duration;

    if (isFinite(newTime)) {
      videoRef.current.currentTime = newTime;
      setCurrentTime(newTime);
      if (onSyncEvent) {
        onSyncEvent({ type: 'seek', position: newTime });
      }
    }
  }, [duration, isHost, onSyncEvent]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  // Handle mouse move to show/hide controls
  const handleMouseMove = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [isPlaying]);

  // Progress percentage
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (!party) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#000',
        zIndex: 2000,
        display: 'flex',
        flexDirection: 'column',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* Video */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {error ? (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent-orange)',
            padding: '20px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚠</div>
            <div style={{ fontSize: '1rem', marginBottom: '8px' }}>{error}</div>
            <button
              onClick={onLeave}
              style={{
                marginTop: '16px',
                padding: '12px 24px',
                background: 'var(--accent-purple)',
                border: 'none',
                color: 'white',
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
            >
              Leave Party
            </button>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={streamUrl}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
            preload="metadata"
            playsInline
            onClick={isHost ? togglePlay : undefined}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onEnded={handleEnded}
            onError={handleError}
          />
        )}

        {/* Loading overlay */}
        {isLoading && !error && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.8)',
          }}>
            <GlowText color="var(--accent-purple)">Loading...</GlowText>
          </div>
        )}

        {/* Sync indicator */}
        {syncPending && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0,0,0,0.8)',
            padding: '12px 24px',
            borderRadius: '8px',
            color: 'var(--accent-purple)',
            fontFamily: 'monospace',
          }}>
            Syncing...
          </div>
        )}

        {/* Play/Pause overlay (for non-hosts, show current state) */}
        {!isHost && showControls && !isLoading && !error && (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '2rem',
            opacity: !isPlaying ? 1 : 0,
            transition: 'opacity 0.3s',
          }}>
            ▶
          </div>
        )}
      </div>

      {/* Controls bar */}
      <div style={{
        background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
        padding: isMobile ? '20px 16px 24px' : '16px',
        opacity: showControls ? 1 : 0,
        transition: 'opacity 0.3s',
      }}>
        {/* Title and host indicator */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '12px',
        }}>
          <div>
            <div style={{ color: 'white', fontSize: '1rem', fontWeight: 500 }}>
              {party.name}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
              {isHost ? 'You are the host' : `Host: ${party.hostName || 'Unknown'}`}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Participants toggle */}
            <button
              onClick={() => setShowParticipants(!showParticipants)}
              style={{
                background: showParticipants ? 'var(--accent-purple)40' : 'rgba(255,255,255,0.1)',
                border: '1px solid var(--accent-purple)60',
                color: 'white',
                padding: '8px 12px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              👥 {party.participants?.length || 1}
            </button>

            {/* Leave button */}
            <button
              onClick={onLeave}
              style={{
                background: 'rgba(255,100,100,0.2)',
                border: '1px solid rgba(255,100,100,0.5)',
                color: '#ff6464',
                padding: '8px 16px',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.75rem',
              }}
            >
              Leave
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div
          onClick={isHost ? handleSeek : undefined}
          style={{
            height: '6px',
            background: 'rgba(255,255,255,0.2)',
            borderRadius: '3px',
            cursor: isHost ? 'pointer' : 'default',
            position: 'relative',
            marginBottom: '12px',
          }}
        >
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${progressPercent}%`,
            background: 'var(--accent-purple)',
            borderRadius: '3px',
          }} />
        </div>

        {/* Controls */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}>
          {/* Play/Pause (host only) */}
          {isHost && (
            <button
              onClick={togglePlay}
              style={{
                background: 'var(--accent-purple)',
                border: 'none',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
              }}
            >
              {isPlaying ? '❚❚' : '▶'}
            </button>
          )}

          {/* Time */}
          <div style={{
            color: 'white',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
          }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <div style={{ flex: 1 }} />

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: 'white',
              padding: '8px 12px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
            }}
          >
            ⛶
          </button>
        </div>

        {/* Participants panel */}
        {showParticipants && (
          <div style={{
            marginTop: '16px',
            padding: '12px',
            background: 'rgba(0,0,0,0.5)',
            borderRadius: '8px',
            border: '1px solid var(--border-subtle)',
          }}>
            <div style={{
              color: 'var(--text-muted)',
              fontSize: '0.7rem',
              marginBottom: '8px',
              textTransform: 'uppercase',
            }}>
              Watching ({party.participants?.length || 1})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {(party.participants || []).map((p, idx) => (
                <div
                  key={p.id || idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(255,255,255,0.05)',
                    padding: '4px 8px',
                    borderRadius: '4px',
                  }}
                >
                  <Avatar
                    name={p.displayName || p.name || p.handle}
                    size={20}
                    avatarUrl={p.avatarUrl}
                  />
                  <span style={{ color: 'white', fontSize: '0.8rem' }}>
                    {p.displayName || p.name || p.handle}
                    {p.id === party.hostId && (
                      <span style={{ color: 'var(--accent-purple)', marginLeft: '4px' }}>(host)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WatchPartyPlayer;
