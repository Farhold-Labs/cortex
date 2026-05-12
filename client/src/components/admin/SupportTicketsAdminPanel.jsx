import React, { useState, useEffect, useCallback } from 'react';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';

const SupportTicketsAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('open');
  const [actionLoading, setActionLoading] = useState(null);

  const loadTickets = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAPI(`/admin/support/tickets?status=${statusFilter}`);
      setTickets(data.tickets || []);
    } catch (err) {
      showToast('Failed to load support tickets', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast, statusFilter]);

  useEffect(() => {
    if (isOpen) loadTickets();
  }, [isOpen, loadTickets]);

  const handleResolve = async (id) => {
    setActionLoading(id + ':resolve');
    try {
      await fetchAPI(`/admin/support/tickets/${id}/resolve`, { method: 'PATCH' });
      showToast('Ticket resolved', 'success');
      loadTickets();
    } catch (err) {
      showToast('Failed to resolve ticket', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReopen = async (id) => {
    setActionLoading(id + ':reopen');
    try {
      await fetchAPI(`/admin/support/tickets/${id}/reopen`, { method: 'PATCH' });
      showToast('Ticket reopened', 'success');
      loadTickets();
    } catch (err) {
      showToast('Failed to reopen ticket', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  };

  return (
    <div style={{
      marginTop: '20px',
      padding: isMobile ? '16px' : '20px',
      background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
      border: '1px solid var(--accent-teal)40',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', fontWeight: 500 }}>🎫 SUPPORT TICKETS</div>
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
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {['open', 'resolved', 'all'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '4px 12px',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '4px',
                  background: statusFilter === s ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: statusFilter === s ? 'var(--bg-primary)' : 'var(--text-secondary)',
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
            <button
              onClick={loadTickets}
              style={{ marginLeft: 'auto', padding: '4px 12px', border: '1px solid var(--border-subtle)', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.75rem', cursor: 'pointer' }}
            >
              ↻ Refresh
            </button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '24px' }}><LoadingSpinner /></div>
          ) : tickets.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.8rem', textAlign: 'center', margin: '24px 0' }}>
              No {statusFilter === 'all' ? '' : statusFilter} tickets.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {tickets.map(ticket => (
                <div key={ticket.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: '6px', padding: '12px', background: 'var(--bg-secondary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: '4px', fontSize: '0.65rem', fontFamily: 'monospace', fontWeight: 'bold',
                        background: ticket.status === 'open' ? 'rgba(255,80,80,0.15)' : 'rgba(14,173,105,0.15)',
                        color: ticket.status === 'open' ? 'var(--error)' : 'var(--success)',
                        border: `1px solid ${ticket.status === 'open' ? 'var(--error)' : 'var(--success)'}`,
                      }}>
                        {ticket.status.toUpperCase()}
                      </span>
                      {ticket.email && (
                        <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.75rem' }}>{ticket.email}</span>
                      )}
                    </div>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.7rem', whiteSpace: 'nowrap', flexShrink: 0 }}>{formatDate(ticket.created_at)}</span>
                  </div>

                  <p style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '0.8rem', margin: '0 0 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {ticket.message}
                  </p>

                  {ticket.status === 'resolved' && ticket.resolved_at && (
                    <p style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.7rem', margin: '0 0 8px' }}>
                      Resolved {formatDate(ticket.resolved_at)}{ticket.resolver_handle ? ` by @${ticket.resolver_handle}` : ''}
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    {ticket.status === 'open' ? (
                      <button
                        onClick={() => handleResolve(ticket.id)}
                        disabled={actionLoading === ticket.id + ':resolve'}
                        style={{ padding: '4px 12px', border: '1px solid var(--success)', borderRadius: '4px', background: 'transparent', color: 'var(--success)', fontFamily: 'monospace', fontSize: '0.75rem', cursor: 'pointer', opacity: actionLoading === ticket.id + ':resolve' ? 0.5 : 1 }}
                      >
                        {actionLoading === ticket.id + ':resolve' ? 'Resolving...' : 'Resolve'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleReopen(ticket.id)}
                        disabled={actionLoading === ticket.id + ':reopen'}
                        style={{ padding: '4px 12px', border: '1px solid var(--border-subtle)', borderRadius: '4px', background: 'transparent', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.75rem', cursor: 'pointer', opacity: actionLoading === ticket.id + ':reopen' ? 0.5 : 1 }}
                      >
                        {actionLoading === ticket.id + ':reopen' ? 'Reopening...' : 'Reopen'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SupportTicketsAdminPanel;
