import React from 'react';
import { CATEGORY_COLORS, MONTH_NAMES, formatEventTime } from './calendarUtils.js';

const CalendarAgendaView = ({ events, onSelectEvent }) => {
  if (events.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.8rem' }}>
        No upcoming events
      </div>
    );
  }

  // Group by month
  const groups = {};
  for (const ev of events) {
    const d = new Date(ev.eventDate + 'T12:00:00');
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!groups[key]) groups[key] = { year: d.getFullYear(), month: d.getMonth(), events: [] };
    groups[key].events.push(ev);
  }

  return (
    <div style={{ padding: '0 4px' }}>
      {Object.values(groups).map(group => (
        <div key={`${group.year}-${group.month}`} style={{ marginBottom: '16px' }}>
          <div style={{
            fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--accent-amber)',
            letterSpacing: '2px', padding: '8px 4px 4px',
            borderBottom: '1px solid var(--border-subtle)', marginBottom: '8px',
          }}>
            {MONTH_NAMES[group.month].toUpperCase()} {group.year}
          </div>
          {group.events.map(ev => (
            <button
              key={ev.id}
              onClick={() => onSelectEvent(ev)}
              style={{
                width: '100%', display: 'flex', gap: '12px', alignItems: 'flex-start',
                padding: '10px 4px', background: 'transparent', border: 'none',
                borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {/* Date column */}
              <div style={{ minWidth: '32px', textAlign: 'center', flexShrink: 0 }}>
                <div style={{ fontSize: '1rem', fontFamily: 'monospace', color: 'var(--text-primary)', lineHeight: 1 }}>
                  {new Date(ev.eventDate + 'T12:00:00').getDate()}
                </div>
                <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {new Date(ev.eventDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}
                </div>
              </div>

              {/* Color bar */}
              <div style={{
                width: '3px', alignSelf: 'stretch', borderRadius: '2px', flexShrink: 0,
                background: CATEGORY_COLORS[ev.category] || CATEGORY_COLORS.general,
              }} />

              {/* Event details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontFamily: 'monospace', marginBottom: '2px' }}>
                  {ev.title}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span>{formatEventTime(ev)}</span>
                  {ev.location && <span>· {ev.location}</span>}
                  {ev.rsvpEnabled && ev.rsvpCounts && (
                    <span style={{ color: 'var(--accent-green)' }}>
                      {ev.rsvpCounts.going} going
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

export default CalendarAgendaView;
