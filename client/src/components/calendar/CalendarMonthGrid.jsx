import React from 'react';
import { getMonthDays, eventsForDate, CATEGORY_COLORS, DAY_NAMES } from './calendarUtils.js';

const CalendarMonthGrid = ({ year, month, events, selectedDate, onSelectDate }) => {
  const days = getMonthDays(year, month);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {/* Day-of-week headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '4px' }}>
        {DAY_NAMES.map(d => (
          <div key={d} style={{
            textAlign: 'center', fontSize: '0.65rem', color: 'var(--text-muted)',
            fontFamily: 'monospace', padding: '4px 0',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
        {days.map((dateStr, i) => {
          if (!dateStr) return <div key={`blank-${i}`} />;
          const dayEvents = eventsForDate(events, dateStr);
          const isToday    = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const visibleEvents  = dayEvents.slice(0, 3);
          const overflow       = dayEvents.length - visibleEvents.length;

          return (
            <button
              key={dateStr}
              onClick={() => onSelectDate(dateStr)}
              style={{
                minHeight: '60px',
                padding: '4px',
                background: isSelected ? 'var(--accent-amber)20'
                          : isToday    ? 'var(--bg-elevated)'
                          : 'transparent',
                border: isSelected ? '1px solid var(--accent-amber)'
                       : isToday    ? '1px solid var(--accent-amber)40'
                       : '1px solid transparent',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              <span style={{
                fontSize: '0.75rem',
                fontFamily: 'monospace',
                color: isToday ? 'var(--accent-amber)' : isSelected ? 'var(--accent-amber)' : 'var(--text-secondary)',
                fontWeight: isToday ? 700 : 400,
                lineHeight: 1,
              }}>
                {parseInt(dateStr.slice(-2))}
              </span>
              {visibleEvents.map((ev, idx) => (
                <div key={ev.id || idx} style={{
                  height: '4px',
                  borderRadius: '2px',
                  background: CATEGORY_COLORS[ev.category] || CATEGORY_COLORS.general,
                  opacity: 0.85,
                }} />
              ))}
              {overflow > 0 && (
                <span style={{ fontSize: '0.55rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  +{overflow}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CalendarMonthGrid;
