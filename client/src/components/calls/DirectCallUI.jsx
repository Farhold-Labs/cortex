import React, { useEffect, useState } from 'react';
import { Avatar } from '../ui/SimpleComponents.jsx';

// Direct calls (v2.145.0): the incoming call screen, the ring, the call-back
// bar after a reload, and the call history. docs/direct-calls/.

/**
 * A telephone ring made in the browser: 440 + 480 Hz, two seconds on and four
 * off (the North American ring). `incoming` rings out loud and vibrates;
 * otherwise it is the quieter ringback a caller hears while it rings.
 * Browsers only let a page make sound once it has been touched; the ring
 * screen's buttons and the vibration still work when it can't.
 */
export function useRingTone(active, { incoming = false } = {}) {
  useEffect(() => {
    if (!active) return undefined;
    let ctx = null;
    let stopped = false;
    const timers = [];
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = AC ? new AC() : null;
    } catch { ctx = null; }
    const burst = () => {
      if (stopped) return;
      if (ctx) {
        try {
          ctx.resume?.();
          const gain = ctx.createGain();
          gain.gain.value = 0;
          gain.connect(ctx.destination);
          const t = ctx.currentTime;
          const level = incoming ? 0.18 : 0.05;
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(level, t + 0.05);
          gain.gain.setValueAtTime(level, t + 1.95);
          gain.gain.linearRampToValueAtTime(0, t + 2);
          for (const f of [440, 480]) {
            const osc = ctx.createOscillator();
            osc.frequency.value = f;
            osc.connect(gain);
            osc.start(t);
            osc.stop(t + 2.05);
          }
        } catch { /* no sound this time */ }
      }
      if (incoming && navigator.vibrate) navigator.vibrate([600, 300, 600]);
      timers.push(setTimeout(burst, 6000));
    };
    burst();
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      if (incoming && navigator.vibrate) navigator.vibrate(0);
      ctx?.close?.().catch?.(() => {});
    };
  }, [active, incoming]);
}

const bigButton = (bg) => ({
  minWidth: 120, minHeight: 56, padding: '12px 20px', borderRadius: 28,
  border: 'none', background: bg, color: '#fff', cursor: 'pointer',
  fontFamily: 'monospace', fontSize: '1rem', fontWeight: 'bold',
});

/** Someone is calling: the whole screen, over everything, until answered or gone. */
export function IncomingCallScreen({ call, onAnswer, onDecline }) {
  useRingTone(Boolean(call), { incoming: true });
  if (!call) return null;
  const person = call.other || {};
  const video = call.kind === 'video';
  return (
    <div role="dialog" aria-label={`${person.displayName} is calling`} data-incoming-call="" style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'var(--bg-base)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between',
      padding: '48px 16px calc(40px + env(safe-area-inset-bottom, 0px))', textAlign: 'center',
    }}>
      <div style={{ color: 'var(--text-dim)', fontFamily: 'monospace', letterSpacing: 2, fontSize: '0.85rem' }}>
        INCOMING {video ? 'VIDEO' : 'VOICE'} CALL
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <Avatar letter={(person.displayName || '?')[0].toUpperCase()} imageUrl={person.avatarUrl} size={120} />
        <div style={{ color: 'var(--text-primary)', fontSize: '1.6rem' }}>{person.displayName}</div>
        {person.handle && <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>@{person.handle}</div>}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button style={bigButton('#c0392b')} onClick={onDecline}>✕ Decline</button>
        {video && <button style={bigButton('#2c6e49')} onClick={() => onAnswer(false)} title="Answer without your camera">🎤 Voice</button>}
        <button style={bigButton('#0ead69')} onClick={() => onAnswer(video)}>{video ? '🎥 Answer' : '📞 Answer'}</button>
      </div>
    </div>
  );
}

