import React, { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../config/constants.js';
import { useWindowSize } from '../hooks/useWindowSize.js';

// Public event pages (v2.68.0) — no auth. Renders /events/:slug (a list of a
// wave's upcoming events) and /events/:slug/:eventId (one event plus its RSVP
// form). Everything it shows comes from /api/public/events/*, which only ever
// exposes waves an admin has put in the portal and switched events on for.

const isEmbed = new URLSearchParams(window.location.search).get('embed') === '1';

// Dates arrive as plain YYYY-MM-DD, deliberately without a timezone — an event
// on the 15th is on the 15th wherever you read it. Parsing with new Date()
// would treat it as UTC midnight and show the 14th to anyone west of London.
const parseDay = (ymd) => {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : null;
};

const formatDay = (ymd) => {
  const d = parseDay(ymd);
  return d ? d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ymd;
};

const formatDayShort = (ymd) => {
  const d = parseDay(ymd);
  return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ymd;
};

// "19:00" → "7:00 PM", following the reader's locale.
const formatTime = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const timeRange = (ev) => {
  const start = formatTime(ev.time);
  if (!start) return 'All day';
  const end = formatTime(ev.endTime);
  return end ? `${start} – ${end}` : start;
};

const isPast = (ymd) => {
  const d = parseDay(ymd);
  if (!d) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today;
};

const card = {
  background: 'var(--bg-surface, #0a120a)',
  border: '1px solid var(--border-subtle, #1a2a1a)',
  padding: '18px 20px',
  marginBottom: 14,
};

const label = {
  color: 'var(--text-muted, #6a806a)',
  fontSize: '0.65rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontFamily: 'monospace',
  marginBottom: 4,
};

const btn = (primary) => ({
  padding: '10px 18px',
  minHeight: 44,
  background: primary ? 'var(--accent-amber, #ffd23f)20' : 'transparent',
  border: `1px solid ${primary ? 'var(--accent-amber, #ffd23f)' : 'var(--border-primary, #2a3a2a)'}`,
  color: primary ? 'var(--accent-amber, #ffd23f)' : 'var(--text-dim, #8aa08a)',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: '0.8rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
});

const input = {
  width: '100%',
  padding: '10px 12px',
  minHeight: 44,
  background: 'var(--bg-elevated, #0d160d)',
  border: '1px solid var(--border-subtle, #1a2a1a)',
  color: 'var(--text-primary, #d8e8d8)',
  fontFamily: 'var(--app-font, monospace)',
  fontSize: '1rem',
  boxSizing: 'border-box',
};

const RsvpCounts = ({ counts }) => {
  if (!counts) return null;
  const parts = [];
  if (counts.going) parts.push(`${counts.going} going`);
  if (counts.guests > counts.going) parts.push(`${counts.guests} attending`);
  if (counts.maybe) parts.push(`${counts.maybe} maybe`);
  if (!parts.length) return <span style={{ color: 'var(--text-muted, #6a806a)', fontSize: '0.75rem' }}>Be the first to RSVP</span>;
  return <span style={{ color: 'var(--accent-green, #0ead69)', fontSize: '0.75rem', fontFamily: 'monospace' }}>{parts.join(' · ')}</span>;
};

// ============ RSVP FORM ============

const RsvpForm = ({ slug, eventId, onCounts }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [guestCount, setGuestCount] = useState(1);
  const [status, setStatus] = useState('going');
  const [state, setState] = useState({ phase: 'idle' }); // idle | sending | done | error

  const submit = async (e) => {
    e.preventDefault();
    setState({ phase: 'sending' });
    try {
      const res = await fetch(`${API_URL}/public/events/${encodeURIComponent(slug)}/${encodeURIComponent(eventId)}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, guestCount: Number(guestCount), status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({ phase: 'error', message: data.error || 'Could not record your RSVP.' });
        return;
      }
      if (data.counts) onCounts?.(data.counts);
      setState({ phase: 'done', updated: data.updated, emailed: data.emailed });
    } catch {
      setState({ phase: 'error', message: 'Could not reach the server. Please try again.' });
    }
  };

  if (state.phase === 'done') {
    return (
      <div style={{ ...card, borderColor: 'var(--accent-green, #0ead69)' }}>
        <div style={{ color: 'var(--accent-green, #0ead69)', fontFamily: 'monospace', marginBottom: 6 }}>
          {state.updated ? "You're already on the list — updated." : "You're on the list."}
        </div>
        <div style={{ color: 'var(--text-dim, #8aa08a)', fontSize: '0.85rem' }}>
          {state.emailed
            ? 'A confirmation is on its way, with a link to cancel if your plans change.'
            : 'Your RSVP is recorded.'}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={card}>
      <div style={{ ...label, marginBottom: 12, color: 'var(--accent-amber, #ffd23f)' }}>RSVP</div>

      <div style={{ marginBottom: 12 }}>
        <div style={label}>Your name</div>
        <input style={input} value={name} onChange={(e) => setName(e.target.value)}
          required maxLength={100} autoComplete="name" />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={label}>Email</div>
        <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          required maxLength={254} autoComplete="email" />
        <div style={{ color: 'var(--text-muted, #6a806a)', fontSize: '0.7rem', marginTop: 4 }}>
          Used to confirm your RSVP and let you cancel it. Not shown publicly.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 120px' }}>
          <div style={label}>How many</div>
          <input style={input} type="number" min={1} max={20} value={guestCount}
            onChange={(e) => setGuestCount(e.target.value)} />
        </div>
        <div style={{ flex: '2 1 200px' }}>
          <div style={label}>Attending?</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[['going', 'Going'], ['maybe', 'Maybe'], ['not_going', "Can't"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setStatus(v)}
                style={{ ...btn(status === v), flex: 1, padding: '10px 8px' }}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {state.phase === 'error' && (
        <div style={{ color: 'var(--accent-orange, #ff6b35)', fontSize: '0.8rem', marginBottom: 10 }}>
          {state.message}
        </div>
      )}

      <button type="submit" disabled={state.phase === 'sending'} style={{ ...btn(true), width: '100%' }}>
        {state.phase === 'sending' ? 'Sending…' : 'Send RSVP'}
      </button>
    </form>
  );
};

// A visitor who already has a Cortex session on this server can RSVP as
// themselves instead of retyping their name and email. The public page is
// otherwise anonymous, so read the session directly rather than pulling in the
// whole auth context.
const readSession = () => {
  try {
    const token = localStorage.getItem('farhold_token');
    if (!token) return null;
    const user = JSON.parse(localStorage.getItem('farhold_user') || 'null');
    return user ? { token, user } : null;
  } catch { return null; }
};

const MemberRsvp = ({ session, eventId, onCounts, onGuestInstead }) => {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Existing RSVP, if any. A 403 here just means this member cannot see the
  // attendee list for the event — not that they cannot RSVP — so ignore it.
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/events/${encodeURIComponent(eventId)}/rsvp`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setStatus(d.userRsvp); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [eventId, session.token]);

  const send = async (next) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/events/${encodeURIComponent(eventId)}/rsvp`, {
        method: next === status ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: next === status ? undefined : JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not save your RSVP.'); return; }
      setStatus(next === status ? null : next);
      onCounts?.();
    } catch {
      setError('Could not reach the server.');
    } finally { setBusy(false); }
  };

  return (
    <div style={card}>
      <div style={{ ...label, marginBottom: 10, color: 'var(--accent-amber, #ffd23f)' }}>RSVP</div>
      <div style={{ color: 'var(--text-dim, #8aa08a)', fontSize: '0.85rem', marginBottom: 10 }}>
        Signed in as <span style={{ color: 'var(--text-primary, #d8e8d8)' }}>
          {session.user.displayName || session.user.handle}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {[['going', 'Going'], ['maybe', 'Maybe'], ['not_going', "Can't"]].map(([v, l]) => (
          <button key={v} type="button" disabled={busy} onClick={() => send(v)}
            style={{ ...btn(status === v), flex: 1, padding: '10px 8px' }}>{l}</button>
        ))}
      </div>
      {status && (
        <div style={{ color: 'var(--accent-green, #0ead69)', fontSize: '0.78rem', marginBottom: 8 }}>
          You're down as {status.replace('_', ' ')}. Tap it again to withdraw.
        </div>
      )}
      {error && <div style={{ color: 'var(--accent-orange, #ff6b35)', fontSize: '0.8rem', marginBottom: 8 }}>{error}</div>}
      <button type="button" onClick={onGuestInstead}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                 color: 'var(--accent-teal, #3bceac)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
        RSVP as someone else instead
      </button>
    </div>
  );
};

// ============ SINGLE EVENT ============

const EventDetail = ({ slug, eventId, onBack, navigate }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [counts, setCounts] = useState(null);
  const [cancelled, setCancelled] = useState(null);
  const [session] = useState(readSession);
  const [asGuest, setAsGuest] = useState(false);
  const { isMobile } = useWindowSize();

  // ?date= selects one occurrence of a repeating event; it is carried through
  // to the API and the .ics so every link refers to the same specific day.
  const occurrenceDate = new URLSearchParams(window.location.search).get('date');
  const dateQuery = occurrenceDate ? `?date=${encodeURIComponent(occurrenceDate)}` : '';
  const base = `${API_URL}/public/events/${encodeURIComponent(slug)}/${encodeURIComponent(eventId)}`;

  const loadCounts = useCallback(() => {
    fetch(`${base}${dateQuery}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setCounts(d.rsvpCounts); })
      .catch(() => {});
  }, [base, dateQuery]);

  useEffect(() => {
    let cancelledFetch = false;
    fetch(`${base}${dateQuery}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { if (!cancelledFetch) { setData(d); setCounts(d.rsvpCounts); } })
      .catch(() => { if (!cancelledFetch) setError('This event could not be found.'); });
    return () => { cancelledFetch = true; };
  }, [base, dateQuery]);

  // Cancellation links from confirmation emails land here as ?cancel=<token>.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('cancel');
    if (!token) return;
    fetch(`${API_URL}/public/events/rsvp/${encodeURIComponent(token)}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(d => setCancelled(d.removed ? 'done' : 'already'))
      .catch(() => setCancelled('error'));
  }, []);

  if (error) return <Shell><div style={card}>{error}</div></Shell>;
  if (!data) return <Shell><div style={{ ...card, color: 'var(--text-muted, #6a806a)' }}>Loading…</div></Shell>;

  const ev = data.event;
  const past = isPast(ev.date);

  return (
    <Shell
      title={data.waveTitle}
      slug={slug}
      navigate={navigate}
      onBack={onBack}
      // A server-wide event has no wave list to go back to, so its back button
      // goes to the index — it used to point at /events/server, which is not a
      // page and rendered "No event page found at this address."
      backLabel={slug === 'server' ? 'All events' : `${data.waveTitle || 'Wave'} events`}
    >
      {cancelled && (
        <div style={{ ...card, borderColor: 'var(--accent-orange, #ff6b35)' }}>
          {cancelled === 'done' && 'Your RSVP has been cancelled.'}
          {cancelled === 'already' && 'That cancellation link has already been used, or is no longer valid.'}
          {cancelled === 'error' && 'We could not cancel that RSVP. Please try the link again.'}
        </div>
      )}

      <div style={card}>
        <h1 style={{
          margin: '0 0 10px', color: 'var(--accent-amber, #ffd23f)',
          fontSize: isMobile ? '1.4rem' : '1.8rem', fontFamily: 'monospace', lineHeight: 1.2,
        }}>{ev.title}</h1>

        {past && (
          <div style={{ color: 'var(--text-muted, #6a806a)', fontSize: '0.75rem', marginBottom: 10 }}>
            This event has already taken place.
          </div>
        )}

        <div style={{ display: 'grid', gap: 10, marginBottom: ev.description ? 16 : 0 }}>
          <div>
            <div style={label}>When</div>
            <div style={{ color: 'var(--text-primary, #d8e8d8)' }}>
              {formatDay(ev.date)}<br />
              <span style={{ color: 'var(--text-dim, #8aa08a)' }}>{timeRange(ev)}</span>
              {ev.timezone && <span style={{ color: 'var(--text-muted, #6a806a)' }}> ({ev.timezone})</span>}
            </div>
          </div>
          {ev.location && (
            <div>
              <div style={label}>Where</div>
              <div style={{ color: 'var(--text-primary, #d8e8d8)' }}>{ev.location}</div>
            </div>
          )}
        </div>

        {ev.description && (
          <div style={{
            color: 'var(--text-secondary, #b8ccb8)', lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>{ev.description}</div>
        )}

        {ev.recurrence && (
          <div style={{ color: 'var(--text-muted, #6a806a)', fontSize: '0.72rem', marginTop: 10, fontFamily: 'monospace' }}>
            Repeats {ev.recurrence}{ev.recurrenceEndDate ? ` until ${formatDayShort(ev.recurrenceEndDate)}` : ''}
          </div>
        )}

        <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <a href={`${base}/ics${dateQuery}`} style={{ ...btn(false), textDecoration: 'none', display: 'inline-block' }}>
            ↓ .ics (Apple / Outlook)
          </a>
          {/* Built server-side from the occurrence being viewed, so adding a
              particular week of a repeating event adds that week. */}
          {ev.googleCalendarUrl && (
            <a href={ev.googleCalendarUrl} target="_blank" rel="noopener noreferrer"
               style={{ ...btn(false), textDecoration: 'none', display: 'inline-block' }}>
              + Google Calendar
            </a>
          )}
          {ev.rsvpEnabled && <RsvpCounts counts={counts} />}
        </div>
      </div>

      {ev.rsvpEnabled && !past && (
        session && !asGuest
          ? <MemberRsvp session={session} eventId={ev.id} onCounts={loadCounts}
              onGuestInstead={() => setAsGuest(true)} />
          : <RsvpForm slug={slug} eventId={ev.id} onCounts={setCounts} />
      )}
    </Shell>
  );
};

// ============ EVENT LIST ============

const EventList = ({ slug, onOpen, navigate }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { isMobile } = useWindowSize();

  const load = useCallback(() => {
    fetch(`${API_URL}/public/events/${encodeURIComponent(slug)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setData)
      .catch(() => setError('No event page found at this address.'));
  }, [slug]);

  useEffect(load, [load]);

  if (error) return <Shell><div style={card}>{error}</div></Shell>;
  if (!data) return <Shell><div style={{ ...card, color: 'var(--text-muted, #6a806a)' }}>Loading…</div></Shell>;

  return (
    <Shell title={data.title} slug={slug} navigate={navigate}>
      {data.topic && (
        <div style={{ color: 'var(--text-dim, #8aa08a)', marginBottom: 18, lineHeight: 1.5 }}>{data.topic}</div>
      )}

      {data.events.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <a href={`${API_URL}/public/events/${encodeURIComponent(slug)}/calendar.ics`}
             style={{ ...btn(false), textDecoration: 'none', display: 'inline-block' }}>
            + Subscribe to this calendar
          </a>
        </div>
      )}

      {data.events.length === 0 ? (
        <div style={{ ...card, color: 'var(--text-muted, #6a806a)' }}>
          No upcoming events. Check back soon.
        </div>
      ) : data.events.map(ev => (
        <div
          key={`${ev.id}-${ev.date}`}
          onClick={() => onOpen(ev.id, ev.isOccurrence ? ev.date : null)}
          role="link"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(ev.id, ev.isOccurrence ? ev.date : null); } }}
          style={{ ...card, cursor: 'pointer', display: 'flex', gap: 16, alignItems: 'flex-start' }}
        >
          <div style={{
            flexShrink: 0, textAlign: 'center', minWidth: 58,
            borderRight: '1px solid var(--border-subtle, #1a2a1a)', paddingRight: 14,
          }}>
            <div style={{ color: 'var(--accent-amber, #ffd23f)', fontFamily: 'monospace', fontSize: '1.1rem' }}>
              {formatDayShort(ev.date)}
            </div>
            <div style={{ color: 'var(--text-muted, #6a806a)', fontSize: '0.7rem', fontFamily: 'monospace' }}>
              {formatTime(ev.time) || 'All day'}
            </div>
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              color: 'var(--text-primary, #d8e8d8)', fontSize: isMobile ? '1rem' : '1.1rem',
              marginBottom: 4, wordBreak: 'break-word',
            }}>{ev.title}</div>
            {ev.location && (
              <div style={{ color: 'var(--text-dim, #8aa08a)', fontSize: '0.8rem', marginBottom: 4 }}>
                {ev.location}
              </div>
            )}
            {ev.rsvpEnabled && <RsvpCounts counts={ev.rsvpCounts} />}
          </div>
        </div>
      ))}
    </Shell>
  );
};

// ============ INDEX: everything published across the instance ============

const EventIndex = ({ navigate }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const { isMobile } = useWindowSize();

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/public/events`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError('Events are not available on this server.'); });
    return () => { cancelled = true; };
  }, []);

  if (error) return <Shell><div style={card}>{error}</div></Shell>;
  if (!data) return <Shell><div style={{ ...card, color: 'var(--text-muted, #6a806a)' }}>Loading…</div></Shell>;

  // Group by day so a date reads once rather than on every row.
  const days = [];
  for (const ev of data.events) {
    const last = days[days.length - 1];
    if (last && last.date === ev.date) last.events.push(ev);
    else days.push({ date: ev.date, events: [ev] });
  }

  return (
    <Shell title="What's on" slug="index" navigate={navigate}>
      {days.length === 0 ? (
        <div style={{ ...card, color: 'var(--text-muted, #6a806a)' }}>
          No upcoming events. Check back soon.
        </div>
      ) : days.map(day => (
        <div key={day.date} style={{ marginBottom: 18 }}>
          <div style={{
            ...label, color: 'var(--accent-amber, #ffd23f)', marginBottom: 8,
            borderBottom: '1px solid var(--border-subtle, #1a2a1a)', paddingBottom: 5,
          }}>{formatDay(day.date)}</div>

          {day.events.map(ev => (
            <div
              key={ev.id}
              onClick={() => navigate(ev.href)}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(ev.href); } }}
              style={{ ...card, cursor: 'pointer', marginBottom: 8, display: 'flex', gap: 14, alignItems: 'flex-start' }}
            >
              <div style={{
                flexShrink: 0, minWidth: 72, color: 'var(--text-dim, #8aa08a)',
                fontFamily: 'monospace', fontSize: '0.8rem', paddingTop: 2,
              }}>{formatTime(ev.time) || 'All day'}</div>

              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  color: 'var(--text-primary, #d8e8d8)', fontSize: isMobile ? '0.95rem' : '1.05rem',
                  marginBottom: 3, wordBreak: 'break-word',
                }}>{ev.title}</div>
                <div style={{ color: 'var(--text-muted, #6a806a)', fontSize: '0.72rem', fontFamily: 'monospace' }}>
                  {ev.scope === 'server' ? 'Server-wide' : ev.source}
                  {ev.location ? ` · ${ev.location}` : ''}
                </div>
                {ev.rsvpEnabled && <div style={{ marginTop: 4 }}><RsvpCounts counts={ev.rsvpCounts} /></div>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </Shell>
  );
};

// ============ SHELL ============

const Shell = ({ children, title, slug, onBack, backLabel, navigate }) => (
  <div style={{
    minHeight: '100vh',
    background: 'var(--bg-base, #050805)',
    color: 'var(--text-primary, #d8e8d8)',
    fontFamily: 'var(--app-font, "Courier New", monospace)',
    padding: isEmbed ? '12px' : '28px 16px 60px',
  }}>
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {!isEmbed && (
        <div style={{ marginBottom: 22 }}>
          {onBack ? (
            <button onClick={onBack} style={{ ...btn(false), marginBottom: 14 }}>
              ← {backLabel || 'Back'}
            </button>
          ) : null}
          {title && (
            <div style={{
              color: 'var(--accent-amber, #ffd23f)', fontSize: '0.75rem',
              letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'monospace',
            }}>{title} · Events</div>
          )}
          {/* Every wave/event page offers a way up to everything published on
              the server; without it a visitor who arrives on a shared link has
              no idea the rest exists. */}
          {slug && slug !== 'index' && (
            <button
              onClick={() => (navigate ? navigate('/events') : (window.location.href = '/events'))}
              style={{
                marginTop: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: 'var(--accent-teal, #3bceac)', fontFamily: 'monospace', fontSize: '0.72rem',
              }}
            >
              See all events on this server →
            </button>
          )}
        </div>
      )}
      {children}
      {!isEmbed && slug && (
        <div style={{ marginTop: 30, color: 'var(--text-muted, #6a806a)', fontSize: '0.7rem' }}>
          Powered by <a href="/" style={{ color: 'var(--accent-teal, #3bceac)' }}>Cortex</a>
        </div>
      )}
    </div>
  </div>
);

// ============ ENTRY ============

const PublicEventsView = ({ slug, eventId, navigate }) => {
  // /events — everything published, across every wave plus server-wide events.
  if (!slug) return <EventIndex navigate={navigate} />;

  if (eventId) {
    return (
      <EventDetail
        slug={slug}
        eventId={eventId}
        navigate={navigate}
        onBack={() => navigate(slug === 'server' ? '/events' : `/events/${slug}`)}
      />
    );
  }
  return (
    <EventList
      slug={slug}
      navigate={navigate}
      onOpen={(id, date) => navigate(`/events/${slug}/${id}${date ? `?date=${date}` : ''}`)}
    />
  );
};

export default PublicEventsView;
