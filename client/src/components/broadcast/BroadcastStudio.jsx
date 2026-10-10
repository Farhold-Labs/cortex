import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Room, RoomEvent, Track, createLocalTracks, VideoPresets, AudioPresets } from 'livekit-client';
import { API_URL } from '../../config/constants.js';
import { storage } from '../../utils/storage.js';
import { plainText } from '../../utils/plainText.js';
import { canLockOrientation, lockOrientation, unlockOrientation } from '../../utils/orientation.js';

/**
 * The performer's side of a live broadcast (v2.109.0).
 *
 * Holds the only publishing token for the broadcast's room. "Music mode" is
 * on by default: browsers tune microphones for speech — echo cancellation,
 * noise suppression and automatic gain — and those treat sustained notes,
 * applause and a room's natural sound as noise to remove. For a performance
 * they are switched off and the audio is sent as high-quality stereo.
 *
 * Leaving this page does not end the broadcast; only "End broadcast" does, so
 * a dropped connection or an accidental back-swipe can be recovered by opening
 * the page again.
 */
const BroadcastStudio = ({ broadcastId }) => {
  const previewRef = useRef(null);
  const roomRef = useRef(null);
  const tracksRef = useRef({ video: null, audio: null });
  const wakeLockRef = useRef(null);

  const [broadcast, setBroadcast] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | live | ended | error | notPerformer
  const [error, setError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facing, setFacing] = useState('environment'); // the stage, not the performer's face
  const [musicMode, setMusicMode] = useState(true);
  const [viewers, setViewers] = useState(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canRecord, setCanRecord] = useState(false);
  // v2.113.0 — sideways filming and camera zoom.
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight);
  const [rotateBusy, setRotateBusy] = useState(false);
  const [zoomRange, setZoomRange] = useState(null); // { min, max, step } when the camera can zoom
  const [zoom, setZoom] = useState(1);
  const pinchRef = useRef(null);

  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storage.getToken()}` },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
    return data;
  }, []);

  const audioOptions = (music) => (music
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 }
    : { echoCancellation: true, noiseSuppression: true, autoGainControl: true });

  const publish = useCallback(async (room, { music, face }) => {
    const [video, audio] = await createLocalTracks({
      // zoom: true asks for the camera's zoom control where the browser has one.
      video: { facingMode: face, resolution: VideoPresets.h720.resolution, zoom: true },
      audio: audioOptions(music),
    }).then(ts => [ts.find(t => t.kind === Track.Kind.Video), ts.find(t => t.kind === Track.Kind.Audio)]);
    if (video) {
      await room.localParticipant.publishTrack(video, { simulcast: true, videoEncoding: VideoPresets.h720.encoding });
      if (previewRef.current) video.attach(previewRef.current);
    }
    if (audio) {
      await room.localParticipant.publishTrack(audio, music
        ? { audioPreset: AudioPresets.musicHighQualityStereo, dtx: false, red: true, forceStereo: true }
        : {});
    }
    tracksRef.current = { video, audio };
    readZoom();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    const room = new Room({ adaptiveStream: false, dynacast: true });
    roomRef.current = room;
    room.on(RoomEvent.Disconnected, () => { if (!cancelled) setStatus(s => (s === 'ended' ? s : 'error')); });

    (async () => {
      try {
        const info = await api(`/broadcasts/${encodeURIComponent(broadcastId)}`);
        if (cancelled) return;
        setBroadcast(info.broadcast);
        if (info.broadcast.state === 'ended') { setStatus('ended'); return; }
        if (!info.isPerformer) { setStatus('notPerformer'); return; }
        const join = await api(`/broadcasts/${encodeURIComponent(broadcastId)}/token`, { method: 'POST' });
        if (cancelled) return;
        await room.connect(join.url, join.token);
        await publish(room, { music: true, face: 'environment' });
        if (cancelled) { room.disconnect(); return; }
        setStatus('live');
        // v2.110.0 — start recording now the camera is up, so the file does
        // not open on black. Idempotent: reopening the studio after a dropped
        // connection leaves a running recording alone.
        api('/broadcast-capabilities').then(d => { if (!cancelled) setCanRecord(!!d.recording); }).catch(() => {});
        if (info.broadcast.record) startRecording();
        try { wakeLockRef.current = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
      } catch (err) {
        if (!cancelled) { setStatus('error'); setError(err.name === 'NotAllowedError' ? 'Camera or microphone permission was refused.' : (err.message || 'Could not start')); }
      }
    })();

    return () => {
      cancelled = true;
      wakeLockRef.current?.release?.().catch(() => {});
      room.disconnect();
    };
  }, [broadcastId, api, publish]);

  // Audience count, for the performer.
  useEffect(() => {
    if (status !== 'live') return;
    const poll = () => api(`/broadcasts/${encodeURIComponent(broadcastId)}/audience`).then(d => setViewers(d.viewers)).catch(() => {});
    poll();
    const t = setInterval(poll, 10000);
    return () => clearInterval(t);
  }, [status, broadcastId, api]);

  // ---- Zoom: the camera's own optical/digital zoom, where it has one ----
  function readZoom() {
    const mst = tracksRef.current.video?.mediaStreamTrack;
    const caps = mst?.getCapabilities?.();
    if (caps?.zoom && caps.zoom.max > caps.zoom.min) {
      setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
      setZoom(mst.getSettings?.().zoom ?? caps.zoom.min);
    } else {
      setZoomRange(null);
    }
  }
  const applyZoom = useCallback((value) => {
    const mst = tracksRef.current.video?.mediaStreamTrack;
    if (!mst || !zoomRange) return;
    const z = Math.min(zoomRange.max, Math.max(zoomRange.min, value));
    setZoom(z);
    mst.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {});
  }, [zoomRange]);
  // Pinch on the preview zooms the camera, as in a camera app.
  const onTouchStart = (e) => {
    if (e.touches.length !== 2 || !zoomRange) return;
    const [a, b] = e.touches;
    pinchRef.current = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom };
  };
  const onTouchMove = (e) => {
    if (e.touches.length !== 2 || !pinchRef.current) return;
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    applyZoom(pinchRef.current.zoom * (dist / pinchRef.current.dist));
  };
  const onTouchEnd = () => { pinchRef.current = null; };

  // ---- Rotation ----
  useEffect(() => {
    const onResize = () => setLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      unlockOrientation(); // leaving the studio hands rotation back to the phone
    };
  }, []);
  const rotate = async () => {
    setRotateBusy(true);
    const ok = await lockOrientation(landscape ? 'portrait' : 'landscape');
    if (!ok) setError('This device would not rotate. Turn on auto-rotate in your phone settings and turn the phone.');
    setRotateBusy(false);
  };

  const toggleMic = async () => { const a = tracksRef.current.audio; if (!a) return; if (micOn) await a.mute(); else await a.unmute(); setMicOn(!micOn); };
  const toggleCam = async () => { const v = tracksRef.current.video; if (!v) return; if (camOn) await v.mute(); else await v.unmute(); setCamOn(!camOn); };
  const flipCamera = async () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    try { await tracksRef.current.video?.restartTrack({ facingMode: next, resolution: VideoPresets.h720.resolution, zoom: true }); setFacing(next); readZoom(); } catch { /* only one camera */ }
  };
  const toggleMusicMode = async () => {
    const next = !musicMode;
    const room = roomRef.current;
    const old = tracksRef.current.audio;
    try {
      if (old) { await room.localParticipant.unpublishTrack(old); old.stop(); }
      const [audio] = await createLocalTracks({ audio: audioOptions(next) });
      await room.localParticipant.publishTrack(audio, next
        ? { audioPreset: AudioPresets.musicHighQualityStereo, dtx: false, red: true, forceStereo: true } : {});
      if (!micOn) await audio.mute();
      tracksRef.current.audio = audio;
      setMusicMode(next);
    } catch (err) { setError(err.message); }
  };

  const startRecording = async () => {
    try { const d = await api(`/broadcasts/${encodeURIComponent(broadcastId)}/recording/start`, { method: 'POST' }); setBroadcast(d.broadcast); }
    catch (err) { setError(err.message); }
  };

  const setPublic = async (enabled) => {
    try { const d = await api(`/broadcasts/${encodeURIComponent(broadcastId)}/public-link`, { method: 'POST', body: { enabled } }); setBroadcast(d.broadcast); }
    catch (err) { setError(err.message); }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(broadcast.publicLink); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select it manually */ }
  };
  const endBroadcast = async () => {
    try { await api(`/broadcasts/${encodeURIComponent(broadcastId)}/end`, { method: 'POST' }); setStatus('ended'); roomRef.current?.disconnect(); unlockOrientation(); }
    catch (err) { setError(err.message); }
  };

  const btn = (active = true, danger = false) => ({
    padding: '10px 14px', minHeight: 44, fontFamily: 'monospace', fontSize: '0.8rem', cursor: 'pointer', borderRadius: 4,
    background: danger ? '#e0242b' : active ? 'var(--bg-elevated, #0d150d)' : 'var(--bg-hover, #1a2a1a)',
    color: danger ? '#fff' : 'var(--text-primary, #d5e5d5)', border: `1px solid ${danger ? '#e0242b' : 'var(--border-primary, #3a4a3a)'}`,
  });

  if (status === 'ended' || status === 'error' || status === 'notPerformer') {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--bg-base, #050805)', color: 'var(--text-primary, #d5e5d5)', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div>
          <div style={{ color: 'var(--accent-amber, #ffd23f)', marginBottom: 12 }}>{plainText(broadcast?.title || 'Broadcast')}</div>
          <p>{status === 'ended' ? 'The broadcast has ended.' : status === 'notPerformer' ? 'Only the performer broadcasts from this page.' : (error || 'Something went wrong.')}</p>
          {status === 'notPerformer' && <p><a href={`/watch/${broadcastId}`} style={{ color: 'var(--accent-amber, #ffd23f)' }}>Watch it instead</a></p>}
          <p><a href="/" style={{ color: 'var(--accent-amber, #ffd23f)' }}>← Back to Cortex</a></p>
        </div>
      </div>
    );
  }

  // A phone on its side: controls move to a column on the right so the
  // preview keeps the full height instead of a letterbox above a tall panel.
  const sideways = landscape && window.innerHeight < 600;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', color: '#fff', fontFamily: 'monospace', display: 'flex', flexDirection: sideways ? 'row' : 'column' }}>
     <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: `calc(${sideways ? 6 : 10}px + env(safe-area-inset-top)) 14px ${sideways ? 6 : 10}px calc(14px + env(safe-area-inset-left))`, display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.7)' }}>
        <span style={{ background: status === 'live' ? '#e0242b' : '#555', padding: '2px 8px', borderRadius: 3, fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.1em' }}>
          {status === 'live' ? '● LIVE' : 'STARTING…'}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plainText(broadcast?.title || '')}</span>
        {broadcast?.recordingStatus === 'recording' && (
          <span title="This broadcast is being recorded" style={{ color: '#ff4d4d', fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.08em' }}>● REC</span>
        )}
        {viewers !== null && <span style={{ fontSize: '0.8rem', color: '#ccc' }}>👁 {viewers}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative', touchAction: zoomRange ? 'none' : 'auto' }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        <video ref={previewRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain', transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
        {!camOn && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>Camera off — viewers see a black screen</div>}
        {zoomRange && (
          <div style={{ position: 'absolute', left: '50%', bottom: 10, transform: 'translateX(-50%)', width: 'min(320px, 80%)', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 20, background: 'rgba(0,0,0,0.55)' }}>
            <span style={{ fontSize: '0.75rem' }} aria-hidden="true">🔍</span>
            <input type="range" aria-label="Camera zoom" min={zoomRange.min} max={zoomRange.max} step={zoomRange.step} value={zoom}
              onChange={(e) => applyZoom(parseFloat(e.target.value))} style={{ flex: 1 }} />
            <span style={{ fontSize: '0.75rem', minWidth: 38, textAlign: 'right' }}>{zoom.toFixed(1)}×</span>
          </div>
        )}
      </div>
     </div>

      <div style={{
        padding: sideways ? 'calc(8px + env(safe-area-inset-top)) calc(10px + env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) 10px' : '10px 14px calc(12px + env(safe-area-inset-bottom))',
        background: 'rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', gap: 10,
        ...(sideways ? { width: 250, flexShrink: 0, overflowY: 'auto' } : {}),
      }}>
        {error && <div role="alert" style={{ color: '#ff6b35', fontSize: '0.8rem' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={toggleMic} style={btn(micOn)}>{micOn ? '🎙 MIC ON' : '🔇 MIC OFF'}</button>
          <button onClick={toggleCam} style={btn(camOn)}>{camOn ? '📷 CAMERA ON' : '🚫 CAMERA OFF'}</button>
          <button onClick={flipCamera} style={btn()}>🔄 FLIP</button>
          {canLockOrientation() && (
            <button onClick={rotate} disabled={rotateBusy} style={btn()} title="Turn the screen — works even with auto-rotate off">
              {landscape ? '▯ PORTRAIT' : '▭ LANDSCAPE'}
            </button>
          )}
          <button onClick={toggleMusicMode} style={btn(musicMode)} title="Turns off the speech filters that damage music and stage sound">
            {musicMode ? '🎵 MUSIC MODE ON' : '🗣 SPEECH MODE'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem' }}>
          {broadcast?.publicEnabled && broadcast?.publicLink ? (
            <>
              <span style={{ color: '#ccc' }}>Public link:</span>
              <code style={{ background: '#111', padding: '4px 6px', borderRadius: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{broadcast.publicLink}</code>
              <button onClick={copyLink} style={btn()}>{copied ? '✓ COPIED' : 'COPY'}</button>
              <button onClick={() => setPublic(false)} style={btn()}>TURN OFF</button>
            </>
          ) : (
            <button onClick={() => setPublic(true)} style={btn()}>🌐 OPEN A PUBLIC LINK</button>
          )}
          {canRecord && status === 'live' && broadcast && ['none', 'failed'].includes(broadcast.recordingStatus) && (
            <button onClick={startRecording} style={btn()}>
              {broadcast.recordingStatus === 'failed' ? '● RECORDING FAILED — RETRY' : '● START RECORDING'}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {confirmEnd ? (
            <>
              <span style={{ fontSize: '0.8rem' }}>End the broadcast for everyone?</span>
              <button onClick={endBroadcast} style={btn(true, true)}>YES, END IT</button>
              <button onClick={() => setConfirmEnd(false)} style={btn()}>KEEP GOING</button>
            </>
          ) : (
            <button onClick={() => setConfirmEnd(true)} style={btn(true, true)}>■ END BROADCAST</button>
          )}
          <span style={{ fontSize: '0.7rem', color: '#999' }}>Closing this page does not end it — open it again to carry on.</span>
        </div>
      </div>
    </div>
  );
};

export default BroadcastStudio;
