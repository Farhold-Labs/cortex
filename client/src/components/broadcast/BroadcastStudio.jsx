import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Room, RoomEvent, Track, createLocalTracks, VideoPresets, AudioPresets } from 'livekit-client';
import { API_URL } from '../../config/constants.js';
import { storage } from '../../utils/storage.js';
import { plainText } from '../../utils/plainText.js';

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
      video: { facingMode: face, resolution: VideoPresets.h720.resolution },
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
  }, []);

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

  const toggleMic = async () => { const a = tracksRef.current.audio; if (!a) return; if (micOn) await a.mute(); else await a.unmute(); setMicOn(!micOn); };
  const toggleCam = async () => { const v = tracksRef.current.video; if (!v) return; if (camOn) await v.mute(); else await v.unmute(); setCamOn(!camOn); };
  const flipCamera = async () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    try { await tracksRef.current.video?.restartTrack({ facingMode: next, resolution: VideoPresets.h720.resolution }); setFacing(next); } catch { /* only one camera */ }
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
    try { await api(`/broadcasts/${encodeURIComponent(broadcastId)}/end`, { method: 'POST' }); setStatus('ended'); roomRef.current?.disconnect(); }
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', color: '#fff', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'calc(10px + env(safe-area-inset-top)) 14px 10px', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,0,0,0.7)' }}>
        <span style={{ background: status === 'live' ? '#e0242b' : '#555', padding: '2px 8px', borderRadius: 3, fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.1em' }}>
          {status === 'live' ? '● LIVE' : 'STARTING…'}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plainText(broadcast?.title || '')}</span>
        {broadcast?.recordingStatus === 'recording' && (
          <span title="This broadcast is being recorded" style={{ color: '#ff4d4d', fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.08em' }}>● REC</span>
        )}
        {viewers !== null && <span style={{ fontSize: '0.8rem', color: '#ccc' }}>👁 {viewers}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <video ref={previewRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'contain', transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
        {!camOn && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa' }}>Camera off — viewers see a black screen</div>}
      </div>

      <div style={{ padding: '10px 14px calc(12px + env(safe-area-inset-bottom))', background: 'rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {error && <div role="alert" style={{ color: '#ff6b35', fontSize: '0.8rem' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={toggleMic} style={btn(micOn)}>{micOn ? '🎙 MIC ON' : '🔇 MIC OFF'}</button>
          <button onClick={toggleCam} style={btn(camOn)}>{camOn ? '📷 CAMERA ON' : '🚫 CAMERA OFF'}</button>
          <button onClick={flipCamera} style={btn()}>🔄 FLIP</button>
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