/** After a reload in the middle of a call: back in, or hang up. */
export function InterruptedCallBar({ call, onRejoin, onEnd }) {
  if (!call) return null;
  return (
    <div style={{
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1600,
      padding: '10px 12px calc(10px + env(safe-area-inset-bottom, 0px))',
      background: 'var(--bg-hover)', borderTop: '1px solid var(--accent-green)',
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontFamily: 'monospace',
    }}>
      <span style={{ color: 'var(--accent-green)', flex: 1, minWidth: 160 }}>📞 Call with {call.other?.displayName} is still going</span>
      <button style={{ ...bigButton('#0ead69'), minWidth: 0, minHeight: 40, padding: '8px 14px', fontSize: '0.85rem' }} onClick={onRejoin}>Rejoin</button>
      <button style={{ ...bigButton('#c0392b'), minWidth: 0, minHeight: 40, padding: '8px 14px', fontSize: '0.85rem' }} onClick={onEnd}>Hang up</button>
    </div>
  );
}

const STATE_LABEL = {
  incoming: { answered: 'Incoming', ended: 'Incoming', declined: 'Declined', missed: 'Missed', cancelled: 'Missed', busy: 'Missed', ringing: 'Ringing' },
  outgoing: { answered: 'Outgoing', ended: 'Outgoing', declined: 'Declined', missed: 'No answer', cancelled: 'Cancelled', busy: 'Busy', ringing: 'Ringing' },
};

export const isMissedCall = (c) => c.direction === 'incoming' && ['missed', 'cancelled', 'busy'].includes(c.state);

function when(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

const duration = (s) => (s == null ? '' : ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/** Calls made and received, newest first. Tap to call back. */
export function CallHistory({ fetchAPI, onCall, contacts = [], isMobile, refreshKey = 0 }) {
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchAPI('/calls')
      .then(d => { if (!cancelled) setCalls(d.calls || []); })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not load calls'); });
    return () => { cancelled = true; };
  }, [fetchAPI, refreshKey]);

  if (error) return <div style={{ padding: 20, color: 'var(--accent-orange)' }}>{error}</div>;
  if (!calls) return <div style={{ padding: 20, color: 'var(--text-dim)' }}>Loading…</div>;
  const canCall = (id) => contacts.some(c => c.id === id && c.mutual);
  return (
    <div style={{ flex: 1, padding: isMobile ? 16 : 20, overflowY: 'auto' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: 12 }}>RECENT CALLS</div>
      {calls.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          No calls yet. Tap a contact in CONTACTS, then CALL or VIDEO CALL.
        </div>
      )}
      {calls.map(c => {
        const missed = isMissedCall(c);
        const label = STATE_LABEL[c.direction]?.[c.state] || c.state;
        const arrow = c.direction === 'outgoing' ? '↗' : '↙';
        return (
          <div key={c.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <Avatar letter={(c.other?.displayName || '?')[0].toUpperCase()} imageUrl={c.other?.avatarUrl} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: missed ? 'var(--accent-orange)' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {c.other?.displayName}
              </div>
              <div style={{ color: missed ? 'var(--accent-orange)' : 'var(--text-dim)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                {arrow} {c.kind === 'video' ? '🎥' : '📞'} {label}{duration(c.durationSeconds)} · {when(c.createdAt)}
              </div>
            </div>
            {canCall(c.other?.id) && (
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => onCall(c.other, 'audio')} title={`Voice call ${c.other?.displayName}`} aria-label="Voice call" style={callButtonStyle(isMobile)}>📞</button>
                <button onClick={() => onCall(c.other, 'video')} title={`Video call ${c.other?.displayName}`} aria-label="Video call" style={callButtonStyle(isMobile)}>🎥</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const callButtonStyle = (isMobile) => ({
  padding: isMobile ? '10px 12px' : '6px 10px',
  minHeight: isMobile ? 44 : 'auto',
  background: 'transparent', border: '1px solid var(--accent-green)',
  color: 'var(--accent-green)', cursor: 'pointer', fontSize: '0.9rem', flexShrink: 0,
});

/** The ringback a caller hears while it rings. Renders nothing. */
export function RingbackTone({ active }) {
  useRingTone(active);
  return null;
}
