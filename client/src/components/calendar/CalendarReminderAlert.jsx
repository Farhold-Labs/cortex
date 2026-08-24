import React, { useEffect, useState, useCallback } from 'react';

// Event reminders escalate as the event approaches (v2.71.0). A day out, a
// corner card is enough. Fifteen minutes out, a corner card is easy to miss
// entirely — so the closer ones take the centre of the screen, count down live,
// and keep a pulse going until they are dismissed.

const WINDOW_LABELS = {
  '1day':  'Tomorrow',
  '1hour': 'In 1 hour',
  '30min': 'In 30 minutes',
  '15min': 'In 15 minutes',
  'login': 'Starting soon',
};

// Which windows take over the screen rather than sitting in the corner.
const URGENT_WINDOWS = new Set(['30min', '15min', 'login']);

const reducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const eventMsOf = (date, time) =>
  (date && time) ? new Date(`${date}T${time}:00`).getTime() : null;

const fmt12 = (t) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
};

// "14m 03s" close in, "3h 20m" further out — seconds only matter when they do.
const countdown = (ms) => {
  if (ms === null) return null;
  if (ms <= 0) return 'NOW';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m >= 10) return `${m} min`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
};

const KEYFRAMES = `
@keyframes cortexReminderPulse {
  0%, 100% { box-shadow: 0 0 22px rgba(255,107,53,0.35), 0 6px 22px rgba(0,0,0,0.7); }
  50%      { box-shadow: 0 0 46px rgba(255,107,53,0.75), 0 6px 22px rgba(0,0,0,0.7); }
}
@keyframes cortexReminderDrop {
  from { transform: translateY(-14px); opacity: 0; }
  to   { transform: translateY(0);     opacity: 1; }
}
@keyframes cortexReminderSweep {
  from { transform: translateY(-100%); }
  to   { transform: translateY(400%); }
}
`;

const btn = (color) => ({
  padding: '8px 14px',
  minHeight: 36,
  background: 'transparent',
  border: `1px solid ${color}`,
  color,
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
});

