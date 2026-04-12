import React, { useState, useEffect, useCallback } from 'react';
import CalendarMonthGrid from '../components/calendar/CalendarMonthGrid.jsx';
import CalendarAgendaView from '../components/calendar/CalendarAgendaView.jsx';
import EventDetailModal from '../components/calendar/EventDetailModal.jsx';
import EventCreateModal from '../components/calendar/EventCreateModal.jsx';
import { MONTH_NAMES } from '../components/calendar/calendarUtils.js';

const CalendarView = ({ fetchAPI, showToast, currentUser, isMobile, waves = [] }) => {
  const today        = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [viewMode,       setViewMode]       = useState('month');
  const [events,         setEvents]         = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [selectedDate,   setSelectedDate]   = useState(null);
  const [selectedEvent,  setSelectedEvent]  = useState(null);
  const [showCreate,     setShowCreate]     = useState(false);
  const [editEvent,      setEditEvent]      = useState(null);
  const [dayPanelEvents, setDayPanelEvents] = useState([]);

  // Compute visible range — load current month ± 1 for smooth nav
  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(year, month - 1, 1).toISOString().slice(0, 10);
      const to   = new Date(year, month + 2, 0).toISOString().slice(0, 10);
      const data = await fetchAPI(`/events?from=${from}&to=${to}&scope=server,personal,wave`);
      setEvents(data.events || []);
    } catch (err) {
      if (!err.message?.includes('401')) showToast(err.message || 'Failed to load events', 'error');
    }
    setLoading(false);
  }, [year, month, fetchAPI, showToast]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Update day panel when selectedDate changes
  useEffect(() => {
    if (!selectedDate) { setDayPanelEvents([]); return; }
    setDayPanelEvents(events.filter(e => e.eventDate === selectedDate));
  }, [selectedDate, events]);

  const goToPrev = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    setSelectedDate(null);
  };
  const goToNext = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    setSelectedDate(null);
  };
  const goToToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDate(today.toISOString().slice(0, 10));
  };

  const handleDeleteEvent = async (event) => {
    if (!window.confirm(`Delete "${event.title}"?`)) return;
    try {
      await fetchAPI(`/events/${event.id}`, { method: 'DELETE' });
      showToast('Event deleted', 'success');
      setSelectedEvent(null);
      loadEvents();
    } catch (err) {
      showToast(err.message || 'Failed to delete event', 'error');
    }
  };

  // Agenda: show next 3 months from today
  const agendaEvents = events
    .filter(e => new Date(e.eventDate + 'T12:00:00') >= new Date(today.toISOString().slice(0, 10) + 'T00:00:00'))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '12px 16px' : '12px 20px',
        borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, gap: '8px', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={goToPrev} style={navBtnStyle}>‹</button>
          <span style={{ fontFamily: 'monospace', fontSize: isMobile ? '0.85rem' : '0.9rem', color: 'var(--text-primary)', minWidth: '140px', textAlign: 'center' }}>
            {MONTH_NAMES[month].toUpperCase()} {year}
          </span>
          <button onClick={goToNext} style={navBtnStyle}>›</button>
          <button onClick={goToToday} style={{ ...navBtnStyle, fontSize: '0.65rem', padding: '4px 8px' }}>TODAY</button>
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => setViewMode('month')} style={viewBtnStyle(viewMode === 'month')}>▦</button>
          <button onClick={() => setViewMode('agenda')} style={viewBtnStyle(viewMode === 'agenda')}>☰</button>
          <button
            onClick={() => { setEditEvent(null); setShowCreate(true); }}
            style={{
              padding: '6px 12px', background: 'var(--accent-amber)20', fontFamily: 'monospace', fontSize: '0.75rem',
              border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)', cursor: 'pointer',
            }}
          >
            + EVENT
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'auto', padding: isMobile ? '12px' : '16px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px', fontFamily: 'monospace' }}>
            Loading...
          </div>
        ) : viewMode === 'month' ? (
          <CalendarMonthGrid
            year={year} month={month} events={events}
            selectedDate={selectedDate}
            onSelectDate={date => setSelectedDate(date === selectedDate ? null : date)}
          />
        ) : (
          <CalendarAgendaView events={agendaEvents} onSelectEvent={setSelectedEvent} />
        )}
      </div>

      {/* Day panel — slides up below grid when a date is selected */}
      {viewMode === 'month' && selectedDate && (
        <div style={{
          borderTop: '1px solid var(--border-subtle)', flexShrink: 0,
          maxHeight: '40vh', overflow: 'auto',
          background: 'var(--bg-surface)', padding: '12px 16px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--accent-amber)' }}>
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}
            </span>
            <button
              onClick={() => { setEditEvent(null); setShowCreate(true); }}
              style={{
                padding: '4px 10px', background: 'transparent', fontFamily: 'monospace', fontSize: '0.7rem',
                border: '1px solid var(--accent-amber)50', color: 'var(--accent-amber)', cursor: 'pointer',
              }}
            >
              + EVENT
            </button>
          </div>

          {dayPanelEvents.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontFamily: 'monospace' }}>No events</div>
          ) : (
            dayPanelEvents.map(ev => (
              <button key={ev.id} onClick={() => setSelectedEvent(ev)} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 0', background: 'transparent', border: 'none',
                borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer', textAlign: 'left',
              }}>
                <div style={{
                  width: '3px', height: '32px', borderRadius: '2px', flexShrink: 0,
                  background: ev.category === 'general' ? 'var(--accent-teal)'
                            : ev.category === 'birthday' ? 'var(--accent-purple)'
                            : ev.category === 'holiday' ? 'var(--accent-amber)'
                            : ev.category === 'community' ? 'var(--accent-green)'
                            : 'var(--accent-teal)',
                }} />
                <div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>{ev.title}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                    {ev.eventTime || 'All day'}{ev.location ? ` · ${ev.location}` : ''}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {/* Modals */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          fetchAPI={fetchAPI}
          showToast={showToast}
          currentUser={currentUser}
          onEdit={ev => { setEditEvent(ev); setSelectedEvent(null); setShowCreate(true); }}
          onDelete={handleDeleteEvent}
        />
      )}

      {showCreate && (
        <EventCreateModal
          onClose={() => { setShowCreate(false); setEditEvent(null); }}
          fetchAPI={fetchAPI}
          showToast={showToast}
          currentUser={currentUser}
          waves={waves}
          initialDate={selectedDate || ''}
          editEvent={editEvent}
          onSaved={loadEvents}
        />
      )}
    </div>
  );
};

const navBtnStyle = {
  padding: '4px 10px', background: 'transparent', fontFamily: 'monospace', fontSize: '1rem',
  border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', cursor: 'pointer',
};
const viewBtnStyle = (active) => ({
  padding: '5px 10px', background: active ? 'var(--accent-amber)20' : 'transparent',
  border: `1px solid ${active ? 'var(--accent-amber)' : 'var(--border-subtle)'}`,
  color: active ? 'var(--accent-amber)' : 'var(--text-dim)', cursor: 'pointer', fontSize: '0.85rem',
});

export default CalendarView;
