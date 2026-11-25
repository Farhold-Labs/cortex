import React, { useState, useRef, useEffect, useCallback } from 'react';
import { API_URL } from '../../config/constants.js';
import { GlowText } from '../ui/SimpleComponents.jsx';
import { storage } from '../../utils/storage.js';
import { expectedPosition } from '../../utils/watchParty.js';
import { mediaPlaybackUrl } from '../../utils/media.js';
import { useSystemBack } from '../../hooks/useSystemBack.js';

/**
 * WatchPartyPlayer Component (v2.14.0; rewired v2.155.3)
 *
 * Synchronised video player for Jellyfin and Plex watch parties (Plex since
 * v2.156.0). The host plays,
 * pauses and seeks for everyone and says where it is every few seconds;
 * everyone else follows.
 *
 * Two sizes (v2.157.0): the whole screen, or a small window in a corner over
 * the app (picture in picture), so the wave stays open to talk in. Drag the
 * small window to any corner; tap it to fill the screen again. The size and
 * corner are remembered on this device. Where the browser offers it, POP OUT
 * hands the video to the system's own picture-in-picture window.
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

const PREF_KEY = 'cortex-watch-party-view';
const readPref = () => {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    return { mode: v.mode === 'mini' ? 'mini' : 'full', corner: ['tl', 'tr', 'bl', 'br'].includes(v.corner) ? v.corner : 'tr' };
  } catch { return { mode: 'full', corner: 'tr' }; }
};
const savePref = (pref) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(pref)); } catch { /* per-device nicety only */ } };
// Clear of the app's header at the top and the composer and nav at the bottom.
const MINI_INSET = { top: 'calc(64px + env(safe-area-inset-top, 0px))', bottom: 'calc(150px + env(safe-area-inset-bottom, 0px))', side: '8px' };
const CONTROLS_HIDE_MS = 3000;

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

  const [pref, setPrefState] = useState(readPref);
  const setPref = useCallback((change) => setPrefState(prev => { const next = { ...prev, ...change }; savePref(next); return next; }), []);
  const mini = pref.mode === 'mini';
  const [drag, setDrag] = useState(null); // { x, y } while the small window is being dragged
  const dragRef = useRef(null);

  // Back shrinks the full-screen player to the corner; small, back belongs to the app.
  useSystemBack(!mini, () => setPref({ mode: 'mini' }), { marker: 'cortex-watch-party' });

  // Ask the provider's stream route for this item, as the Jellyfin and Plex
  // cards do; the party is what lets a viewer stream the host's item. Plex may
  // answer with an HLS playlist (when it must transcode), played with hls.js.
  // Video elements can't send headers, so the token rides in the URL.
  const [stream, setStream] = useState(null); // { url, hls }
  const hlsRef = useRef(null);
  useEffect(() => {
    if (!party?.connectionId || !party?.itemId) return undefined;
    let live = true;
    const token = storage.getToken();
    const provider = party.provider === 'plex' ? 'plex' : 'jellyfin';
    fetch(`${API_URL}/${provider}/stream/${party.connectionId}/${party.itemId}?party=${encodeURIComponent(party.id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok || !data.streamUrl) throw new Error(data.error || 'The video could not be loaded.');
        setStream({ url: mediaPlaybackUrl(data.streamUrl, API_URL, token), hls: !!data.needsHlsPlayer });
      })
      .catch((err) => { if (live) { setError(err.message); setIsLoading(false); } });
    return () => { live = false; };
  }, [party?.id, party?.provider, party?.connectionId, party?.itemId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!stream || !video) return undefined;
    let cancelled = false;
    if (!stream.hls || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = stream.url;
    } else {
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) { setError('This browser cannot play this video.'); setIsLoading(false); return; }
        const hls = new Hls();
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else { setError('The video could not be loaded.'); setIsLoading(false); }
        });
        hls.loadSource(stream.url);
        hls.attachMedia(video);
        hlsRef.current = hls;
      });
    }
    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [stream]);

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

  // Controls fade while playing: three seconds after playback starts or after
  // the last touch or movement, whether or not anyone has touched it yet.
  const hideControlsSoon = useCallback(() => {
    clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), CONTROLS_HIDE_MS);
  }, []);
  const revealControls = useCallback(() => {
    setShowControls(true);
    if (isPlaying) hideControlsSoon(); else clearTimeout(controlsTimeoutRef.current);
  }, [isPlaying, hideControlsSoon]);
  useEffect(() => () => clearTimeout(controlsTimeoutRef.current), []);
  useEffect(() => {
    if (isPlaying) hideControlsSoon();
    else { clearTimeout(controlsTimeoutRef.current); setShowControls(true); }
  }, [isPlaying, hideControlsSoon]);

  // A tap on the picture: show the controls if they're hidden; otherwise the
  // host plays or pauses for everyone.
  const tapPicture = useCallback(() => {
    if (!showControls) { revealControls(); return; }
    if (isHost) togglePlay(); else revealControls();
  }, [showControls, isHost, togglePlay, revealControls]);

  // The system's own picture-in-picture window (outside the app), where offered.
  const canPopOut = typeof document !== 'undefined' && !!document.pictureInPictureEnabled;
  const popOut = useCallback(() => {
    const video = videoRef.current;
    if (!video?.requestPictureInPicture) return;
    (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()).catch(() => {});
  }, []);

  // Dragging the small window: it follows the finger, then settles in the
  // nearest corner. A press that barely moves is a tap: fill the screen.
  const onMiniPointerDown = useCallback((e) => {
    if (e.target.closest('button')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);
  const onMiniPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 8) return;
    d.moved = true;
    setDrag({
      x: Math.max(0, Math.min(window.innerWidth - d.w, e.clientX - d.dx)),
      y: Math.max(0, Math.min(window.innerHeight - d.h, e.clientY - d.dy)),
    });
  }, []);
  const onMiniPointerUp = useCallback((e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) { setPref({ mode: 'full' }); return; }
    const cx = e.clientX - d.dx + d.w / 2, cy = e.clientY - d.dy + d.h / 2;
    setPref({ corner: (cy < window.innerHeight / 2 ? 't' : 'b') + (cx < window.innerWidth / 2 ? 'l' : 'r') });
    setDrag(null);
  }, [setPref]);

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
  const miniButton = {
    background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.3)', color: 'white',
    width: '32px', height: '32px', padding: 0, cursor: 'pointer', fontSize: '0.8rem', lineHeight: 1,
  };

  const miniWidth = isMobile ? 'min(58vw, 280px)' : '360px';
  const frameStyle = !mini
    /* Above the holiday effects overlay (9999): no leaves falling across the film. */
    ? { position: 'fixed', inset: 0 }
    : {
      position: 'fixed', width: miniWidth, aspectRatio: '16 / 9', touchAction: 'none', cursor: drag ? 'grabbing' : 'grab',
      boxShadow: '0 6px 24px rgba(0,0,0,0.6)', border: '1px solid var(--border-primary, rgba(255,255,255,0.3))', borderRadius: '4px', overflow: 'hidden',
      ...(drag ? { left: `${drag.x}px`, top: `${drag.y}px` } : {
        [pref.corner[0] === 't' ? 'top' : 'bottom']: pref.corner[0] === 't' ? MINI_INSET.top : MINI_INSET.bottom,
        [pref.corner[1] === 'l' ? 'left' : 'right']: MINI_INSET.side,
      }),
    };

  const picture = error ? (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-orange)', padding: mini ? '8px' : '20px', textAlign: 'center', fontSize: mini ? '0.7rem' : '1rem' }}>
      <div style={{ marginBottom: '12px' }}>{error}</div>
      <button onClick={onLeave} style={mini ? miniButton : smallButton} aria-label="Close the player">{mini ? '✕' : 'CLOSE'}</button>
    </div>
  ) : (
    <video
      ref={videoRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
      preload="metadata"
      playsInline
      onClick={mini ? undefined : tapPicture}
      onLoadedMetadata={handleLoadedMetadata}
      onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime || 0)}
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
      onEnded={() => { setIsPlaying(false); if (isHost) onCommand?.('pause', videoRef.current?.currentTime || 0); }}
      onError={() => { setError('The video could not be loaded. The party may have ended, or the host\'s media server is unreachable.'); setIsLoading(false); }}
    />
  );

  return (
    <div
      ref={containerRef}
      role={mini ? 'region' : 'dialog'}
      aria-label={`Watch party: ${party.name}`}
      style={{ ...frameStyle, background: '#000', zIndex: 10000 }}
      onMouseMove={mini ? undefined : revealControls}
      onTouchStart={mini ? undefined : revealControls}
      onPointerDown={mini ? onMiniPointerDown : undefined}
      onPointerMove={mini ? onMiniPointerMove : undefined}
      onPointerUp={mini ? onMiniPointerUp : undefined}
      onPointerCancel={mini ? () => { dragRef.current = null; setDrag(null); } : undefined}
    >
      {/* One video element for both sizes, so changing size never restarts it. */}
      {picture}

      {isLoading && !error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', pointerEvents: 'none' }}>
          <GlowText color="var(--accent-amber)">Loading…</GlowText>
        </div>
      )}

      {needsTap && !error && (
        <button
          onClick={play}
          style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', border: 'none', color: 'white', fontFamily: 'monospace', fontSize: mini ? '0.75rem' : '1rem', cursor: 'pointer' }}
        >
          ▶ TAP TO JOIN PLAYBACK
        </button>
      )}

      {!isHost && !isLoading && !error && !needsTap && party.state === 'paused' && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.6)', padding: mini ? '4px 8px' : '10px 16px', color: 'white', fontFamily: 'monospace', fontSize: mini ? '0.7rem' : '0.85rem', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          Paused{mini ? '' : ` by ${party.hostName || 'the host'}`}
        </div>
      )}

      {mini ? (
        <>
          <div style={{ position: 'absolute', top: '4px', right: '4px', display: 'flex', gap: '4px' }}>
            {isHost && (
              <button onClick={togglePlay} style={miniButton} aria-label={isPlaying ? 'Pause for everyone' : 'Play for everyone'}>{isPlaying ? '❚❚' : '▶'}</button>
            )}
            <button onClick={() => setPref({ mode: 'full' })} style={miniButton} aria-label="Fill the screen" title="Fill the screen">⤢</button>
            <button onClick={onLeave} style={miniButton} aria-label="Close the player" title={isHost ? 'Close the player; the party goes on' : 'Close the player'}>✕</button>
          </div>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '3px', background: 'rgba(255,255,255,0.2)', pointerEvents: 'none' }}>
            <div style={{ height: '100%', width: `${progressPercent}%`, background: 'var(--accent-amber)' }} />
          </div>
        </>
      ) : (
        /* Over the picture, so the video has the whole screen; fades while playing. */
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.9))',
          padding: isMobile ? '32px 12px calc(16px + env(safe-area-inset-bottom))' : '32px 16px 16px',
          opacity: showControls ? 1 : 0,
          pointerEvents: showControls ? 'auto' : 'none',
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
              <button onClick={() => setPref({ mode: 'mini' })} style={smallButton} title="Shrink to a corner and keep talking">
                CHAT
              </button>
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
            {canPopOut && (
              <button onClick={popOut} style={smallButton} aria-label="Pop out" title="Play in the system's picture-in-picture window">⧉</button>
            )}
            <button onClick={toggleFullscreen} style={smallButton} aria-label="Full screen">⛶</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WatchPartyPlayer;
