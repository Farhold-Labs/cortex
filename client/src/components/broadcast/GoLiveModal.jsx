import React, { useEffect, useState } from 'react';
import { plainText } from '../../utils/plainText.js';

/**
 * Start a live broadcast from a wave (v2.109.0).
 *
 * Optionally tied to one of the wave's upcoming events — then a public link
 * also appears on that event's published page. The public link can be opened
 * or withdrawn later from the studio too.
 */
const GoLiveModal = ({ wave, fetchAPI, showToast, onClose }) => {
  const [title, setTitle] = useState(plainText(wave?.title || ''));
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAPI(`/events/wave/${wave.id}?upcoming=1&limit=10`)
      .then(d => setEvents(d.events || []))
      .catch(() => {});
  }, [wave.id, fetchAPI]);

  const start = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const d = await fetchAPI(`/waves/${wave.id}/broadcasts`, {
        method: 'POST',
        body: { title: title.trim(), eventId: eventId || undefined, public: isPublic },
      });
      window.location.href = `/broadcast/${d.broadcast.id}`;
    } catch (err) {
      showToast(err.message || 'Could not start the broadcast', 'error');
      setBusy(false);
    }
  };

  const field = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px', marginTop: 6,
    background: 'var(--bg-base)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
    fontFamily: 'monospace', fontSize: '0.9rem',
  };
  const label = { color: 'var(--text-dim)', fontSize: '0.72rem', letterSpacing: '0.08em', marginTop: 14, display: 'block' };

  return (
    <div role="dialog" aria-modal="true" aria-label="Go live" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(440px, 100%)', background: 'var(--bg-elevated)', border: '2px solid #e0242b', padding: '20px 22px', fontFamily: 'monospace' }}>
        <div style={{ color: '#e0242b', fontSize: '0.75rem', letterSpacing: '0.16em', marginBottom: 8 }}>● GO LIVE</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.5, margin: 0 }}>
          Broadcast your camera and microphone to this wave. Members watch from the wave, full screen if they like;
          they cannot be seen or heard.
        </p>

        <label style={label}>TITLE
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} style={field} autoFocus />
        </label>

        {events.length > 0 && (
          <label style={label}>FOR AN EVENT (OPTIONAL)
            <select value={eventId} onChange={e => setEventId(e.target.value)} style={field}>
              <option value="">— none —</option>
              {events.map(ev => (
                <option key={ev.id} value={ev.id}>{plainText(ev.title)} · {ev.eventDate}{ev.eventTime ? ` ${ev.eventTime}` : ''}</option>
              ))}
            </select>
          </label>
        )}

        <label style={{ ...label, display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--text-secondary)', fontSize: '0.8rem', letterSpacing: 0, lineHeight: 1.4 }}>
          <input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} style={{ marginTop: 2 }} />
          <span>Also open a public link, so people without an account can watch{eventId ? ' — shown on the event’s public page' : ''}. You can turn it off at any time.</span>
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={{ padding: '9px 16px', background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-dim)', fontFamily: 'monospace', cursor: 'pointer' }}>CANCEL</button>
          <button onClick={start} disabled={busy || !title.trim()}
            style={{ padding: '9px 16px', background: '#e0242b', border: '1px solid #e0242b', color: '#fff', fontFamily: 'monospace', cursor: busy ? 'default' : 'pointer', opacity: busy || !title.trim() ? 0.6 : 1 }}>
            {busy ? 'STARTING…' : '● START BROADCAST'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GoLiveModal;
