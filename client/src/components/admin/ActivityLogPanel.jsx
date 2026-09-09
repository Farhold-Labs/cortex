import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { formatError } from '../../../messages.js';
import { T } from '../../config/terminology.js';

const ActivityLogPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [selectedAction, setSelectedAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const LIMIT = 50;

  const ACTION_LABELS = {
    login: { label: 'Login', color: 'var(--accent-green)' },
    login_failed: { label: 'Login Failed', color: 'var(--accent-orange)' },
    logout: { label: 'Logout', color: 'var(--text-dim)' },
    register: { label: 'Registration', color: 'var(--accent-teal)' },
    password_change: { label: 'Password Change', color: 'var(--accent-amber)' },
    password_reset_complete: { label: 'Password Reset', color: 'var(--accent-amber)' },
    mfa_enable: { label: 'MFA Enabled', color: 'var(--accent-green)' },
    mfa_disable: { label: 'MFA Disabled', color: 'var(--accent-orange)' },
    admin_warn: { label: 'Admin Warning', color: 'var(--accent-purple)' },
    admin_password_reset: { label: 'Admin Password Reset', color: 'var(--accent-purple)' },
    admin_force_logout: { label: 'Admin Force Logout', color: 'var(--accent-purple)' },
    admin_disable_mfa: { label: 'Admin MFA Disabled', color: 'var(--accent-purple)' },
    create_wave: { label: `${T.Wave} Created`, color: 'var(--accent-teal)' },
    delete_wave: { label: `${T.Wave} Deleted`, color: 'var(--accent-orange)' },
    create_ping: { label: `${T.Ping} Created`, color: 'var(--text-secondary)' },
    edit_ping: { label: `${T.Ping} Edited`, color: 'var(--text-secondary)' },
    delete_ping: { label: `${T.Ping} Deleted`, color: 'var(--accent-orange)' },
  };

  const loadActivities = useCallback(async (newOffset = 0) => {
    setLoading(true);
    try {
      let url = `/admin/activity-log?limit=${LIMIT}&offset=${newOffset}`;
      if (selectedAction) url += `&actionType=${selectedAction}`;

      const data = await fetchAPI(url);
      if (newOffset === 0) {
        setActivities(data.activities || []);
      } else {
        setActivities(prev => [...prev, ...(data.activities || [])]);
      }
      setTotal(data.total || 0);
      setHasMore((data.activities || []).length === LIMIT);
      setOffset(newOffset);
    } catch (err) {
      // Check if it's a 501 (not implemented) error
      if (err.message?.includes('501')) {
        setActivities([]);
        setTotal(0);
      } else {
        showToast(formatError('Failed to load activity log'), 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, selectedAction, showToast]);

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchAPI('/admin/activity-stats?days=7');
      setStats(data);
    } catch {
      // Stats not critical, ignore errors
    }
  }, [fetchAPI]);

  useEffect(() => {
    if (isOpen && activities.length === 0) {
      loadActivities(0);
      loadStats();
    }
  }, [isOpen, loadActivities, loadStats, activities.length]);

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const getActionStyle = (actionType) => {
    const config = ACTION_LABELS[actionType] || { label: actionType, color: 'var(--text-dim)' };
    return config;
  };

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-teal)40',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', fontWeight: 500 }}>
            📊 ACTIVITY LOG
          </div>
          {stats && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
              Last 7 days: {stats.totalActivities} events | {stats.uniqueUsers} users
            </div>
          )}
        </div>
        <button
          onClick={onToggle}
          style={{
            padding: isMobile ? '8px 12px' : '6px 10px',
            background: isOpen ? 'var(--accent-teal)20' : 'transparent',
            border: `1px solid ${isOpen ? 'var(--accent-teal)' : 'var(--border-primary)'}`,
            color: isOpen ? 'var(--accent-teal)' : 'var(--text-dim)',
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

      {/* Filter by action type */}
      <div style={{ marginBottom: '16px' }}>
        <select
          value={selectedAction}
          onChange={(e) => {
            const newAction = e.target.value;
            setSelectedAction(newAction);
            setOffset(0);
            // Fetch filtered results immediately
            setLoading(true);
            let url = `/admin/activity-log?limit=${LIMIT}&offset=0`;
            if (newAction) url += `&actionType=${newAction}`;
            fetchAPI(url).then(data => {
              setActivities(data.activities || []);
              setTotal(data.total || 0);
              setHasMore((data.activities || []).length === LIMIT);
            }).catch(() => {
              showToast(formatError('Failed to load activity log'), 'error');
            }).finally(() => setLoading(false));
          }}
          style={{
            padding: '8px 12px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-secondary)',
            color: 'var(--text-primary)',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            cursor: 'pointer',
            minWidth: '180px'
          }}
        >
          <option value="">All Actions</option>
          <option value="login">Logins</option>
          <option value="login_failed">Failed Logins</option>
          <option value="register">Registrations</option>
          <option value="password_change">Password Changes</option>
          <option value="password_reset_complete">Password Resets</option>
          <option value="mfa_enable">MFA Enabled</option>
          <option value="mfa_disable">MFA Disabled</option>
          <option value="admin_warn">Admin Warnings</option>
          <option value="admin_password_reset">Admin Password Resets</option>
          <option value="admin_disable_mfa">Admin MFA Disabled</option>
          <option value="create_wave">{T.Waves} Created</option>
          <option value="delete_wave">{T.Waves} Deleted</option>
        </select>
      </div>

      {loading && activities.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>Loading...</div>
      ) : activities.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center' }}>
          No activity logs found. Activity logging may not be enabled.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
            Showing {activities.length} of {total} entries
          </div>
          <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
            {activities.map((activity) => {
              const actionConfig = getActionStyle(activity.action_type);
              return (
                <div
                  key={activity.id}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    gap: isMobile ? '6px' : '12px',
                    alignItems: isMobile ? 'flex-start' : 'center',
                  }}
                >
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    background: actionConfig.color,
                    color: 'var(--bg-base)',
                    borderRadius: '2px',
                    whiteSpace: 'nowrap',
                    minWidth: isMobile ? 'auto' : '120px',
                    textAlign: 'center',
                  }}>
                    {actionConfig.label}
                  </span>
                  <span style={{
                    color: 'var(--text-secondary)',
                    fontSize: '0.8rem',
                    flex: 1,
                  }}>
                    {activity.user_handle || activity.user_id || 'System'}
                  </span>
                  <span style={{
                    color: 'var(--text-dim)',
                    fontSize: '0.7rem',
                    whiteSpace: 'nowrap',
                  }}>
                    {activity.ip_address || '-'}
                  </span>
                  <span style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.7rem',
                    whiteSpace: 'nowrap',
                  }}>
                    {formatDate(activity.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
          {hasMore && (
            <button
              onClick={() => loadActivities(offset + LIMIT)}
              disabled={loading}
              style={{
                marginTop: '12px',
                padding: '8px 16px',
                background: 'transparent',
                border: '1px solid var(--border-secondary)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                width: '100%',
              }}
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          )}
        </>
      )}
        </div>
      )}
    </div>
  );
};

// ============ CRAWL BAR ADMIN PANEL ============
export default ActivityLogPanel;
