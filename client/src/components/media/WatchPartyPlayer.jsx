import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { API_URL } from '../../config/constants.js';
import { GlowText } from '../ui/SimpleComponents.jsx';
import { storage } from '../../utils/storage.js';
import { expectedPosition } from '../../utils/watchParty.js';
import { useSystemBack } from '../../hooks/useSystemBack.js';

/**
 * WatchPartyPlayer Component (v2.14.0; rewired v2.155.3)
 *
 * Synchronised video player for Jellyfin watch parties. The host plays,
 * pauses and seeks for everyone and says where it is every few seconds;
 * everyone else follows.
 *
 * Props:
 * - party: normalised party (utils/watchParty.js)
 * - currentUserId: string
 * - onCommand: (command: 'play'|'pause'|'seek', position) => void (host)
 * - onHeartbeat: (position, isPlaying) => void (host, every few seconds)
 * - onLeave: () => void - close the player (the party goes on)
 * - onEnd: () => void - host only: end the party for everyone
 * - isMobile: boolean
 */
const HEARTBEAT_MS = 5000;
// How far a viewer may drift from the host before being moved.
const DRIFT_SECONDS = 2;

const formatTime = (seconds) => {
  if (!seconds || !Number.isFinite(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`;
};

const WatchPartyPlayer = ({ party, currentUserId, onCommand, onHeartbeat, onLeave, onEnd, isMobile }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [muted, setMuted] = useState(false);

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const controlsTimeoutRef = useRef(null);

  const isHost = !!party && party.hostId === currentUserId;

  useSystemBack(true, onLeave, { marker: 'cortex-watch-party' });

  // Video elements can't send headers, so the token rides in the URL, as for
  // every Jellyfin embed. `party` is what lets a viewer stream the host's item.
  const streamUrl = useMemo(() => {
    if (!party?.connectionId || !party?.itemId) return '';
    const token = storage.getToken();
    return `${API_URL}/jellyfin/video/${party.connectionId}/${party.itemId}?party=${encodeURIComponent(party.id)}&token=${encodeURIComponent(token || '')}`;
  }, [party?.id, party?.connectionId, party?.itemId]);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().then(() => setNeedsTap(false)).catch(() => {
      // Autoplay refused (no tap on this page yet): ask for one.
      if (!isHost) setNeedsTap(true);
    });
  }, [isHost]);

  // A viewer follows the host: its play state, and its position give or take
  // a couple of seconds (allowing for the time since the host said it).
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isHost || isLoading || !party) return;
    const target = expectedPosition(party);
    if (Number.isFinite(target) && Math.abs(video.currentTime - target) > DRIFT_SECONDS) {
      video.currentTime = target;
    }
    if (party.state === 'playing' && video.paused) play();
    else if (party.state === 'paused' && !video.paused) video.pause();
  }, [party?.state, party?.position, party?.syncedAt, isHost, isLoading, play]);

  // The host says where it is every few seconds, so a viewer who joins late
  // or drifts is put right.
  useEffect(() => {
    if (!isHost) return undefined;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (video && !isLoading) onHeartbeat?.(video.currentTime, !video.paused);
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [isHost, isLoading, onHeartbeat]);

  const handleLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    setIsLoading(false);
    const start = expectedPosition(party);
    if (start > 0 && Number.isFinite(start)) video.currentTime = start;
    // A host reopening a playing party carries on; a viewer follows.
    if (party?.state === 'playing') play();
  }, [party, play]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isHost) return;
    if (video.paused) {
      play();
      onCommand?.('play', video.currentTime);
    } else {
      video.pause();
      onCommand?.('pause', video.currentTime);
    }
  }, [isHost, onCommand, play]);

  const handleSeek = useCallback((e) => {
    const video = videoRef.current;
    if (!video || !isHost || !duration || !Number.isFinite(duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const to = fraction * duration;
    video.currentTime = to;
    setCurrentTime(to);
    onCommand?.('seek', to);
  }, [duration, isHost, onCommand]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) containerRef.current.requestFullscreen?.();
    else document.exitFullscreen?.();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  // Controls fade while playing and come back on any touch or movement.
  const revealControls = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  }, [isPlaying]);
  useEffect(() => () => clearTimeout(controlsTimeoutRef.current), []);
  useEffect(() => { if (!isPlaying) setShowControls(true); }, [isPlaying]);

  if (!party) return null;

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const smallButton = {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.25)',
    color: 'white',
    padding: isMobile ? '10px 12px' : '8px 12px',
    minHeight: isMobile ? '44px' : 'auto',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={`Watch party: ${party.name}`}
      /* Above the holiday effects overlay (9999): no leaves falling across the film. */
      style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 10000, display: 'flex', flexDirection: 'column' }}
      onMouseMove={revealControls}
      onTouchStart={revealControls}
    >
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {error ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-orange)', padding: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: '1rem', marginBottom: '16px' }}>{error}</div>
            <button onClick={onLeave} style={smallButton}>CLOSE</button>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={streamUrl}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            preload="metadata"
            playsInline
            onClick={isHost ? togglePlay : revealControls}
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => { setIsPlaying(false); if (isHost) onCommand?.('pause', videoRef.current?.currentTime || 0); }}
            onError={() => { setError('The video could not be loaded. The party may have ended, or the host\'s media server is unreachable.'); setIsLoading(false); }}
          />
        )}

        {isLoading && !error && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)' }}>
            <GlowText color="var(--accent-amber)">Loading…</GlowText>
          </div>
        )}

        {needsTap && !error && (
          <button
            onClick={play}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', border: 'none', color: 'white', fontFamily: 'monospace', fontSize: '1rem', cursor: 'pointer' }}
          >
            ▶ TAP TO JOIN PLAYBACK
          </button>
        )}

        {!isHost && !isLoading && !error && !needsTap && party.state === 'paused' && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.6)', padding: '10px 16px', color: 'white', fontFamily: 'monospace', fontSize: '0.85rem', pointerEvents: 'none' }}>
            Paused by {party.hostName || 'the host'}
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{
        background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
        padding: isMobile ? '12px 12px calc(16px + env(safe-area-inset-bottom))' : '16px',
        opacity: showControls ? 1 : 0,
        transition: 'opacity 0.3s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '12px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'white', fontSize: '1rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {party.name}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>
              {isHost ? 'You are hosting: play, pause and seek for everyone' : `Hosted by ${party.hostName || 'someone'}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            {isHost && (
              <button onClick={onEnd} style={{ ...smallButton, borderColor: 'rgba(255,100,100,0.6)', color: '#ff6464' }} title="End the watch party for everyone">
                END
              </button>
            )}
            <button onClick={onLeave} style={smallButton} title={isHost ? 'Close the player; the party goes on' : 'Close the player'}>
              CLOSE
            </button>
          </div>
        </div>

        <div
          onClick={isHost ? handleSeek : undefined}
          style={{ height: isMobile ? '10px' : '6px', background: 'rgba(255,255,255,0.2)', borderRadius: '3px', cursor: isHost ? 'pointer' : 'default', position: 'relative', marginBottom: '12px' }}
        >
          <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${progressPercent}%`, background: 'var(--accent-amber)', borderRadius: '3px' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isHost && (
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pause for everyone' : 'Play for everyone'}
              style={{ background: 'var(--accent-amber)', border: 'none', width: '44px', height: '44px', borderRadius: '50%', color: '#050805', cursor: 'pointer', fontSize: '1.1rem' }}
            >
              {isPlaying ? '❚❚' : '▶'}
            </button>
          )}
          <div style={{ color: 'white', fontFamily: 'monospace', fontSize: '0.85rem' }}>
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={toggleMute} style={smallButton} aria-label={muted ? 'Unmute' : 'Mute'}>
            {muted ? 'UNMUTE' : 'MUTE'}
          </button>
          <button onClick={toggleFullscreen} style={smallButton} aria-label="Full screen">⛶</button>
        </div>
      </div>
    </div>
  );
};

export default WatchPartyPlayer;
