import React, { useState, useEffect, useCallback } from 'react';
import { formatError } from '../../../messages.js';

const EventsAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formEventDate, setFormEventDate] = useState('');
  const [formRecurring, setFormRecurring] = useState(false);
  const [formCategory, setFormCategory] = useState('general');

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI('/admin/events');
      setEvents(data.events || []);
    } catch (err) {
      if (!err.message?.includes('401')) {
        showToast(err.message || formatError('Failed to load events'), 'error');
      }
    }
    setLoading(false);
  }, [fetchAPI, showToast]);

  useEffect(() => {
    if (isOpen && events.length === 0) {
      loadEvents();
    }
  }, [isOpen, events.length, loadEvents]);

  const resetForm = () => {
    setFormTitle('');
    setFormDescription('');
    setFormEventDate('');
    setFormRecurring(false);
    setFormCategory('general');
    setEditingEvent(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const openEditModal = (event) => {
    setEditingEvent(event);
    setFormTitle(event.title);
    setFormDescription(event.description || '');
    setFormEventDate(event.eventDate);
    setFormRecurring(event.recurring);
    setFormCategory(event.category || 'general');
    setShowCreateModal(true);
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formEventDate.trim()) {
      showToast('Title and date are required', 'error');
      return;
    }

    setSaving(true);
    try {
      const body = {
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        eventDate: formEventDate.trim(),
        recurring: formRecurring,
        category: formCategory,
      };

      if (editingEvent) {
        await fetchAPI(`/admin/events/${editingEvent.id}`, { method: 'PUT', body });
        showToast('Event updated', 'success');
      } else {
        await fetchAPI('/admin/events', { method: 'POST', body });
        showToast('Event created', 'success');
      }
      setShowCreateModal(false);
      loadEvents();
    } catch (err) {
      showToast(err.message || formatError('Failed to save event'), 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (eventId) => {
    if (!confirm('Delete this event? This cannot be undone.')) return;
    try {
      await fetchAPI(`/admin/events/${eventId}`, { method: 'DELETE' });
      showToast('Event deleted', 'success');
      loadEvents();
    } catch (err) {
      showToast(err.message || formatError('Failed to delete event'), 'error');
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '8px 12px',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-primary)',
    color: 'var(--text-primary)',
    fontFamily: 'monospace',
    fontSize: '0.85rem',
  };

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-amber)40',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', fontWeight: 500 }}>EVENTS CALENDAR</div>
        <button
          onClick={onToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? 'var(--accent-amber)20' : 'transparent',
            border: `1px solid ${isOpen ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
            color: isOpen ? 'var(--accent-amber)' : 'var(--text-dim)',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: '0.7rem',
          }}
        >
          {isOpen ? '\u25BC HIDE' : '\u25B6 SHOW'}
        </button>
      </div>

      {isOpen && (
        <div style={{ marginTop: '16px' }}>
          {loading ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>Loading...</div>
          ) : (
            <>
              {/* Create button */}
              <div style={{ marginBottom: '16px' }}>
                <button onClick={openCreateModal} style={{
                  padding: isMobile ? '10px 16px' : '8px 14px',
                  minHeight: isMobile ? '44px' : 'auto',
                  background: 'var(--accent-amber)20',
                  border: '1px solid var(--accent-amber)',
                  color: 'var(--accent-amber)',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: isMobile ? '0.85rem' : '0.8rem',
                }}>+ NEW EVENT</button>
              </div>

              {/* Events list */}
              {events.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                  No events configured
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {events.map(event => (
                    <div key={event.id} style={{
                      padding: '12px',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-primary)',
                      display: 'flex',
                      flexDirection: isMobile ? 'column' : 'row',
                      gap: '8px',
                      alignItems: isMobile ? 'flex-start' : 'center',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                          <span style={{
                            color: 'var(--text-primary)',
                            fontFamily: 'monospace',
                            fontSize: '0.85rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {event.title}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', fontSize: '0.7rem', color: 'var(--text-dim)', flexWrap: 'wrap' }}>
                          <span>{event.eventDate}</span>
                          {event.recurring && (
                            <>
                              <span>•</span>
                              <span style={{ color: 'var(--accent-purple)' }}>RECURRING</span>
                            </>
                          )}
                          <span>•</span>
                          <span>{event.category}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => openEditModal(event)} style={{
                          padding: '4px 8px',
                          background: 'transparent',
                          border: '1px solid var(--border-secondary)',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: '0.7rem',
                        }}>EDIT</button>
                        <button onClick={() => handleDelete(event.id)} style={{
                          padding: '4px 8px',
                          background: 'transparent',
                          border: '1px solid var(--accent-orange)40',
                          color: 'var(--accent-orange)',
                          cursor: 'pointer',
                          fontFamily: 'monospace',
                          fontSize: '0.7rem',
                        }}>DEL</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.8)', padding: '16px',
        }} onClick={() => setShowCreateModal(false)}>
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--accent-amber)',
            borderRadius: '4px', padding: isMobile ? '16px' : '24px',
            maxWidth: '500px', width: '100%', maxHeight: '90vh', overflow: 'auto',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px 0', color: 'var(--accent-amber)', fontFamily: 'monospace' }}>
              {editingEvent ? 'EDIT EVENT' : 'NEW EVENT'}
            </h3>

            {/* Title */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>TITLE *</label>
              <input
                type="text"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value.slice(0, 100))}
                maxLength={100}
                style={inputStyle}
                placeholder="Event title..."
              />
            </div>

            {/* Description */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>DESCRIPTION</label>
              <textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
                style={{ ...inputStyle, resize: 'vertical' }}
                placeholder="Optional description..."
              />
            </div>

            {/* Recurring toggle */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-dim)', fontSize: '0.75rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formRecurring}
                  onChange={e => {
                    setFormRecurring(e.target.checked);
                    setFormEventDate('');
                  }}
                />
                RECURRING (yearly)
              </label>
            </div>

            {/* Event Date */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>
                DATE * <span style={{ color: 'var(--text-muted)' }}>({formRecurring ? 'MM-DD' : 'YYYY-MM-DD'})</span>
              </label>
              <input
                type="text"
                value={formEventDate}
                onChange={e => setFormEventDate(e.target.value)}
                maxLength={formRecurring ? 5 : 10}
                style={{ ...inputStyle, width: formRecurring ? '100px' : '150px' }}
                placeholder={formRecurring ? '03-14' : '2026-03-14'}
              />
            </div>

            {/* Category */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>CATEGORY</label>
              <select
                value={formCategory}
                onChange={e => setFormCategory(e.target.value)}
                style={inputStyle}
              >
                <option value="general">General</option>
                <option value="birthday">Birthday</option>
                <option value="holiday">Holiday</option>
                <option value="community">Community</option>
              </select>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCreateModal(false)} style={{
                padding: isMobile ? '10px 16px' : '8px 14px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'transparent',
                border: '1px solid var(--border-secondary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
              }}>CANCEL</button>
              <button onClick={handleSave} disabled={saving} style={{
                padding: isMobile ? '10px 16px' : '8px 14px',
                minHeight: isMobile ? '44px' : 'auto',
                background: 'var(--accent-amber)20',
                border: '1px solid var(--accent-amber)',
                color: 'var(--accent-amber)',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace',
                fontSize: isMobile ? '0.85rem' : '0.8rem',
                opacity: saving ? 0.6 : 1,
              }}>{saving ? 'SAVING...' : (editingEvent ? 'UPDATE' : 'CREATE')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EventsAdminPanel;
