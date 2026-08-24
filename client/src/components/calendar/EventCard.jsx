import React, { useState, useEffect, useCallback } from 'react';

// An event card in the wave timeline (v2.72.0).
//
// The ping stores only an event id. Everything shown here is fetched live, so
// editing or cancelling an event updates every card instead of leaving a
// message in the history that lies about it.

const parseDay = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : null;
};

const fmtDate = (ymd) => {
  const d = parseDay(ymd);
  return d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : ymd;
};

const fmt12 = (t) => {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return t;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const isPast = (ymd, time) => {
  const d = parseDay(ymd);
  if (!d) return false;
  if (time) {
    const [h, m] = time.split(':').map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
    return d.getTime() < Date.now();
  }
  d.setHours(23, 59, 59, 999);
  return d.getTime() < Date.now();
};

const RSVP_CHOICES = [
  ['going', '✓ Going'],
  ['maybe', '? Maybe'],
  ['not_going', '✕ Can’t'],
];

const EventCard = ({ eventId, fetchAPI, currentUser, isMobile, waveEncrypted, onOpen, showToast }) => {
  const [event, setEvent] = useState(null);
  const [counts, setCounts] = useState(null);
  const [myRsvp, setMyRsvp] = useState(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRsvp = useCallback(() => {
    fetchAPI(`/events/${eventId}/rsvp`)
      .then(d => { setCounts(d.counts || null); setMyRsvp(d.userRsvp || null); })
      // 403 here only means this user cannot see the attendee list; the card
      // itself is still fine to show.
      .catch(() => {});
  }, [eventId, fetchAPI]);

  useEffect(() => {
    let cancelled = false;
    fetchAPI(`/events/${eventId}`)
      .then(d => { if (!cancelled) { setEvent(d.event); setMyRsvp(d.userRsvp || null); } })
      .catch(() => { if (!cancelled) setGone(true); });
    loadRsvp();
    return () => { cancelled = true; };
  }, [eventId, fetchAPI, loadRsvp]);

  // The event was deleted after the card was posted. Say so rather than
  // rendering a card for something that no longer exists.
  if (gone) {
    return (
      <div style={{
        border: '1px solid var(--border-subtle)', borderLeft: '3px solid var(--text-muted)',
        padding: '10px 14px', margin: '4px 0',
        color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.78rem',
      }}>
        📅 This event has been cancelled or removed.
      </div>
    );
  }

  if (!event) {
    return (
      <div style={{
        border: '1px solid var(--border-subtle)', padding: '10px 14px', margin: '4px 0',
        color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.78rem',
      }}>
        📅 Loading event…
      </div>
    );
  }

  const past = isPast(event.eventDate, event.eventTime);

  const sendRsvp = async (status) => {
    setBusy(true);
    try {
      if (myRsvp === status) {
        await fetchAPI(`/events/${eventId}/rsvp`, { method: 'DELETE' });
        setMyRsvp(null);
      } else {
        await fetchAPI(`/events/${eventId}/rsvp`, { method: 'POST', body: { status } });
        setMyRsvp(status);
      }
      loadRsvp();
    } catch (err) {
      showToast?.(err.message || 'Could not save your RSVP', 'error');
    } finally {
      setBusy(false);
    }
  };

  const summary = counts
    ? [
        counts.going ? `${counts.going} going` : null,
        counts.guests > counts.going ? `${counts.guests} attending` : null,
        counts.maybe ? `${counts.maybe} maybe` : null,
      ].filter(Boolean).join(' · ')
    : null;

  return (
    <div style={{
      border: '1px solid var(--accent-teal)40',
      borderLeft: '3px solid var(--accent-teal)',
      background: 'var(--bg-surface)',
      padding: isMobile ? '12px' : '12px 14px',
      margin: '4px 0',
      maxWidth: 460,
      opacity: past ? 0.65 : 1,
    }}>
      <div
        onClick={() => onOpen?.(event)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(event); } }}
        style={{ cursor: 'pointer' }}
      >
        <div style={{
          color: 'var(--accent-teal)', fontFamily: 'monospace', fontSize: '0.62rem',
          letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 5,
        }}>
          📅 Event{past ? ' · past' : ''}
        </div>

        <div style={{
          color: 'var(--text-primary)', fontSize: isMobile ? '0.95rem' : '1rem',
          fontWeight: 700, marginBottom: 4, wordBreak: 'break-word',
        }}>
          {event.title}
        </div>

        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'monospace' }}>
          {fmtDate(event.eventDate)}
          {event.eventTime ? ` · ${fmt12(event.eventTime)}` : ''}
          {event.location ? ` · ${event.location}` : ''}
        </div>

        {event.description && (
          <div style={{
            color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: 6, lineHeight: 1.45,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {event.description}
          </div>
        )}

        {summary && (
          <div style={{ color: 'var(--accent-green)', fontSize: '0.72rem', fontFamily: 'monospace', marginTop: 6 }}>
            {summary}
          </div>
        )}
      </div>

      {event.rsvpEnabled && !past && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {RSVP_CHOICES.map(([value, label]) => (
            <button
              key={value}
              disabled={busy}
              onClick={() => sendRsvp(value)}
              style={{
                padding: isMobile ? '8px 10px' : '5px 10px',
                minHeight: isMobile ? 36 : 'auto',
                background: myRsvp === value ? 'var(--accent-teal)20' : 'transparent',
                border: `1px solid ${myRsvp === value ? 'var(--accent-teal)' : 'var(--border-subtle)'}`,
                color: myRsvp === value ? 'var(--accent-teal)' : 'var(--text-dim)',
                cursor: busy ? 'default' : 'pointer',
                fontFamily: 'monospace', fontSize: '0.7rem',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* The card is created by the server, which holds no wave key — so it is
          plaintext even here. Event records are plaintext regardless, but say so
          rather than let an encrypted wave imply otherwise. */}
      {waveEncrypted && (
        <div style={{
          color: 'var(--text-muted)', fontSize: '0.62rem', fontFamily: 'monospace',
          marginTop: 8, borderTop: '1px solid var(--border-subtle)', paddingTop: 6,
        }}>
          🔓 Event details are not end-to-end encrypted
        </div>
      )}
    </div>
  );
};

export default EventCard;