const CalendarReminderAlert = ({ reminders, onDismiss, onOpen }) => {
  const [, setTick] = useState(0);

  // One timer for the whole component. A second is only worth spending when
  // something urgent is on screen; otherwise a slow tick keeps "3h 20m" honest.
  const hasUrgent = reminders.some(r => URGENT_WINDOWS.has(r.window));
  useEffect(() => {
    if (reminders.length === 0) return undefined;
    const id = setInterval(() => setTick(t => t + 1), hasUrgent ? 1000 : 30000);
    return () => clearInterval(id);
  }, [reminders.length, hasUrgent]);

  const still = useCallback((r) => countdown(
    eventMsOf(r.eventDate, r.eventTime) === null
      ? null
      : eventMsOf(r.eventDate, r.eventTime) - Date.now()
  ), []);

  if (reminders.length === 0) return null;

  const calm = reducedMotion();
  const urgent = reminders.filter(r => URGENT_WINDOWS.has(r.window));
  const ambient = reminders.filter(r => !URGENT_WINDOWS.has(r.window));

  const Actions = ({ r, color }) => (
    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      {r.waveId && onOpen && (
        <button onClick={() => onOpen(r)} style={btn(color)}>Open wave</button>
      )}
      <button onClick={() => onDismiss(r.id)} style={btn('var(--text-dim, #8aa08a)')}>Dismiss</button>
    </div>
  );

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* Imminent: centre stage, pulsing, live seconds. */}
      {urgent.length > 0 && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9500,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 10, padding: '18px 12px 0', pointerEvents: 'none',
        }}>
          {urgent.map(r => (
            <div key={r.id} style={{
              pointerEvents: 'auto',
              position: 'relative', overflow: 'hidden',
              width: 'min(560px, 100%)',
              background: 'var(--bg-elevated, #0d160d)',
              border: '2px solid var(--accent-orange, #ff6b35)',
              padding: '18px 20px',
              fontFamily: 'monospace',
              animation: calm ? 'none' : 'cortexReminderDrop 0.25s ease-out, cortexReminderPulse 2s ease-in-out infinite',
              boxShadow: calm ? '0 6px 22px rgba(0,0,0,0.7)' : undefined,
            }}>
              {/* CRT sweep — decorative, and the first thing dropped for reduced motion. */}
              {!calm && (
                <div aria-hidden="true" style={{
                  position: 'absolute', left: 0, right: 0, height: '28%', top: 0,
                  background: 'linear-gradient(180deg, transparent, rgba(255,107,53,0.10), transparent)',
                  animation: 'cortexReminderSweep 3.2s linear infinite',
                  pointerEvents: 'none',
                }} />
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span style={{
                  color: 'var(--accent-orange, #ff6b35)', fontSize: '0.68rem',
                  letterSpacing: '0.18em', textTransform: 'uppercase',
                }}>
                  ◤ {WINDOW_LABELS[r.window] || 'Event reminder'}
                </span>
                <span style={{
                  color: 'var(--accent-orange, #ff6b35)', fontSize: '1.5rem',
                  fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap',
                }}>
                  {still(r) || ''}
                </span>
              </div>

              <div style={{
                color: 'var(--text-primary, #d8e8d8)', fontSize: '1.25rem',
                fontWeight: 700, margin: '10px 0 6px', wordBreak: 'break-word',
              }}>
                {r.eventTitle}
              </div>

              <div style={{ color: 'var(--text-secondary, #b8ccb8)', fontSize: '0.82rem' }}>
                {r.eventTime && <span>🕐 {fmt12(r.eventTime)}</span>}
                {r.location && <span style={{ marginLeft: 12 }}>📍 {r.location}</span>}
              </div>

              <Actions r={r} color="var(--accent-orange, #ff6b35)" />
            </div>
          ))}
        </div>
      )}

      {/* Further out: the corner, as before. */}
      {ambient.length > 0 && (
        <div style={{
          position: 'fixed', top: urgent.length > 0 ? '150px' : '16px', right: '16px',
          zIndex: 9000, display: 'flex', flexDirection: 'column', gap: '10px',
          maxWidth: '340px', width: 'calc(100vw - 32px)',
        }}>
          {ambient.map(r => (
            <div key={r.id} style={{
              background: 'var(--bg-elevated, #0d160d)',
              border: '1px solid var(--accent-amber, #ffd23f)',
              boxShadow: '0 0 24px rgba(255,210,63,0.25), 0 4px 16px rgba(0,0,0,0.6)',
              padding: '14px 16px',
              fontFamily: 'monospace',
              animation: calm ? 'none' : 'cortexReminderDrop 0.2s ease-out',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--accent-amber, #ffd23f)', letterSpacing: '1px' }}>
                  📅 {WINDOW_LABELS[r.window] || 'Event reminder'}
                </span>
                <span style={{
                  fontSize: '0.7rem', padding: '2px 8px', whiteSpace: 'nowrap',
                  background: 'var(--accent-amber, #ffd23f)20', color: 'var(--accent-amber, #ffd23f)',
                  border: '1px solid var(--accent-amber, #ffd23f)50',
                }}>
                  {still(r) || ''}
                </span>
              </div>

              <div style={{ fontSize: '0.95rem', color: 'var(--text-primary, #d8e8d8)', fontWeight: 700, marginBottom: 6 }}>
                {r.eventTitle}
              </div>

              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #b8ccb8)' }}>
                {r.eventTime && <span>🕐 {fmt12(r.eventTime)}</span>}
                {r.location && <span style={{ color: 'var(--text-dim, #8aa08a)', marginLeft: 10 }}>📍 {r.location}</span>}
              </div>

              <Actions r={r} color="var(--accent-amber, #ffd23f)" />
            </div>
          ))}
        </div>
      )}
    </>
  );
};

export default CalendarReminderAlert;
