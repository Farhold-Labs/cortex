import React, { useState, useEffect, useCallback } from 'react';

// Upcoming events for the wave you're reading (v2.71.0).
//
// A reminder or a calendar entry could take you to a wave, but the wave itself
// showed nothing about the event — so unless the event's title happened to
// explain itself, you arrived with no idea what it was about. This puts the
// wave's next few events at the top of the wave, and opens the full detail
// (description, location, RSVP, add-to-calendar) on click.

const parseDay = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : null;
};

const fmt12 = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return t;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

// "Today", "Tomorrow", then a short date — the near ones are what matter.
const dayLabel = (ymd) => {
  const d = parseDay(ymd);
  if (!d) return ymd;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const isToday = (ymd) => dayLabel(ymd) === 'Today';

const WaveEventsBanner = ({ waveId, fetchAPI, isMobile, onOpenEvent, onCreateEvent, reloadTrigger }) => {
  const [events, setEvents] = useState([]);
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(() => {
    if (!waveId) return;
    fetchAPI(`/events/wave/${waveId}?upcoming=1&limit=5`)
      .then(d => setEvents(d.events || []))
      // A 403 just means this user isn't a participant; nothing to show.
      .catch(() => setEvents([]));
  }, [waveId, fetchAPI]);

  useEffect(() => { load(); }, [load, reloadTrigger]);

  if (events.length === 0 && !onCreateEvent) return null;

  const shown = collapsed ? events.slice(0, 1) : events;

  return (
    <div style={{
      marginBottom: 16,
      background: 'var(--bg-surface)',
      border: '1px solid var(--accent-teal)40',
      borderLeft: '3px solid var(--accent-teal)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '8px 12px' : '7px 14px',
        borderBottom: shown.length ? '1px solid var(--border-subtle)' : 'none',
      }}>
        <span style={{
          color: 'var(--accent-teal)', fontFamily: 'monospace', fontSize: '0.65rem',
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          📅 {events.length === 0 ? 'No upcoming events' : `Upcoming${events.length > 1 ? ` · ${events.length}` : ''}`}
        </span>
        <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {onCreateEvent && (
          <button
            onClick={onCreateEvent}
            title="Create an event in this wave"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: 'var(--accent-teal)', fontFamily: 'monospace', fontSize: '0.65rem',
            }}
          >
            + event
          </button>
        )}
        {events.length > 1 && (
          <button
            onClick={() => setCollapsed(v => !v)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.65rem',
            }}
          >
            {collapsed ? `▶ show all` : '▼ hide'}
          </button>
        )}
        </span>
      </div>

      {shown.map(ev => (
        <div
          key={`${ev.id}-${ev.eventDate}`}
          onClick={() => onOpenEvent?.(ev)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenEvent?.(ev); } }}
          style={{
            display: 'flex', gap: 12, alignItems: 'baseline',
            padding: isMobile ? '10px 12px' : '9px 14px',
            cursor: 'pointer',
            borderTop: '1px solid var(--border-subtle)',
            minHeight: isMobile ? 44 : 'auto',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{
            flexShrink: 0, minWidth: 68,
            color: isToday(ev.eventDate) ? 'var(--accent-amber)' : 'var(--text-dim)',
            fontFamily: 'monospace', fontSize: '0.72rem',
          }}>
            {dayLabel(ev.eventDate)}
          </span>
          <span style={{
            color: 'var(--text-primary)', fontSize: isMobile ? '0.85rem' : '0.9rem',
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {ev.title}
          </span>
          {ev.eventTime && (
            <span style={{ flexShrink: 0, color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.7rem' }}>
              {fmt12(ev.eventTime)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};

export default WaveEventsBanner;
