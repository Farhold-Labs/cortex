import React, { useState, useEffect, useCallback } from 'react';

// Upcoming events + pinned pings for the wave you're reading (v2.74.0).
//
// Both of these used to be strips rendered inside the message scroll container,
// which meant they sat above the oldest loaded message. In a wave with thousands
// of pings you would never scroll far enough to see them — the pins banner in
// particular is for things you want to come back to, so being reachable only by
// scrolling to the very top defeated it entirely.
//
// This bar lives outside the scroller, directly under the wave header, so it is
// always on screen. It stays one compact line by default and opens one panel at
// a time, because a permanently-expanded list would cost real reading space in
// exactly the long waves that made this a problem.

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

// Message content is sanitized HTML. Each pin is one line here, so tags,
// entities and newlines all have to come out for the preview to be legible.
const plainPreview = (html) => {
  if (!html) return '';
  const el = document.createElement('div');
  el.innerHTML = html;
  el.querySelectorAll('img').forEach(img => { img.replaceWith(document.createTextNode('🖼 ')); });
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
};

const shortWhen = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const previewOf = (pin) => {
  // Ciphertext is never shown. decryptPins marks what it managed to open; an
  // encrypted pin that isn't marked means the wave is still locked, so the pin
  // is announced rather than rendered.
  if (pin.encrypted && !pin._decrypted) return '🔒 Encrypted ping';
  if (pin.eventId) return '📅 Event';
  const text = plainPreview(pin.content);
  if (text) return text;
  if (pin.mediaType) return `📎 ${pin.mediaType}`;
  return '(no text)';
};

const Chip = ({ active, accent, onClick, children, title }) => (
  <button
    onClick={onClick}
    title={title}
    aria-expanded={active}
    style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '3px 9px',
      background: active ? `${accent}22` : 'transparent',
      border: `1px solid ${active ? accent : 'var(--border-subtle)'}`,
      color: active ? accent : 'var(--text-dim)',
      cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.65rem',
      letterSpacing: '0.06em', whiteSpace: 'nowrap',
    }}
  >
    {children}
  </button>
);

