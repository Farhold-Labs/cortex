import React, { useState, useEffect } from 'react';

const CATEGORIES = ['general','birthday','holiday','community'];
const SCOPES = [
  { value: 'personal', label: 'Personal (only you)' },
  { value: 'wave',     label: 'Wave' },
  { value: 'server',   label: 'Server-Wide (mod+)' },
];

const EventCreateModal = ({ onClose, fetchAPI, showToast, currentUser, waves = [], initialDate = '', editEvent = null, onSaved }) => {
  const [title,       setTitle]       = useState(editEvent?.title       || '');
  const [description, setDescription] = useState(editEvent?.description || '');
  const [eventDate,   setEventDate]   = useState(editEvent?.eventDate   || initialDate);
  const [eventTime,   setEventTime]   = useState(editEvent?.eventTime   || '');
  const [eventEndTime,setEventEndTime]= useState(editEvent?.eventEndTime|| '');
  const [location,    setLocation]    = useState(editEvent?.location    || '');
  const [category,    setCategory]    = useState(editEvent?.category    || 'general');
  const [scope,       setScope]       = useState(editEvent?.scope       || 'personal');
  const [waveId,      setWaveId]      = useState(editEvent?.waveId      || '');
  const [recurring,   setRecurring]   = useState(editEvent?.recurring   || false);
  const [rsvpEnabled, setRsvpEnabled] = useState(editEvent?.rsvpEnabled || false);
  const [saving,      setSaving]      = useState(false);

  // When recurring toggles, reset date
  useEffect(() => { if (!editEvent) setEventDate(''); }, [recurring, editEvent]);

  const canServerScope = currentUser?.role === 'admin' || currentUser?.role === 'moderator';

  const handleSave = async () => {
    if (!title.trim()) { showToast('Title is required', 'error'); return; }
    if (!eventDate.trim()) { showToast('Date is required', 'error'); return; }
    if (scope === 'wave' && !waveId) { showToast('Select a wave', 'error'); return; }
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || null,
        eventDate: eventDate.trim(),
        eventTime: eventTime || null,
        eventEndTime: eventEndTime || null,
        location: location.trim() || null,
        category,
        scope,
        waveId: scope === 'wave' ? waveId : null,
        recurring,
        rsvpEnabled,
      };
      let event;
      if (editEvent) {
        const data = await fetchAPI(`/events/${editEvent.id}`, { method: 'PUT', body });
        event = data.event;
        showToast('Event updated', 'success');
      } else {
        const data = await fetchAPI('/events', { method: 'POST', body });
        event = data.event;
        showToast('Event created', 'success');
      }
      onSaved?.(event);
      onClose();
    } catch (err) {
      showToast(err.message || 'Failed to save event', 'error');
    }
    setSaving(false);
  };

  const inputStyle = {
    width: '100%', padding: '8px 10px', boxSizing: 'border-box',
    background: 'var(--bg-surface)', border: '1px solid var(--border-primary)',
    color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '0.85rem',
  };
  const labelStyle = {
    display: 'block', color: 'var(--text-dim)', fontSize: '0.7rem',
    marginBottom: '4px', letterSpacing: '1px', fontFamily: 'monospace',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.85)', padding: '16px',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--accent-amber)',
        maxWidth: '500px', width: '100%', maxHeight: '90vh', overflow: 'auto',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px' }}>
          <h3 style={{ margin: '0 0 20px', color: 'var(--accent-amber)', fontFamily: 'monospace', fontSize: '1rem' }}>
            {editEvent ? 'EDIT EVENT' : 'NEW EVENT'}
          </h3>

          {/* Title */}
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>TITLE *</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value.slice(0, 100))}
              maxLength={100} style={inputStyle} placeholder="Event title..." autoFocus />
          </div>

          {/* Scope */}
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>SCOPE</label>
            <select value={scope} onChange={e => setScope(e.target.value)} style={inputStyle}>
              {SCOPES.filter(s => s.value !== 'server' || canServerScope).map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Wave picker (wave scope only) */}
          {scope === 'wave' && (
            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>WAVE *</label>
              <select value={waveId} onChange={e => setWaveId(e.target.value)} style={inputStyle}>
                <option value="">Select a wave...</option>
                {waves.map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
              </select>
            </div>
          )}

          {/* Recurring toggle */}
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} />
              <span style={{ ...labelStyle, margin: 0 }}>RECURRING (yearly)</span>
            </label>
          </div>

          {/* Date */}
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>DATE * <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({recurring ? 'MM-DD' : 'YYYY-MM-DD'})</span></label>
            {recurring ? (
              <input type="text" value={eventDate} onChange={e => setEventDate(e.target.value)}
                maxLength={5} placeholder="03-14" style={{ ...inputStyle, width: '100px' }} />
            ) : (
              <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} style={inputStyle} />
            )}
          </div>

          {/* Time */}
          {!recurring && (
            <div style={{ marginBottom: '12px', display: 'flex', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>START TIME</label>
                <input type="time" value={eventTime} onChange={e => setEventTime(e.target.value)} style={inputStyle} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>END TIME</label>
                <input type="time" value={eventEndTime} onChange={e => setEventEndTime(e.target.value)} style={inputStyle} />
              </div>
            </div>
          )}

          {/* Location */}
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>LOCATION</label>
            <input type="text" value={location} onChange={e => setLocation(e.target.value.slice(0, 200))}
              maxLength={200} placeholder="Optional location..." style={inputStyle} />
          </div>

          {/* Category */}
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>CATEGORY</label>
            <select value={category} onChange={e => setCategory(e.target.value)} style={inputStyle}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </select>
          </div>

          {/* Description */}
          <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>DESCRIPTION</label>
            <textarea value={description} onChange={e => setDescription(e.target.value.slice(0, 500))}
              maxLength={500} rows={3} placeholder="Optional description..."
              style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {/* RSVP */}
          {!recurring && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="checkbox" checked={rsvpEnabled} onChange={e => setRsvpEnabled(e.target.checked)} />
                <span style={{ ...labelStyle, margin: 0 }}>ENABLE RSVP</span>
              </label>
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{
              padding: '10px 16px', background: 'transparent', fontFamily: 'monospace', fontSize: '0.8rem',
              border: '1px solid var(--border-secondary)', color: 'var(--text-secondary)', cursor: 'pointer',
            }}>CANCEL</button>
            <button onClick={handleSave} disabled={saving} style={{
              padding: '10px 16px', background: 'var(--accent-amber)20', fontFamily: 'monospace', fontSize: '0.8rem',
              border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)',
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
            }}>
              {saving ? 'SAVING...' : (editEvent ? 'UPDATE' : 'CREATE')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventCreateModal;
