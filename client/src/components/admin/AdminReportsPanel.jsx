import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner, GlowText } from '../ui/SimpleComponents.jsx';
import { formatError } from '../../../messages.js';

const AdminReportsPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');
  const [selectedReport, setSelectedReport] = useState(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolution, setResolution] = useState('');

  const loadReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAPI(`/admin/reports?status=${activeTab}&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch (err) {
      showToast(formatError('Failed to load reports'), 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, activeTab, showToast]);

  useEffect(() => {
    if (isOpen) {
      loadReports();
    }
  }, [isOpen, loadReports]);

  const handleResolve = async () => {
    if (!selectedReport || !resolution) return;
    try {
      const res = await fetchAPI(`/admin/reports/${selectedReport.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ resolution, notes: resolveNotes }),
      });
      if (res.ok) {
        showToast('Report resolved', 'success');
        setSelectedReport(null);
        setResolution('');
        setResolveNotes('');
        loadReports();
      } else {
        const data = await res.json();
        showToast(data.error || formatError('Failed to resolve report'), 'error');
      }
    } catch (err) {
      showToast(formatError('Failed to resolve report'), 'error');
    }
  };

  const handleDismiss = async (reportId) => {
    try {
      const res = await fetchAPI(`/admin/reports/${reportId}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'No action required' }),
      });
      if (res.ok) {
        showToast('Report dismissed', 'success');
        loadReports();
      } else {
        const data = await res.json();
        showToast(data.error || formatError('Failed to dismiss report'), 'error');
      }
    } catch (err) {
      showToast(formatError('Failed to dismiss report'), 'error');
    }
  };

  const tabs = [
    { id: 'pending', label: 'Pending', color: 'var(--accent-amber)' },
    { id: 'resolved', label: 'Resolved', color: 'var(--accent-green)' },
    { id: 'dismissed', label: 'Dismissed', color: 'var(--text-dim)' },
  ];

  const resolutionOptions = [
    { value: 'warning_issued', label: 'Warning Issued' },
    { value: 'content_removed', label: 'Content Removed' },
    { value: 'user_banned', label: 'User Banned' },
    { value: 'no_action', label: 'No Action Needed' },
  ];

  return (
    <div style={{ marginTop: '20px', padding: isMobile ? '16px' : '20px', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))', border: '1px solid var(--accent-orange)40' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: 'var(--accent-orange)', fontSize: '0.8rem', fontWeight: 500 }}>REPORTS DASHBOARD</div>
        <button
          onClick={onToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? 'var(--accent-orange)20' : 'transparent',
            border: `1px solid ${isOpen ? 'var(--accent-orange)' : 'var(--border-primary)'}`,
            color: isOpen ? 'var(--accent-orange)' : 'var(--text-dim)',
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
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: isMobile ? '10px 16px' : '8px 16px',
              minHeight: isMobile ? '44px' : 'auto',
              background: activeTab === tab.id ? `${tab.color}20` : 'transparent',
              border: `1px solid ${activeTab === tab.id ? tab.color : 'var(--border-primary)'}`,
              color: activeTab === tab.id ? tab.color : 'var(--text-dim)',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: isMobile ? '0.85rem' : '0.8rem',
              textTransform: 'uppercase',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>Loading reports...</div>
      ) : reports.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center', border: '1px dashed var(--border-subtle)' }}>
          No {activeTab} reports
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {reports.map((report) => (
            <div
              key={report.id}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                padding: isMobile ? '14px' : '16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    background: report.type === 'message' ? 'var(--accent-teal)20' : report.type === 'wave' ? 'var(--accent-amber)20' : 'var(--accent-orange)20',
                    color: report.type === 'message' ? 'var(--accent-teal)' : report.type === 'wave' ? 'var(--accent-amber)' : 'var(--accent-orange)',
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    marginRight: '8px',
                  }}>
                    {report.type}
                  </span>
                  <span style={{ color: 'var(--text-primary)', fontSize: isMobile ? '0.9rem' : '0.85rem' }}>
                    {report.reason}
                  </span>
                </div>
                <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                  {new Date(report.created_at).toLocaleDateString()}
                </span>
              </div>

              {report.details && (
                <div style={{
                  color: 'var(--text-secondary)',
                  fontSize: isMobile ? '0.85rem' : '0.8rem',
                  marginBottom: '8px',
                  padding: '8px',
                  background: 'var(--bg-base)',
                  border: '1px solid var(--bg-hover)',
                }}>
                  {report.details}
                </div>
              )}

              {report.target_preview && (
                <div style={{
                  color: 'var(--text-dim)',
                  fontSize: '0.75rem',
                  marginBottom: '8px',
                  fontStyle: 'italic',
                }}>
                  Target: {report.target_preview}
                </div>
              )}

              <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '12px' }}>
                Reported by: {report.reporter_handle || report.reporter_id}
              </div>

              {activeTab === 'pending' && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setSelectedReport(report)}
                    style={{
                      padding: isMobile ? '10px 14px' : '6px 12px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'var(--accent-green)',
                      border: '1px solid var(--accent-green)',
                      color: '#fff',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.85rem' : '0.75rem',
                    }}
                  >
                    RESOLVE
                  </button>
                  <button
                    onClick={() => handleDismiss(report.id)}
                    style={{
                      padding: isMobile ? '10px 14px' : '6px 12px',
                      minHeight: isMobile ? '44px' : 'auto',
                      background: 'transparent',
                      border: '1px solid var(--text-dim)',
                      color: 'var(--text-dim)',
                      cursor: 'pointer',
                      fontFamily: 'monospace',
                      fontSize: isMobile ? '0.85rem' : '0.75rem',
                    }}
                  >
                    DISMISS
                  </button>
                </div>
              )}

              {report.resolution && (
                <div style={{ marginTop: '8px', padding: '8px', background: 'var(--accent-green)20', border: '1px solid var(--accent-green)50' }}>
                  <div style={{ color: 'var(--accent-green)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                    Resolution: {report.resolution.replace(/_/g, ' ')}
                  </div>
                  {report.resolution_notes && (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '4px' }}>
                      {report.resolution_notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedReport && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 101, padding: '20px',
        }} onClick={() => setSelectedReport(null)}>
          <div style={{
            width: '100%', maxWidth: '450px',
            background: 'var(--bg-surface)',
            border: '2px solid var(--accent-green)80',
            padding: isMobile ? '20px' : '24px',
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ marginBottom: '16px' }}>
              <GlowText color="var(--accent-green)" size="1rem">Resolve Report</GlowText>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '8px', textTransform: 'uppercase' }}>
                Resolution Action
              </div>
              {resolutionOptions.map((opt) => (
                <label key={opt.value} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 12px',
                  marginBottom: '6px',
                  background: resolution === opt.value ? 'var(--accent-green)20' : 'var(--bg-surface)',
                  border: `1px solid ${resolution === opt.value ? 'var(--accent-green)50' : 'var(--border-subtle)'}`,
                  cursor: 'pointer',
                }}>
                  <input
                    type="radio"
                    name="resolution"
                    value={opt.value}
                    checked={resolution === opt.value}
                    onChange={(e) => setResolution(e.target.value)}
                    style={{ accentColor: 'var(--accent-green)' }}
                  />
                  <span style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{opt.label}</span>
                </label>
              ))}
            </div>

            <div style={{ marginBottom: '16px' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginBottom: '8px', textTransform: 'uppercase' }}>
                Notes (optional)
              </div>
              <textarea
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
                placeholder="Add resolution notes..."
                style={{
                  width: '100%',
                  minHeight: '60px',
                  padding: '10px',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                  resize: 'vertical',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setSelectedReport(null)} style={{
                padding: '10px 20px',
                background: 'transparent',
                border: '1px solid var(--border-primary)',
                color: 'var(--text-dim)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
              }}>CANCEL</button>
              <button onClick={handleResolve} disabled={!resolution} style={{
                padding: '10px 20px',
                background: resolution ? 'var(--accent-green)' : 'var(--border-primary)',
                border: `1px solid ${resolution ? 'var(--accent-green)' : 'var(--border-primary)'}`,
                color: '#fff',
                cursor: resolution ? 'pointer' : 'not-allowed',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}>RESOLVE</button>
            </div>
          </div>
        </div>
      )}
        </div>
      )}
    </div>
  );
};

// ============ MY REPORTS PANEL ============
export default AdminReportsPanel;