const WaveContextBar = ({
  waveId, fetchAPI, isMobile, reloadTrigger,
  onOpenEvent, onCreateEvent,
  onScrollToPing, onUnpin, decryptPins, showToast,
}) => {
  const [events, setEvents] = useState([]);
  const [pins, setPins] = useState([]);
  const [open, setOpen] = useState(null); // 'events' | 'pins' | null

  const loadEvents = useCallback((isLive) => {
    if (!waveId) return;
    fetchAPI(`/events/wave/${waveId}?upcoming=1&limit=10`)
      .then(d => { if (isLive()) setEvents(d.events || []); })
      // A 403 just means this user can't see the wave's events; nothing to show.
      .catch(() => { if (isLive()) setEvents([]); });
  }, [waveId, fetchAPI]);

  const loadPins = useCallback((isLive) => {
    if (!waveId) return;
    fetchAPI(`/waves/${waveId}/pins`)
      .then(async (d) => {
        const raw = d.pins || [];
        // Decryption is async, so a wave switch mid-flight would otherwise land
        // one wave's pins in another wave's bar.
        const opened = decryptPins ? await decryptPins(raw, waveId) : raw;
        if (isLive()) setPins(opened);
      })
      .catch(() => { if (isLive()) setPins([]); });
  }, [waveId, fetchAPI, decryptPins]);

  useEffect(() => {
    let cancelled = false;
    const isLive = () => !cancelled;
    loadEvents(isLive);
    loadPins(isLive);
    return () => { cancelled = true; };
  }, [loadEvents, loadPins, reloadTrigger]);

  // Close the panel when moving to another wave, so it doesn't carry over.
  useEffect(() => { setOpen(null); }, [waveId]);

  const unpin = async (pin) => {
    try {
      await fetchAPI(`/pings/${pin.id}/pin`, { method: 'DELETE' });
      // Drop it locally now; the websocket event confirms for everyone else.
      setPins(prev => prev.filter(p => p.id !== pin.id));
      onUnpin?.(pin.id);
    } catch (err) {
      showToast?.(err.message || 'Could not unpin', 'error');
    }
  };

  const nextEvent = events[0];
  const panelOpen = open === 'events' ? events.length > 0 : open === 'pins' ? pins.length > 0 : false;

  const rowStyle = {
    display: 'flex', gap: 10, alignItems: 'center',
    padding: isMobile ? '9px 12px' : '8px 14px',
    borderTop: '1px solid var(--border-subtle)',
    minHeight: isMobile ? 44 : 'auto',
    cursor: 'pointer',
  };

  return (
    <div style={{
      flexShrink: 0,
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border-primary)',
    }}>
      {/* Always-visible chip row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: isMobile ? '6px 12px' : '5px 14px',
      }}>
        <Chip
          active={open === 'pins'}
          accent="var(--accent-amber)"
          title={pins.length ? 'Show pinned pings' : 'Nothing pinned in this wave yet'}
          onClick={() => setOpen(o => (o === 'pins' ? null : 'pins'))}
        >
          📌 {pins.length ? `${pins.length} pinned` : 'No pins'}
          {pins.length > 0 && <span style={{ opacity: 0.6 }}>{open === 'pins' ? '▾' : '▸'}</span>}
        </Chip>

        <Chip
          active={open === 'events'}
          accent="var(--accent-teal)"
          title={events.length ? 'Show upcoming events' : 'No upcoming events in this wave'}
          onClick={() => setOpen(o => (o === 'events' ? null : 'events'))}
        >
          📅 {events.length ? `${events.length} upcoming` : 'No events'}
          {events.length > 0 && <span style={{ opacity: 0.6 }}>{open === 'events' ? '▾' : '▸'}</span>}
        </Chip>

        {/* The next event inline, so the common case needs no click at all. */}
        {nextEvent && open !== 'events' && (
          <span
            onClick={() => onOpenEvent?.(nextEvent)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenEvent?.(nextEvent); } }}
            title={nextEvent.title}
            style={{
              flex: 1, minWidth: 0, cursor: 'pointer',
              color: isToday(nextEvent.eventDate) ? 'var(--accent-amber)' : 'var(--text-muted)',
              fontFamily: 'monospace', fontSize: '0.65rem',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}
          >
            {dayLabel(nextEvent.eventDate)}
            {nextEvent.eventTime ? ` ${fmt12(nextEvent.eventTime)}` : ''} · {nextEvent.title}
          </span>
        )}

        {onCreateEvent && (
          <button
            onClick={onCreateEvent}
            title="Create an event in this wave"
            style={{
              marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
              padding: isMobile ? '6px 4px' : '2px 4px',
              color: 'var(--accent-teal)', fontFamily: 'monospace', fontSize: '0.65rem',
            }}
          >
            + event
          </button>
        )}
      </div>

      {/* One panel at a time. Capped and independently scrollable so a wave with
          fifty pins cannot push the conversation off the screen. */}
      {panelOpen && (
        <div style={{
          maxHeight: isMobile ? '45vh' : '38vh',
          overflowY: 'auto',
          borderTop: `2px solid ${open === 'pins' ? 'var(--accent-amber)' : 'var(--accent-teal)'}`,
        }}>
          {open === 'pins' && pins.map(pin => (
            <div key={pin.id} style={rowStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div
                onClick={() => { onScrollToPing?.(pin.id); setOpen(null); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onScrollToPing?.(pin.id); setOpen(null); } }}
                title="Jump to this ping"
                style={{ flex: 1, minWidth: 0 }}
              >
                <div style={{
                  color: 'var(--text-primary)', fontSize: isMobile ? '0.85rem' : '0.9rem',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {previewOf(pin)}
                </div>
                <div style={{
                  color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.65rem', marginTop: 2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {pin.authorName || 'Unknown'} · {shortWhen(pin.createdAt)}
                  {pin.pinnedByName ? ` · pinned by ${pin.pinnedByName}` : ''}
                </div>
              </div>
              {/* Anyone in the wave can unpin — the pin belongs to the wave. */}
              <button
                onClick={(e) => { e.stopPropagation(); unpin(pin); }}
                title="Unpin"
                aria-label={`Unpin ping from ${pin.authorName || 'unknown'}`}
                style={{
                  flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-dim)', fontFamily: 'monospace', fontSize: '0.8rem',
                  padding: isMobile ? '8px' : '4px 6px', minWidth: isMobile ? 36 : 'auto',
                }}
              >
                ✕
              </button>
            </div>
          ))}

          {open === 'events' && events.map(ev => (
            <div
              key={`${ev.id}-${ev.eventDate}`}
              onClick={() => { onOpenEvent?.(ev); setOpen(null); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenEvent?.(ev); setOpen(null); } }}
              style={{ ...rowStyle, alignItems: 'baseline' }}
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
      )}
    </div>
  );
};

export default WaveContextBar;
