import React, { useEffect, useState } from 'react';

const WINDOW_LABELS = {
  '1day':  'Tomorrow',
  '1hour': 'In 1 hour',
  '30min': 'In 30 minutes',
  '15min': 'In 15 minutes',
  'login': 'Starting soon',
};

const CalendarReminderAlert = ({ reminders, onDismiss }) => {
  const [timers, setTimers] = useState({});

  // Update "starts in X min" every 30 seconds
  useEffect(() => {
    if (reminders.length === 0) return;
    const id = setInterval(() => setTimers(t => ({ ...t, _tick: Date.now() })), 30000);
    return () => clearInterval(id);
  }, [reminders.length]);

  if (reminders.length === 0) return null;

  const getTimeUntil = (eventDate, eventTime) => {
    if (!eventDate || !eventTime) return null;
    const eventMs = new Date(`${eventDate}T${eventTime}:00`).getTime();
    const diffMs = eventMs - Date.now();
    if (diffMs <= 0) return 'Now';
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 60) return `${diffMin} min`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const fmt12 = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  return (
    <div style={{
      position: 'fixed', top: '16px', right: '16px',
      zIndex: 9000, display: 'flex', flexDirection: 'column', gap: '10px',
      maxWidth: '340px', width: 'calc(100vw - 32px)',
    }}>
      {reminders.map(r => {
        const timeUntil = getTimeUntil(r.eventDate, r.eventTime);
        return (
          <div key={r.id} style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--accent-amber)',
            boxShadow: '0 0 24px rgba(255,210,63,0.25), 0 4px 16px rgba(0,0,0,0.6)',
            padding: '14px 16px',
            fontFamily: 'monospace',
            animation: 'slideInRight 0.2s ease-out',
          }}>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1rem' }}>📅</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--accent-amber)', letterSpacing: '1px' }}>
                  {WINDOW_LABELS[r.window] || 'Event reminder'}
                </span>
              </div>
              <button
                onClick={() => onDismiss(r.id)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0 0 8px',
                }}
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>

            {/* Event title */}
            <div style={{ fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '6px', fontWeight: 700 }}>
              {r.eventTitle}
            </div>

            {/* Time row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {r.eventTime && (
                  <span>🕐 {fmt12(r.eventTime)}</span>
                )}
                {r.location && (
                  <span style={{ color: 'var(--text-dim)', marginLeft: '10px' }}>📍 {r.location}</span>
                )}
              </div>
              {timeUntil && (
                <span style={{
                  fontSize: '0.7rem', padding: '2px 8px',
                  background: 'var(--accent-amber)20', color: 'var(--accent-amber)',
                  border: '1px solid var(--accent-amber)50',
                }}>
                  {timeUntil}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default CalendarReminderAlert;
