import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { formatError, CONFIRM_DIALOG, FEDERATION } from '../../../messages.js';

const AlertsAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAlert, setEditingAlert] = useState(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formPriority, setFormPriority] = useState('info');
  const [formCategory, setFormCategory] = useState('system');
  const [formScope, setFormScope] = useState('local');
  const [formStartTime, setFormStartTime] = useState('');
  const [formEndTime, setFormEndTime] = useState('');

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI('/admin/alerts');
      setAlerts(data.alerts || []);
    } catch (err) {
      if (!err.message?.includes('401')) {
        showToast(err.message || formatError('Failed to load alerts'), 'error');
      }
    }
    setLoading(false);
  }, [fetchAPI, showToast]);

  useEffect(() => {
    if (isOpen && alerts.length === 0) {
      loadAlerts();
    }
  }, [isOpen, alerts.length, loadAlerts]);

  const resetForm = () => {
    setFormTitle('');
    setFormContent('');
    setFormPriority('info');
    setFormCategory('system');
    setFormScope('local');
    // Default start time to now
    const now = new Date();
    setFormStartTime(now.toISOString().slice(0, 16));
    // Default end time to 24 hours from now
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    setFormEndTime(tomorrow.toISOString().slice(0, 16));
    setEditingAlert(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const openEditModal = (alert) => {
    setEditingAlert(alert);
    setFormTitle(alert.title);
    setFormContent(alert.content);
    setFormPriority(alert.priority);
    setFormCategory(alert.category);
    setFormScope(alert.scope);
    // Safely parse dates - convert to local datetime format for datetime-local input
    const parseToLocalDatetime = (dateStr) => {
      if (!dateStr) return '';
      // Ensure we parse as UTC - append Z if not present (SQLite may strip it)
      const utcStr = dateStr.endsWith('Z') ? dateStr : dateStr + 'Z';
      const d = new Date(utcStr);
      if (isNaN(d.getTime())) return '';
      // Use local time methods to convert UTC to user's local timezone
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    setFormStartTime(parseToLocalDatetime(alert.startTime));
    setFormEndTime(parseToLocalDatetime(alert.endTime));
    setShowCreateModal(true);
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formContent.trim() || !formStartTime || !formEndTime) {
      showToast('Please fill all required fields', 'error');
      return;
    }

    setSaving(true);
    try {
      if (editingAlert) {
        await fetchAPI(`/admin/alerts/${editingAlert.id}`, {
          method: 'PUT',
          body: {
            title: formTitle.trim(),
            content: formContent.trim(),
            priority: formPriority,
            category: formCategory,
            scope: formScope,
            startTime: new Date(formStartTime).toISOString(),
            endTime: new Date(formEndTime).toISOString(),
          }
        });
        showToast('Alert updated', 'success');
      } else {
        await fetchAPI('/admin/alerts', {
          method: 'POST',
          body: {
            title: formTitle.trim(),
            content: formContent.trim(),
            priority: formPriority,
            category: formCategory,
            scope: formScope,
            startTime: new Date(formStartTime).toISOString(),
            endTime: new Date(formEndTime).toISOString(),
          }
        });
        showToast('Alert created', 'success');
      }
      setShowCreateModal(false);
      loadAlerts();
    } catch (err) {
      showToast(err.message || formatError('Failed to save alert'), 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (alertId) => {
    if (!confirm(CONFIRM_DIALOG.deleteAlert)) return;
    try {
      await fetchAPI(`/admin/alerts/${alertId}`, { method: 'DELETE' });
      showToast('Alert deleted', 'success');
      loadAlerts();
    } catch (err) {
      showToast(err.message || formatError('Failed to delete alert'), 'error');
    }
  };

  const getAlertStatus = (alert) => {
    const now = new Date();
    // Ensure we parse as UTC - append Z if not present (SQLite may strip it)
    const startStr = alert.startTime?.endsWith('Z') ? alert.startTime : alert.startTime + 'Z';
    const endStr = alert.endTime?.endsWith('Z') ? alert.endTime : alert.endTime + 'Z';
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (now < start) return { label: 'SCHEDULED', color: 'var(--accent-purple)' };
    if (now > end) return { label: 'EXPIRED', color: 'var(--text-muted)' };
    return { label: 'ACTIVE', color: 'var(--accent-green)' };
  };

  const priorityConfig = {
    critical: { icon: '🚨', color: 'var(--accent-orange)' },
    warning: { icon: '⚠️', color: 'var(--accent-amber)' },
    info: { icon: 'ℹ️', color: 'var(--accent-teal)' },
    celebration: { icon: '🎉', color: 'var(--accent-purple)' }
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
        <div style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', fontWeight: 500 }}>🚨 SYSTEM ALERTS</div>
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
          {isOpen ? '▼ HIDE' : '▶ SHOW'}
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
                }}>+ NEW ALERT</button>
              </div>

              {/* Alerts list */}
              {alerts.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                  No alerts configured
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {alerts.map(alert => {
                    const status = getAlertStatus(alert);
                    const cfg = priorityConfig[alert.priority] || priorityConfig.info;
                    return (
                      <div key={alert.id} style={{
                        padding: '12px',
                        background: 'var(--bg-surface)',
                        border: `1px solid ${cfg.color}40`,
                        display: 'flex',
                        flexDirection: isMobile ? 'column' : 'row',
                        gap: '8px',
                        alignItems: isMobile ? 'flex-start' : 'center',
                      }}>
                        {/* Priority icon and title */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span>{cfg.icon}</span>
                            <span style={{
                              color: 'var(--text-primary)',
                              fontFamily: 'monospace',
                              fontSize: '0.85rem',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {alert.title}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                            <span style={{ color: status.color, fontWeight: 600 }}>{status.label}</span>
                            <span>•</span>
                            <span>{alert.category}</span>
                            <span>•</span>
                            <span>{alert.scope}</span>
                            {alert.origin_node && (
                              <>
                                <span>•</span>
                                <span style={{ color: 'var(--accent-purple)' }}>@{alert.origin_node}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {/* Actions */}
                        {!alert.origin_node && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => openEditModal(alert)} style={{
                              padding: '4px 8px',
                              background: 'transparent',
                              border: '1px solid var(--border-secondary)',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              fontFamily: 'monospace',
                              fontSize: '0.7rem',
                            }}>EDIT</button>
                            <button onClick={() => handleDelete(alert.id)} style={{
                              padding: '4px 8px',
                              background: 'transparent',
                              border: '1px solid var(--accent-orange)40',
                              color: 'var(--accent-orange)',
                              cursor: 'pointer',
                              fontFamily: 'monospace',
                              fontSize: '0.7rem',
                            }}>DEL</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
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
              {editingAlert ? 'EDIT ALERT' : 'NEW ALERT'}
            </h3>

            {/* Title */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>TITLE *</label>
              <input
                type="text"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                }}
                placeholder="Alert title..."
              />
            </div>

            {/* Content */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>CONTENT *</label>
              <textarea
                value={formContent}
                onChange={e => setFormContent(e.target.value)}
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                  resize: 'vertical',
                }}
                placeholder="Alert content (supports basic HTML)..."
              />
            </div>

            {/* Priority + Category Row */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>PRIORITY</label>
                <select
                  value={formPriority}
                  onChange={e => setFormPriority(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="info">ℹ️ Info</option>
                  <option value="warning">⚠️ Warning</option>
                  <option value="critical">🚨 Critical</option>
                  <option value="celebration">🎉 Celebration</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>CATEGORY</label>
                <select
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                >
                  <option value="system">System</option>
                  <option value="announcement">Announcement</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
            </div>

            {/* Scope */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>SCOPE</label>
              <select
                value={formScope}
                onChange={e => setFormScope(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-primary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                }}
              >
                <option value="local">Local only</option>
                <option value="federated">{FEDERATION.scopeFederated}</option>
              </select>
            </div>

            {/* Start + End Time */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>START TIME *</label>
                <input
                  type="datetime-local"
                  value={formStartTime}
                  onChange={e => setFormStartTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '4px' }}>END TIME *</label>
                <input
                  type="datetime-local"
                  value={formEndTime}
                  onChange={e => setFormEndTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-primary)',
                    color: 'var(--text-primary)',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                  }}
                />
              </div>
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
              }}>{saving ? 'SAVING...' : (editingAlert ? 'UPDATE' : 'CREATE')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============ ALERT SUBSCRIPTIONS PANEL ============
export default AlertsAdminPanel;
