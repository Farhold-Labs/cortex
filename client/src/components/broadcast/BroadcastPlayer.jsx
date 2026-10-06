import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Room, RoomEvent, Track, DisconnectReason } from 'livekit-client';
import { API_URL } from '../../config/constants.js';
import { storage } from '../../utils/storage.js';
import { plainText } from '../../utils/plainText.js';

/**
 * Watching a live broadcast (v2.109.0).
 *
 * One component for both doors: a signed-in member (`broadcastId`) and the
 * public link (`publicToken`, no account). Either way the viewer holds a
 * hidden, subscribe-only LiveKit token, so they never appear as a participant
 * and can never send video or sound.
 *
 * Full screen is the browser's real Fullscreen API on the whole player, so our
 * controls stay available and the page chrome goes away. iOS Safari only lets
 * a <video> element go full screen, so that is the fallback there. In the
 * Android app the WebView hands full screen to Capacitor, which supports it.
 */
const BroadcastPlayer = ({ broadcastId = null, publicToken = null }) => {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const roomRef = useRef(null);
  const hideTimer = useRef(null);

  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('connecting'); // connecting | waiting | live | full | ended | unavailable | error
  const [error, setError] = useState('');
  const [needsTap, setNeedsTap] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const fetchJSON = useCallback(async (path, opts = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (!publicToken) headers.Authorization = `Bearer ${storage.getToken()}`;
    const res = await fetch(`${API_URL}${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }, [publicToken]);

  // Connect.
  useEffect(() => {
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const attach = () => {
      let hasVideo = false;
      for (const p of room.remoteParticipants.values()) {
        for (const pub of p.trackPublications.values()) {
          const track = pub.track;
          if (!track) continue;
          if (track.kind === Track.Kind.Video && videoRef.current) { track.attach(videoRef.current); hasVideo = true; }
          if (track.kind === Track.Kind.Audio && audioRef.current) track.attach(audioRef.current);
        }
      }
      setStatus(prev => (prev === 'ended' ? prev : hasVideo ? 'live' : 'waiting'));
    };

    room
      .on(RoomEvent.TrackSubscribed, attach)
      .on(RoomEvent.TrackUnsubscribed, attach)
      .on(RoomEvent.ParticipantDisconnected, attach)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsTap(!room.canPlaybackAudio))
      .on(RoomEvent.Disconnected, (reason) => {
        if (cancelled) return;
        setStatus(reason === DisconnectReason.ROOM_DELETED ? 'ended' : 'error');
        if (reason !== DisconnectReason.ROOM_DELETED) setError('The connection dropped. Reload to rejoin.');
      });

    (async () => {
      try {
        const info = publicToken
          ? await fetchJSON(`/public/broadcasts/${encodeURIComponent(publicToken)}`)
          : await fetchJSON(`/broadcasts/${encodeURIComponent(broadcastId)}`);
        if (!info.res.ok) { if (!cancelled) setStatus('unavailable'); return; }
        if (cancelled) return;
        setTitle(info.data.broadcast?.title || '');
        if (info.data.broadcast?.state === 'ended') { setStatus('ended'); return; }

        const join = publicToken
          ? await fetchJSON(`/public/broadcasts/${encodeURIComponent(publicToken)}/token`, { method: 'POST' })
          : await fetchJSON(`/broadcasts/${encodeURIComponent(broadcastId)}/token`, { method: 'POST' });
        if (cancelled) return;
        if (join.res.status === 429 && join.data.code === 'BROADCAST_FULL') { setStatus('full'); return; }
        if (join.res.status === 410) { setStatus('ended'); return; }
        if (!join.res.ok) { setStatus('error'); setError(join.data.error || 'Could not join'); return; }

        await room.connect(join.data.url, join.data.token, { autoSubscribe: true });
        if (cancelled) { room.disconnect(); return; }
        setNeedsTap(!room.canPlaybackAudio);
        attach();
      } catch (err) {
        if (!cancelled) { setStatus('error'); setError(err.message || 'Could not connect'); }
      }
    })();

    return () => { cancelled = true; room.disconnect(); };
  }, [broadcastId, publicToken, fetchJSON]);

  // Track real full-screen state, whichever way it was entered or left.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    const video = videoRef.current;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
        screen.orientation?.unlock?.();
        return;
      }
      if (el?.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else if (video?.webkitEnterFullscreen) { video.webkitEnterFullscreen(); return; } // iOS Safari
      // A performance is wider than it is tall; on a phone, turn it.
      await screen.orientation?.lock?.('landscape').catch?.(() => {});
    } catch { /* the browser said no; the page still plays */ }
  };

  const enableSound = async () => {
    try { await roomRef.current?.startAudio(); setNeedsTap(false); } catch { /* try again on the next tap */ }
  };

  // Controls fade while watching; any tap or movement brings them back.
  const wake = () => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  };
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const message = {
    connecting: 'Connecting…',
    waiting: 'Waiting for the performance to start…',
    full: 'This broadcast is full right now. Please try again in a few minutes.',
    ended: 'This broadcast has ended. Thanks for watching.',
    unavailable: 'This broadcast is not available.',
    error: error || 'Something went wrong.',
  }[status];

  const overlayButton = {
    padding: '10px 16px', minHeight: 44, fontFamily: 'monospace', fontSize: '0.85rem',
    background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: 6, cursor: 'pointer', letterSpacing: '0.06em',
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={wake}
      onClick={wake}
      onDoubleClick={toggleFullscreen}
      style={{ position: 'fixed', inset: 0, background: '#000', color: '#fff', overflow: 'hidden', fontFamily: 'monospace', zIndex: 5000 }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: status === 'live' ? 'block' : 'none', background: '#000' }}
      />
      <audio ref={audioRef} autoPlay />

      {status !== 'live' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 12 }}>
          {title && <div style={{ fontSize: '1.2rem', color: '#ffd23f' }}>{plainText(title)}</div>}
          <div style={{ color: '#ccc', maxWidth: 480, lineHeight: 1.5 }}>{message}</div>
        </div>
      )}

      {/* Top bar: LIVE badge and title */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, padding: 'calc(12px + env(safe-area-inset-top)) 16px 24px',
        background: 'linear-gradient(rgba(0,0,0,0.6), transparent)', display: 'flex', alignItems: 'center', gap: 10,
        opacity: controlsVisible || status !== 'live' ? 1 : 0, transition: 'opacity 0.4s', pointerEvents: 'none',
      }}>
        {status === 'live' && (
          <span style={{ background: '#e0242b', color: '#fff', padding: '2px 8px', borderRadius: 3, fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.1em' }}>● LIVE</span>
        )}
        <span style={{ fontSize: '0.95rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plainText(title)}</span>
      </div>

      {needsTap && status === 'live' && (
        <button onClick={(e) => { e.stopPropagation(); enableSound(); }}
          style={{ ...overlayButton, position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '1rem', padding: '14px 22px' }}>
          🔊 TAP FOR SOUND
        </button>
      )}

      {/* Bottom bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 16px calc(14px + env(safe-area-inset-bottom))',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.6))', display: 'flex', justifyContent: 'flex-end', gap: 10,
        opacity: controlsVisible || status !== 'live' ? 1 : 0, transition: 'opacity 0.4s',
      }}>
        {status === 'live' && (
          <button onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }} style={overlayButton} aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}>
            {isFullscreen ? '⤡ EXIT FULL SCREEN' : '⛶ FULL SCREEN'}
          </button>
        )}
        {!publicToken && (
          <button onClick={(e) => { e.stopPropagation(); window.location.href = '/'; }} style={overlayButton}>✕ CLOSE</button>
        )}
      </div>
    </div>
  );
};

export default BroadcastPlayer;
