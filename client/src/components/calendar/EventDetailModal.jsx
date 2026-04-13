import React, { useState, useEffect } from 'react';
import { CATEGORY_COLORS, SCOPE_LABELS, formatEventDate, formatEventTime } from './calendarUtils.js';

const RSVP_OPTIONS = [
  { value: 'going',     label: '✓ Going',   color: 'var(--accent-green)' },
  { value: 'maybe',     label: '? Maybe',   color: 'var(--accent-amber)' },
  { value: 'not_going', label: '✕ Decline', color: 'var(--accent-red, #ff4444)' },
];

const EventDetailModal = ({ event: initialEvent, onClose, fetchAPI, showToast, currentUser, onEdit, onDelete }) => {
  const [event, setEvent]       = useState(initialEvent);
  const [rsvps, setRsvps]       = useState([]);
  const [userRsvp, setUserRsvp] = useState(null);
  const [showRsvps, setShowRsvps] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);

  useEffect(() => {
    fetchAPI(`/events/${event.id}`)
      .then(data => {
        setEvent(data.event);
        setUserRsvp(data.userRsvp);
      })
      .catch(() => {});
    if (event.rsvpEnabled) {
      fetchAPI(`/events/${event.id}/rsvp`)
        .then(data => { setRsvps(data.rsvps || []); setUserRsvp(data.userRsvp); })
        .catch(() => {});
    }
  }, [event.id, event.rsvpEnabled, fetchAPI]);

  const handleRsvp = async (status) => {
    setRsvpLoading(true);
    try {
      if (userRsvp === status) {
        await fetchAPI(`/events/${event.id}/rsvp`, { method: 'DELETE' });
        setUserRsvp(null);
      } else {
        await fetchAPI(`/events/${event.id}/rsvp`, { method: 'POST', body: { status } });
        setUserRsvp(status);
      }
      const data = await fetchAPI(`/events/${event.id}/rsvp`);
      setRsvps(data.rsvps || []);
    } catch (err) {
      showToast(err.message || 'Failed to update RSVP', 'error');
    }
    setRsvpLoading(false);
  };

  const handleDownloadICS = () => {
    window.open(`/api/events/${event.id}/ics`, '_blank');
  };

  const handleAddToGoogle = () => {
    if (event.googleCalendarUrl) window.open(event.googleCalendarUrl, '_blank');
  };

  const isCreator = currentUser?.id === event.createdBy;
  const catColor  = CATEGORY_COLORS[event.category] || CATEGORY_COLORS.general;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.85)', padding: '16px',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-elevated)', border: `1px solid ${catColor}60`,
        maxWidth: '480px', width: '100%', maxHeight: '90vh', overflow: 'auto',
        boxShadow: `0 0 30px ${catColor}20`,
      }} onClick={e => e.stopPropagation()}>

        {/* Header color bar */}
        <div style={{ height: '4px', background: catColor }} />

        <div style={{ padding: '20px' }}>
          {/* Category + scope badges */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '0.65rem', padding: '2px 8px', fontFamily: 'monospace',
              background: `${catColor}20`, color: catColor, border: `1px solid ${catColor}40`,
            }}>
              {(event.category || 'general').toUpperCase()}
            </span>
            <span style={{
              fontSize: '0.65rem', padding: '2px 8px', fontFamily: 'monospace',
              background: 'var(--bg-surface)', color: 'var(--text-dim)', border: '1px solid var(--border-subtle)',
            }}>
              {SCOPE_LABELS[event.scope] || event.scope}
            </span>
            {event.recurring && (
              <span style={{
                fontSize: '0.65rem', padding: '2px 8px', fontFamily: 'monospace',
                background: 'var(--accent-purple)15', color: 'var(--accent-purple)', border: '1px solid var(--accent-purple)40',
              }}>
                YEARLY
              </span>
            )}
          </div>

          {/* Title */}
          <h2 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '1.1rem' }}>
            {event.title}
          </h2>

          {/* Date / time */}
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '6px', fontFamily: 'monospace' }}>
            📅 {formatEventDate(event.eventDate)}
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: event.location ? '6px' : '12px', fontFamily: 'monospace' }}>
            🕐 {formatEventTime(event)}
          </div>

          {/* Location */}
          {event.location && (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '12px', fontFamily: 'monospace' }}>
              📍 {event.location}
            </div>
          )}

          {/* Description */}
          {event.description && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 16px', lineHeight: 1.5 }}>
              {event.description}
            </p>
          )}

          {/* RSVP */}
          {event.rsvpEnabled && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: '8px', letterSpacing: '1px' }}>
                RSVP
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {RSVP_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleRsvp(opt.value)}
                    disabled={rsvpLoading}
                    style={{
                      padding: '6px 12px', fontFamily: 'monospace', fontSize: '0.75rem', cursor: 'pointer',
                      background: userRsvp === opt.value ? `${opt.color}20` : 'transparent',
                      border: `1px solid ${userRsvp === opt.value ? opt.color : 'var(--border-subtle)'}`,
                      color: userRsvp === opt.value ? opt.color : 'var(--text-dim)',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {rsvps.length > 0 && (
                <button
                  onClick={() => setShowRsvps(!showRsvps)}
                  style={{
                    marginTop: '8px', padding: '0', background: 'none', border: 'none',
                    color: 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer', fontFamily: 'monospace',
                  }}
                >
                  {showRsvps ? '▼' : '▶'} {rsvps.filter(r => r.status === 'going').length} going ·{' '}
                  {rsvps.filter(r => r.status === 'maybe').length} maybe
                </button>
              )}
              {showRsvps && rsvps.length > 0 && (
                <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {rsvps.map(r => (
                    <span key={r.user_id} style={{
                      fontSize: '0.7rem', padding: '2px 6px', fontFamily: 'monospace',
                      background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                      color: r.status === 'going' ? 'var(--accent-green)' : r.status === 'maybe' ? 'var(--accent-amber)' : 'var(--text-dim)',
                    }}>
                      @{r.handle}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add to calendar */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <button onClick={handleAddToGoogle} style={{
              padding: '6px 12px', background: 'transparent', fontFamily: 'monospace', fontSize: '0.72rem',
              border: '1px solid var(--border-subtle)', color: 'var(--text-dim)', cursor: 'pointer',
            }}>
              + Google Calendar
            </button>
            <button onClick={handleDownloadICS} style={{
              padding: '6px 12px', background: 'transparent', fontFamily: 'monospace', fontSize: '0.72rem',
              border: '1px solid var(--border-subtle)', color: 'var(--text-dim)', cursor: 'pointer',
            }}>
              ↓ .ics (Apple / Outlook)
            </button>
          </div>

          {/* Edit / Delete / Close */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {(isCreator) && onEdit && (
              <button onClick={() => onEdit(event)} style={{
                padding: '8px 14px', background: 'transparent', fontFamily: 'monospace', fontSize: '0.8rem',
                border: '1px solid var(--border-secondary)', color: 'var(--text-secondary)', cursor: 'pointer',
              }}>
                EDIT
              </button>
            )}
            {(isCreator) && onDelete && (
              <button onClick={() => onDelete(event)} style={{
                padding: '8px 14px', background: 'transparent', fontFamily: 'monospace', fontSize: '0.8rem',
                border: '1px solid var(--accent-red, #ff4444)', color: 'var(--accent-red, #ff4444)', cursor: 'pointer',
              }}>
                DELETE
              </button>
            )}
            <button onClick={onClose} style={{
              padding: '8px 14px', background: 'var(--accent-amber)20', fontFamily: 'monospace', fontSize: '0.8rem',
              border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)', cursor: 'pointer',
            }}>
              CLOSE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventDetailModal;
