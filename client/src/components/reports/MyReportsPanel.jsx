import React, { useState, useEffect } from 'react';
import { LOADING, formatError } from '../../../messages.js';
import { GlowText } from '../ui/SimpleComponents.jsx';

const MyReportsPanel = ({ fetchAPI, showToast, isMobile, hideTitle = false }) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadMyReports = async () => {
      try {
        const res = await fetchAPI('/reports');
        if (res.ok) {
          const data = await res.json();
          setReports(data.reports || []);
        }
      } catch (err) {
        showToast(formatError('Failed to load your reports'), 'error');
      } finally {
        setLoading(false);
      }
    };
    loadMyReports();
  }, [fetchAPI, showToast]);

  const statusColors = {
    pending: 'var(--accent-amber)',
    resolved: 'var(--accent-green)',
    dismissed: 'var(--text-dim)',
  };

  if (loading) {
    return <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>{LOADING.generic}</div>;
  }

  return (
    <div style={{ marginTop: hideTitle ? 0 : '24px' }}>
      {!hideTitle && (
        <div style={{ marginBottom: '16px' }}>
          <GlowText color="var(--accent-teal)" size={isMobile ? '1rem' : '1.1rem'}>My Reports</GlowText>
        </div>
      )}

      {reports.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center', border: '1px dashed var(--border-subtle)' }}>
          You haven't submitted any reports
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {reports.map((report) => (
            <div
              key={report.id}
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                padding: isMobile ? '12px' : '14px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ fontSize: '0.8rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Reported: </span>
                  <span style={{ color: 'var(--accent-teal)', fontWeight: 500 }}>
                    {report.targetType === 'ping' ? 'Message' : 'User'}
                  </span>
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: statusColors[report.status],
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  background: `${statusColors[report.status]}15`,
                  border: `1px solid ${statusColors[report.status]}40`,
                }}>
                  {report.status}
                </div>
              </div>

              <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', marginBottom: '6px' }}>
                <span style={{ color: 'var(--text-dim)' }}>Reason: </span>
                {report.reason}
              </div>

              {report.details && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '6px', fontStyle: 'italic' }}>
                  "{report.details}"
                </div>
              )}

              <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '6px' }}>
                Submitted {new Date(report.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MyReportsPanel;
