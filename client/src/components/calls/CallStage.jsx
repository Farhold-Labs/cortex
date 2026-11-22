import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTracks, useParticipants, useSpeakingParticipants, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Avatar } from '../ui/SimpleComponents.jsx';
import { chooseCallLayout, fitFor } from '../../utils/callLayout.js';

// The call's video (v2.144.0): the other person fills the space, you are a
// small preview in the lower right, anyone else is a strip of thumbnails.
// Tap a thumbnail or your preview to fill the screen with it; tap the big
// picture to go back. Rules in utils/callLayout.js. Must be inside a
// LiveKitRoom.

const SOURCES = [
  { source: Track.Source.Camera, withPlaceholder: false },
  { source: Track.Source.ScreenShare, withPlaceholder: false },
];

const isLive = (ref) => {
  const pub = ref.publication;
  return Boolean(pub?.track && !pub.isMuted && (ref.participant?.isLocal || pub.isSubscribed));
};

/** Calls onChange(true|false) as any video starts or stops. Renders nothing. */
export function VideoPresence({ onChange }) {
  const tracks = useTracks(SOURCES);
  const has = tracks.some(isLive);
  useEffect(() => { onChange?.(has); }, [has, onChange]);
  return null;
}

function useBoxSize(ref) {
  const [size, setSize] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(prev => (prev && prev.w === width && prev.h === height) ? prev : { w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function StageVideo({ trackRef, box, fit, mirror, fill }) {
  const ref = useRef(null);
  const [dims, setDims] = useState(null);
  const sid = trackRef.publication?.trackSid;
  useEffect(() => {
    const v = ref.current;
    if (!v) return undefined;
    const read = () => { if (v.videoWidth) setDims({ w: v.videoWidth, h: v.videoHeight }); };
    v.addEventListener('loadedmetadata', read);
    v.addEventListener('resize', read); // a phone turned on its side
    read();
    return () => { v.removeEventListener('loadedmetadata', read); v.removeEventListener('resize', read); };
  }, [sid]);
  const isScreen = trackRef.source === Track.Source.ScreenShare;
  return (
    <VideoTrack
      ref={ref}
      trackRef={trackRef}
      muted
      playsInline
      data-call-video=""
      style={{
        width: '100%', height: '100%', display: 'block', background: '#000',
        // A variable, because index.html forces LiveKit videos to `contain`
        // with !important; [data-call-stage] [data-call-video] applies it.
        '--call-fit': fit || fitFor(dims, box, isScreen, { fill }),
        transform: mirror ? 'scaleX(-1)' : undefined,
      }}
    />
  );
}

const nameOf = (p) => p?.name || p?.identity || 'Someone';

const labelStyle = {
  position: 'absolute', left: 8, top: 8, maxWidth: 'calc(100% - 16px)',
  background: 'rgba(0,0,0,0.55)', color: '#fff', padding: '3px 8px', borderRadius: 4,
  fontSize: '0.75rem', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  pointerEvents: 'none',
};

export default function CallStage({ isMobile }) {
  const boxRef = useRef(null);
  const box = useBoxSize(boxRef);
  const refs = useTracks(SOURCES).filter(isLive);
  const participants = useParticipants();
  const speaking = useSpeakingParticipants();
  const [pinnedId, setPinnedId] = useState(null);

  // The last person to speak who has a camera keeps the screen until someone
  // else with a camera speaks; silence doesn't hand it back and forth.
  const [speakerId, setSpeakerId] = useState(null);
  const cameraOwners = useMemo(() => new Set(refs.filter(r => !r.participant.isLocal && r.source === Track.Source.Camera).map(r => r.participant.identity)), [refs]);
  useEffect(() => {
    const s = speaking.find(p => !p.isLocal && cameraOwners.has(p.identity));
    if (s && s.identity !== speakerId) setSpeakerId(s.identity);
  }, [speaking, cameraOwners, speakerId]);

  const byId = new Map(refs.map(r => [r.publication.trackSid, r]));
  const tracks = refs.map(r => ({
    id: r.publication.trackSid,
    participantId: r.participant.identity,
    isLocal: r.participant.isLocal,
    isScreen: r.source === Track.Source.ScreenShare,
  }));
  const others = participants.filter(p => !p.isLocal).map(p => ({ participantId: p.identity, name: nameOf(p) }));
  // A pinned track that has gone (camera off, person left) is forgotten.
  const pin = pinnedId && byId.has(pinnedId) ? pinnedId : null;
  const { main, mainPerson, pip, strip } = chooseCallLayout(tracks, { pinnedId: pin, speakerId, others });
  const mainRef = main && byId.get(main.id);
  const pipRef = pip && byId.get(pip.id);

  const pipWidth = isMobile ? Math.round(Math.min(140, Math.max(96, (box?.w || 390) * 0.28))) : Math.round(Math.min(260, Math.max(150, (box?.w || 900) * 0.2)));
  const thumb = isMobile ? { w: 72, h: 96 } : { w: 128, h: 72 };

  return (
    <div ref={boxRef} data-call-stage="" style={{ position: 'relative', flex: 1, minHeight: 0, width: '100%', background: '#000', overflow: 'hidden' }}>
      {mainRef ? (
        <div
          style={{ position: 'absolute', inset: 0, cursor: pin ? 'pointer' : 'default' }}
          onClick={pin ? () => setPinnedId(null) : undefined}
          title={pin ? 'Tap to go back' : undefined}
        >
          <StageVideo trackRef={mainRef} box={box} fill={isMobile} mirror={main.isLocal && !main.isScreen} />
          <div style={labelStyle}>
            {main.isScreen ? '🖥️ ' : ''}{main.isLocal ? 'You' : nameOf(mainRef.participant)}{main.isScreen ? '’s screen' : ''}
          </div>
        </div>
      ) : mainPerson ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16, textAlign: 'center' }}>
          <Avatar letter={(mainPerson.name || '?')[0].toUpperCase()} size={isMobile ? 96 : 120} />
          <div style={{ color: 'var(--text-primary)', fontSize: '1.1rem' }}>{mainPerson.name}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            {others.length > 1 ? `${others.length} others here, cameras off` : 'Camera off'}
          </div>
        </div>
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', padding: 16, textAlign: 'center' }}>
          Waiting for others to join…
        </div>
      )}

      {strip.length > 0 && (
        <div style={{
          position: 'absolute', left: 8, bottom: 8, right: pipRef ? pipWidth + 20 : 8,
          display: 'flex', gap: 6, overflowX: 'auto', overflowY: 'hidden',
        }}>
          {strip.map(t => {
            const r = byId.get(t.id);
            return (
              <div
                key={t.id}
                onClick={() => setPinnedId(t.id)}
                title={`${t.isLocal ? 'You' : nameOf(r.participant)}${t.isScreen ? ' (screen)' : ''} — tap to fill the screen`}
                style={{ position: 'relative', flexShrink: 0, width: thumb.w, height: thumb.h, borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.35)', cursor: 'pointer', background: '#000' }}
              >
                <StageVideo trackRef={r} fit={t.isScreen ? 'contain' : 'cover'} mirror={t.isLocal && !t.isScreen} />
                <div style={{ ...labelStyle, top: 'auto', bottom: 2, left: 2, fontSize: '0.6rem', padding: '1px 4px' }}>
                  {t.isScreen ? '🖥️ ' : ''}{t.isLocal ? 'You' : nameOf(r.participant)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pipRef && (
        <div
          onClick={() => setPinnedId(pip.id)}
          title="You — tap to fill the screen"
          style={{
            position: 'absolute', right: 12, bottom: 12, width: pipWidth,
            aspectRatio: isMobile ? '3 / 4' : '16 / 9',
            borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: '#000',
            border: '1px solid rgba(255,255,255,0.5)', boxShadow: '0 2px 10px rgba(0,0,0,0.6)',
          }}
        >
          <StageVideo trackRef={pipRef} fit="cover" mirror />
        </div>
      )}
    </div>
  );
}
