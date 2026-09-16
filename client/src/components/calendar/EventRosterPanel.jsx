import React, { useState, useEffect, useCallback } from 'react';
import { T } from '../../config/terminology.js';

/**
 * The organiser's view of one occurrence (v2.90.0).
 *
 * The column that justifies this whole feature is NO RESPONSE. Cortex could
 * already show who said yes; it could not show who had been asked and said
 * nothing, which is the only list an organiser actually needs to act on.
 */
const STATUS_LABEL = {
  going: '✓ Going',
  maybe: '? Maybe',
  not_going: '✕ Declined',
};
const STATUS_COLOR = {
  going: 'var(--accent-green)',
  maybe: 'var(--accent-amber)',
  not_going: 'var(--accent-red, #ff4444)',
};

const EventRosterPanel = ({ eventId, occurrenceDate, fetchAPI, showToast }) => {
  const [data, setData] = useState(null);
  const [crews, setCrews] = useState([]);
  const [busy, setBusy] = useState(false);
  const [handle, setHandle] = useState('');
  const [crewId, setCrewId] = useState('');

  const load = useCallback(() => {
    fetchAPI(`/events/${eventId}/roster?date=${encodeURIComponent(occurrenceDate)}`)
      .then(setData)
      .catch(() => setData(null));
  }, [eventId, occurrenceDate, fetchAPI]);

  useEffect(() => { load(); }, [load]);

  // Fetched here rather than threaded through three components, so the panel
  // can be dropped anywhere an event is shown.
  useEffect(() => {
    fetchAPI('/groups')
      .then(res => setCrews(Array.isArray(res) ? res : (res?.groups || [])))
      .catch(() => setCrews([]));
  }, [fetchAPI]);

  if (!data) return null;
  const { counts, roster, invitedCount, capacity, canManage } = data;

  const act = async (fn, successMsg) => {
    setBusy(true);
    try {
      const result = await fn();
      if (result?.roster) setData(d => ({ ...d, ...result }));
      else load();
      if (successMsg) showToast(successMsg, 'success');
    } catch (err) {
      showToast(err.message || 'Something went wrong', 'error');
    }
    setBusy(false);
  };

  const inviteHandle = async () => {
    const wanted = handle.trim().replace(/^@/, '');
    if (!wanted) return;
    const results = await fetchAPI(`/users/search?q=${encodeURIComponent(wanted)}&limit=5`);
    const list = Array.isArray(results) ? results : (results?.users || []);
    const match = list.find(u => (u.handle || '').toLowerCase() === wanted.toLowerCase());
    if (!match) { showToast(`No user @${wanted}`, 'error'); return; }
    setHandle('');
    await act(() => fetchAPI(`/events/${eventId}/invites`, {
      method: 'POST', body: { userIds: [match.id || match.userId], date: occurrenceDate },
    }), `Invited @${wanted}`);
  };

  const inviteCrew = async () => {
    if (!crewId) return;
    await act(() => fetchAPI(`/events/${eventId}/invites`, {
      method: 'POST', body: { crewIds: [crewId], date: occurrenceDate },
    }), 'Crew invited');
  };

  const remind = () => act(
    () => fetchAPI(`/events/${eventId}/remind`, { method: 'POST', body: { date: occurrenceDate } })
      .then(r => { showToast(r.reminded ? `Reminded ${r.reminded}` : 'Nobody to remind', 'success'); return null; }),
  );

  const setAttended = (userId, attended) => act(
    () => fetchAPI(`/events/${eventId}/attendance`, {
      method: 'POST', body: { date: occurrenceDate, entries: [{ userId, attended }] },
    }),
  );

  const removeInvite = (userId) => act(
    () => fetchAPI(`/events/${eventId}/invites/${userId}?date=${encodeURIComponent(occurrenceDate)}`, { method: 'DELETE' }),
    'Removed from the list',
  );

  const chip = (label, value, color) => (
    <div style={{
      padding: '6px 10px', background: 'var(--bg-elevated)',
      border: `1px solid ${color || 'var(--border-subtle)'}`, minWidth: '64px', textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.1rem', color: color || 'var(--text-primary)' }}>{value}</div>
      <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );

  return (
    <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', letterSpacing: '0.1em', marginBottom: '8px' }}>
        WHO WAS ASKED — {occurrenceDate}
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
        {chip('GOING', counts.going, 'var(--accent-green)')}
        {chip('MAYBE', counts.maybe, 'var(--accent-amber)')}
        {chip('NO', counts.not_going, 'var(--accent-red, #ff4444)')}
        {/* The point of the feature: the people who have said nothing at all. */}
        {chip('NO REPLY', counts.no_response, counts.no_response > 0 ? 'var(--accent-amber)' : null)}
        {capacity ? chip('CAPACITY', `${counts.going}/${capacity}`) : null}
        {counts.waitlisted > 0 ? chip('WAITING', counts.waitlisted) : null}
        {counts.attended > 0 ? chip('CAME', counts.attended, 'var(--accent-teal)') : null}
      </div>

      {canManage && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <input
            type="text" value={handle} placeholder="handle" disabled={busy}
            onChange={e => setHandle(e.target.value)}
            style={{
              flex: '1 1 110px', minWidth: 0, padding: '7px 9px', background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
              fontFamily: 'inherit', fontSize: '0.78rem',
            }}
          />
          <button onClick={inviteHandle} disabled={busy || !handle.trim()} style={btn}>+ PERSON</button>
          {crews.length > 0 && (
            <>
              <select value={crewId} onChange={e => setCrewId(e.target.value)} disabled={busy} style={{
                flex: '1 1 110px', minWidth: 0, padding: '7px 9px', background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)', color: 'var(--text-primary)',
                fontFamily: 'inherit', fontSize: '0.78rem',
              }}>
                <option value="">{T.crew}…</option>
                {crews.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button onClick={inviteCrew} disabled={busy || !crewId} style={btn}>+ {T.CREW}</button>
            </>
          )}
          <button
            onClick={remind}
            disabled={busy || counts.no_response === 0}
            title={counts.no_response === 0 ? 'Everyone has answered' : `Nudge ${counts.no_response}`}
            style={{ ...btn, borderColor: counts.no_response > 0 ? 'var(--accent-amber)' : 'var(--border-subtle)' }}
          >
            NUDGE {counts.no_response > 0 ? counts.no_response : ''}
          </button>
        </div>
      )}

      {invitedCount === 0 && (
        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontStyle: 'italic' }}>
          Nobody invited yet. Until someone is, there is no one to chase.
        </div>
      )}

      {roster.map(person => (
        <div key={person.user_id} style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 9px', marginBottom: '4px',
          background: 'var(--bg-elevated)',
          borderLeft: `2px solid ${person.status ? STATUS_COLOR[person.status] : 'var(--accent-amber)'}`,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {person.display_name || person.handle}
            </div>
            <div style={{ fontSize: '0.66rem', color: 'var(--text-dim)' }}>
              {person.status ? STATUS_LABEL[person.status] : 'No reply yet'}
              {person.waitlisted ? ' · waiting list' : ''}
              {person.invited_via !== 'direct' ? ` · via ${T.crew}` : ''}
            </div>
          </div>
          {canManage && (
            <>
              <button
                onClick={() => setAttended(person.user_id, !person.attended)}
                disabled={busy}
                title={person.attended ? 'Mark as absent' : 'Mark as attended'}
                aria-label={`${person.attended ? 'Mark absent' : 'Mark attended'}: ${person.display_name || person.handle}`}
                style={{
                  ...btn,
                  color: person.attended ? 'var(--accent-teal)' : 'var(--text-dim)',
                  borderColor: person.attended ? 'var(--accent-teal)' : 'var(--border-subtle)',
                }}
              >{person.attended ? '☑ CAME' : '☐ CAME'}</button>
              <button onClick={() => removeInvite(person.user_id)} disabled={busy}
                title="Remove from the invite list" aria-label={`Remove ${person.display_name || person.handle}`}
                style={{ ...btn, color: 'var(--text-dim)' }}>✕</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
};

const btn = {
  padding: '7px 9px', background: 'transparent', border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.68rem',
  letterSpacing: '0.05em', whiteSpace: 'nowrap',
};

export default EventRosterPanel;
