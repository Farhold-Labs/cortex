import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { API_URL } from '../../config/constants.js';

const PublicPortalAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [portalWaves, setPortalWaves] = useState([]);
  const [allWaves, setAllWaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedWaveId, setSelectedWaveId] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [portalData, wavesData] = await Promise.all([
        fetchAPI('/admin/portal'),
        fetchAPI('/admin/portal/waves'),
      ]);
      const portalIds = new Set((portalData.waves || []).map(w => w.waveId));
      setPortalWaves(portalData.waves || []);
      setAllWaves((wavesData.waves || []).filter(w => !portalIds.has(w.id)));
    } catch (err) {
      showToast(err.message || 'Failed to load portal settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const handleAdd = async () => {
    if (!selectedWaveId) return;
    setAdding(true);
    try {
      await fetchAPI('/admin/portal', { method: 'POST', body: { waveId: selectedWaveId, label: label.trim() || undefined } });
      showToast('Wave added to portal', 'success');
      setSelectedWaveId('');
      setLabel('');
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to add wave', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (waveId) => {
    try {
      await fetchAPI(`/admin/portal/${waveId}`, { method: 'DELETE' });
      showToast('Wave removed from portal', 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to remove wave', 'error');
    }
  };

  const handleUpdateLabel = async (waveId, newLabel) => {
    try {
      await fetchAPI(`/admin/portal/${waveId}`, { method: 'PATCH', body: { label: newLabel.trim() || null } });
      showToast('Label updated', 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to update label', 'error');
    }
  };

  // v2.68.0 — slug and events switch. The server normalises and validates the
  // slug, so surface its message rather than guessing client-side.
  const handleUpdateEvents = async (waveId, patch) => {
    try {
      const res = await fetchAPI(`/admin/portal/${waveId}`, { method: 'PATCH', body: patch });
      showToast(patch.slug !== undefined ? `Event page: /events/${res.slug || '—'}` : 'Updated', 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to update', 'error');
    }
  };

  const embedSnippet = (waveId) =>
    `<iframe\n  src="${window.location.origin}/portal?wave=${waveId}&embed=1"\n  width="100%"\n  height="600"\n  frameborder="0"\n  style="border:none;"\n></iframe>`;

  const copySnippet = (waveId) => {
    navigator.clipboard.writeText(embedSnippet(waveId)).then(() => {
      setCopiedId(waveId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const inputStyle = {
    padding: '6px 10px', background: 'var(--bg-base)',
    border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
    fontFamily: 'monospace', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box',
  };

  const smallBtnStyle = (color = 'var(--border-primary)', textColor = 'var(--text-dim)') => ({
    padding: isMobile ? '8px 12px' : '6px 10px',
    background: 'transparent', border: `1px solid ${color}`,
    color: textColor, cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem',
  });

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-teal)40',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', fontWeight: 500 }}>
          🌐 PUBLIC PORTAL
        </div>
        <button onClick={onToggle} style={{
          ...smallBtnStyle(
            isOpen ? 'var(--accent-teal)' : 'var(--border-primary)',
            isOpen ? 'var(--accent-teal)' : 'var(--text-dim)'
          ),
          background: isOpen ? 'var(--accent-teal)20' : 'transparent',
        }}>
          {isOpen ? '▼ HIDE' : '▶ SHOW'}
        </button>
      </div>

      {isOpen && (
        <div style={{ marginTop: '16px' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'monospace', margin: '0 0 16px 0' }}>
            Waves added here are readable at{' '}
            <a href="/portal" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-amber)' }}>
              {window.location.origin}/portal
            </a>{' '}
            without login. E2EE-encrypted waves cannot be added.
          </p>

          {/* Add wave form */}
          <div style={{ marginBottom: 20, padding: 14, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: 10, fontFamily: 'monospace' }}>
              ADD WAVE TO PORTAL
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 4, fontFamily: 'monospace' }}>WAVE</div>
              <select value={selectedWaveId} onChange={e => setSelectedWaveId(e.target.value)} style={inputStyle}>
                <option value="">— select a wave —</option>
                {allWaves.map(w => (
                  <option key={w.id} value={w.id}>{w.title} ({w.privacy})</option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 4, fontFamily: 'monospace' }}>DISPLAY LABEL (optional)</div>
              <input
                type="text"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Leave blank to use wave title"
                style={inputStyle}
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={!selectedWaveId || adding}
              style={{
                padding: '6px 16px', background: selectedWaveId ? 'var(--accent-green)' : 'var(--bg-hover)',
                border: 'none', color: selectedWaveId ? '#000' : 'var(--text-muted)',
                cursor: selectedWaveId ? 'pointer' : 'default',
                fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 'bold',
              }}
            >
              {adding ? 'Adding...' : 'Add to Portal'}
            </button>
          </div>

          {/* Portal wave list */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><LoadingSpinner /></div>
          ) : portalWaves.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.8rem', textAlign: 'center', margin: '24px 0' }}>
              No waves in portal yet.
            </p>
          ) : (
            portalWaves.map(w => (
              <PortalWaveRow
                key={w.waveId}
                wave={w}
                onRemove={() => handleRemove(w.waveId)}
                onUpdateLabel={(lbl) => handleUpdateLabel(w.waveId, lbl)}
                onUpdateEvents={(patch) => handleUpdateEvents(w.waveId, patch)}
                fetchAPI={fetchAPI}
                showToast={showToast}
                embedSnippet={embedSnippet(w.waveId)}
                onCopy={() => copySnippet(w.waveId)}
                copied={copiedId === w.waveId}
                isMobile={isMobile}
                inputStyle={inputStyle}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

const PortalWaveRow = ({ wave, onRemove, onUpdateLabel, onUpdateEvents, embedSnippet, onCopy, copied, isMobile, inputStyle, fetchAPI, showToast }) => {
  const [editLabel, setEditLabel] = useState(wave.label || '');
  const [showEmbed, setShowEmbed] = useState(false);
  const [editSlug, setEditSlug] = useState(wave.slug || '');
  const [showAttendees, setShowAttendees] = useState(false);

  const rowBtnStyle = (variant) => ({
    padding: isMobile ? '6px 10px' : '4px 10px',
    background: 'transparent',
    border: `1px solid ${variant === 'danger' ? 'var(--accent-orange)' : variant === 'amber' ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
    color: variant === 'danger' ? 'var(--accent-orange)' : variant === 'amber' ? 'var(--accent-amber)' : 'var(--text-dim)',
    cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem',
  });

  return (
    <div style={{ marginBottom: 10, padding: 12, background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
        <div>
          <span style={{ color: 'var(--text-primary)', fontWeight: 'bold', fontFamily: 'monospace', fontSize: '0.85rem' }}>
            {wave.label || wave.title}
          </span>
          {wave.label && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontFamily: 'monospace', marginLeft: 8 }}>
              ({wave.title})
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowEmbed(v => !v)} style={rowBtnStyle('amber')}>
            {showEmbed ? 'HIDE EMBED' : 'EMBED'}
          </button>
          <button onClick={onRemove} style={rowBtnStyle('danger')}>REMOVE</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 4, fontFamily: 'monospace' }}>DISPLAY LABEL</div>
          <input
            type="text"
            value={editLabel}
            onChange={e => setEditLabel(e.target.value)}
            placeholder={wave.title}
            style={inputStyle}
          />
        </div>
        <button
          onClick={() => onUpdateLabel(editLabel)}
          style={{
            padding: '6px 12px', background: 'var(--accent-green)', border: 'none',
            color: '#000', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 'bold',
            whiteSpace: 'nowrap',
          }}
        >
          Save
        </button>
      </div>

      {/* v2.68.0 — public event page */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 4, fontFamily: 'monospace' }}>
              EVENT PAGE SLUG
            </div>
            <input
              type="text"
              value={editSlug}
              onChange={e => setEditSlug(e.target.value)}
              placeholder="e.g. news"
              style={inputStyle}
            />
          </div>
          <button
            onClick={() => onUpdateEvents({ slug: editSlug.trim() || null })}
            style={{
              padding: '6px 12px', background: 'var(--accent-green)', border: 'none',
              color: '#000', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem',
              fontWeight: 'bold', whiteSpace: 'nowrap',
            }}
          >
            Save slug
          </button>
          <button
            onClick={() => onUpdateEvents({ eventsEnabled: !wave.eventsEnabled })}
            style={rowBtnStyle(wave.eventsEnabled ? 'amber' : undefined)}
          >
            {wave.eventsEnabled ? '\u2713 EVENTS PUBLISHED' : 'PUBLISH EVENTS'}
          </button>
        </div>

        {wave.slug && wave.eventsEnabled ? (
          <div style={{ marginTop: 6, fontSize: '0.72rem', fontFamily: 'monospace' }}>
            <a href={`/events/${wave.slug}`} target="_blank" rel="noopener noreferrer"
               style={{ color: 'var(--accent-amber)' }}>
              {window.location.origin}/events/{wave.slug}
            </a>
          </div>
        ) : (
          <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: '0.7rem', fontFamily: 'monospace' }}>
            {wave.slug ? 'Slug set — switch on PUBLISH EVENTS to make the page live.'
                       : 'Give the wave a slug to publish its calendar events publicly.'}
          </div>
        )}

        <button onClick={() => setShowAttendees(v => !v)} style={{ ...rowBtnStyle(), marginTop: 8 }}>
          {showAttendees ? 'HIDE RSVPS' : 'VIEW RSVPS'}
        </button>
        {showAttendees && (
          <AttendeeList waveId={wave.waveId} fetchAPI={fetchAPI} showToast={showToast} rowBtnStyle={rowBtnStyle} />
        )}
      </div>

      {showEmbed && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 4, fontFamily: 'monospace' }}>EMBED SNIPPET</div>
          <pre style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
            padding: '8px 10px', fontSize: '0.72rem', color: 'var(--text-secondary)',
            overflowX: 'auto', margin: '0 0 8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            fontFamily: 'monospace',
          }}>
            {embedSnippet}
          </pre>
          <button onClick={onCopy} style={rowBtnStyle('amber')}>
            {copied ? '✓ COPIED' : 'COPY SNIPPET'}
          </button>
        </div>
      )}
    </div>
  );
};


// Lists this wave's events with their RSVP tallies, and expands to the actual
// attendee list on demand. Guest emails are personal data, so they are only
// fetched when a moderator asks for a specific event — never listed wholesale.
const AttendeeList = ({ waveId, fetchAPI, showToast, rowBtnStyle }) => {
  const [events, setEvents] = useState(null);
  const [openEventId, setOpenEventId] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchAPI(`/events/wave/${waveId}`)
      .then(d => { if (!cancelled) setEvents(d.events || d || []); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [waveId, fetchAPI]);

  const openEvent = async (eventId) => {
    if (openEventId === eventId) { setOpenEventId(null); setDetail(null); return; }
    setOpenEventId(eventId);
    setDetail(null);
    try {
      setDetail(await fetchAPI(`/admin/events/${eventId}/attendees`));
    } catch (err) {
      showToast(err.message || 'Failed to load RSVPs', 'error');
      setOpenEventId(null);
    }
  };

  const downloadCsv = async (eventId) => {
    try {
      // fetchAPI parses JSON, so go direct for a file download.
      const token = localStorage.getItem('farhold_token');
      const res = await fetch(`${API_URL}/admin/events/${eventId}/attendees?format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rsvps-${eventId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message || 'Export failed', 'error');
    }
  };

  const cell = { padding: '4px 8px', fontFamily: 'monospace', fontSize: '0.72rem', textAlign: 'left' };

  if (!events) return <div style={{ ...cell, color: 'var(--text-muted)' }}>Loading events…</div>;
  if (!events.length) return <div style={{ ...cell, color: 'var(--text-muted)' }}>This wave has no calendar events.</div>;

  return (
    <div style={{ marginTop: 8 }}>
      {events.map(ev => (
        <div key={ev.id} style={{ borderTop: '1px solid var(--border-subtle)', padding: '6px 0' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.75rem', flex: 1, minWidth: 0 }}>
              {ev.eventDate || ev.event_date} — {ev.title}
            </span>
            {(ev.rsvpEnabled ?? ev.rsvp_enabled) ? (
              <>
                <button onClick={() => openEvent(ev.id)} style={rowBtnStyle()}>
                  {openEventId === ev.id ? 'HIDE' : 'RSVPS'}
                </button>
                <button onClick={() => downloadCsv(ev.id)} style={rowBtnStyle()}>CSV</button>
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontFamily: 'monospace' }}>no RSVP</span>
            )}
          </div>

          {openEventId === ev.id && (
            detail ? (
              <div style={{ marginTop: 6 }}>
                <div style={{ color: 'var(--accent-green)', fontSize: '0.72rem', fontFamily: 'monospace', marginBottom: 4 }}>
                  {detail.counts.going} going · {detail.counts.guests} attending · {detail.counts.maybe} maybe
                </div>
                {detail.guests.length === 0 ? (
                  <div style={{ ...cell, color: 'var(--text-muted)' }}>No RSVPs yet.</div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--text-muted)' }}>
                          <th style={cell}>Name</th><th style={cell}>Email</th>
                          <th style={cell}>Party</th><th style={cell}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.guests.map(g => (
                          <tr key={g.id} style={{ color: 'var(--text-secondary)' }}>
                            <td style={cell}>{g.name}</td>
                            <td style={cell}>{g.email || '—'}</td>
                            <td style={cell}>{g.guestCount}</td>
                            <td style={cell}>{g.status.replace('_', ' ')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ ...cell, color: 'var(--text-muted)' }}>Loading RSVPs…</div>
            )
          )}
        </div>
      ))}
    </div>
  );
};

export default PublicPortalAdminPanel;
