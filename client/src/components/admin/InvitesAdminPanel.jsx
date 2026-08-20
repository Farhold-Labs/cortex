import React, { useState, useEffect, useCallback } from 'react';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { canAccess } from '../../config/constants.js';

// ============ INVITES ADMIN PANEL (v2.67.0) ============
// Single-use invite links. The raw token comes back from the server exactly once, at
// creation, so the link is shown here immediately and cannot be retrieved later — only
// revoked and reissued.

const EXPIRY_OPTIONS = [[1, '1 day'], [7, '7 days'], [30, '30 days'], [90, '90 days']];

const STATUS_COLOR = {
  pending: 'var(--accent-green)',
  used: 'var(--text-muted)',
  expired: 'var(--accent-orange)',
  revoked: 'var(--accent-orange)',
};

const InvitesAdminPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle, user }) => {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [role, setRole] = useState('user');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [sendEmail, setSendEmail] = useState(false);
  const [freshLink, setFreshLink] = useState(null);
  const [copied, setCopied] = useState(false);

  const isAdmin = canAccess(user, 'admin');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAPI('/admin/invites');
      setInvitations(data.invitations || []);
    } catch (err) {
      showToast(err.message || 'Failed to load invitations', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const handleCreate = async () => {
    setCreating(true);
    setFreshLink(null);
    try {
      const body = { role, expiresInDays, sendEmail: sendEmail && !!email.trim() };
      if (email.trim()) body.email = email.trim();
      if (note.trim()) body.note = note.trim();

      const result = await fetchAPI('/admin/invites', { method: 'POST', body });
      setFreshLink(result.url);
      setCopied(false);
      setEmail('');
      setNote('');

      if (result.emailed) showToast('Invitation created and emailed', 'success');
      else if (result.emailError) showToast(result.emailError, 'error');
      else showToast('Invitation created — copy the link below', 'success');

      await load();
    } catch (err) {
      showToast(err.message || 'Failed to create invitation', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id) => {
    try {
      await fetchAPI(`/admin/invites/${id}`, { method: 'DELETE' });
      showToast('Invitation revoked', 'success');
      await load();
    } catch (err) {
      showToast(err.message || 'Failed to revoke invitation', 'error');
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(freshLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not copy — select the link and copy it manually', 'error');
    }
  };

  const pill = (active, color = 'var(--accent-amber)') => ({
    padding: '5px 12px',
    background: active ? `${color}20` : 'transparent',
    border: `1px solid ${active ? color : 'var(--border-subtle)'}`,
    color: active ? color : 'var(--text-dim)',
    cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem', borderRadius: '2px',
  });

  const labelStyle = { display: 'block', color: 'var(--text-dim)', fontSize: '0.75rem', marginBottom: '6px' };
  const inputStyle = {
    width: '100%', padding: '8px', background: 'var(--bg-base)',
    border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
    fontFamily: 'monospace', fontSize: '0.8rem', borderRadius: '2px', boxSizing: 'border-box',
  };

  const pending = invitations.filter(i => i.status === 'pending');

  return (
    <CollapsibleSection
      title="INVITATIONS"
      isOpen={isOpen}
      onToggle={onToggle}
      isMobile={isMobile}
      accentColor="var(--accent-green)"
      badge={pending.length ? String(pending.length) : undefined}
    >
      {loading ? <LoadingSpinner /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.5 }}>
            Each invitation is a single-use link. The link is shown once, here, when you create
            it — it can't be looked up again afterwards, only revoked and reissued. Invitations
            work whether registration is open or closed.
          </div>

          {/* ---- Create ---- */}
          <div>
            <div style={{ color: 'var(--accent-green)', fontSize: '0.8rem', marginBottom: '12px' }}>▸ NEW INVITATION</div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>EMAIL (optional)</label>
              <input type="email" value={email} placeholder="Leave blank to just copy a link"
                onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>NOTE (optional — for your own reference)</label>
              <input type="text" value={note} maxLength={200} placeholder="e.g. stage crew"
                onChange={(e) => setNote(e.target.value)} style={inputStyle} />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>EXPIRES IN</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {EXPIRY_OPTIONS.map(([value, name]) => (
                  <button key={value} onClick={() => setExpiresInDays(value)} style={pill(expiresInDays === value)}>{name}</button>
                ))}
              </div>
            </div>

            {isAdmin && (
              <div style={{ marginBottom: '12px' }}>
                <label style={labelStyle}>ROLE</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {['user', 'moderator', 'admin'].map(r => (
                    <button key={r} onClick={() => setRole(r)} style={pill(role === r, r === 'admin' ? 'var(--accent-orange)' : 'var(--accent-amber)')}>
                      {r.toUpperCase()}
                    </button>
                  ))}
                </div>
                {role !== 'user' && (
                  <div style={{ color: 'var(--accent-orange)', fontSize: '0.7rem', marginTop: '6px' }}>
                    Anyone who redeems this link becomes {role === 'admin' ? 'an admin' : 'a moderator'}.
                  </div>
                )}
              </div>
            )}

            <div style={{ marginBottom: '12px' }}>
              <label style={labelStyle}>DELIVERY</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={() => setSendEmail(false)} style={pill(!sendEmail)}>COPY LINK</button>
                <button onClick={() => setSendEmail(true)} disabled={!email.trim()} style={{ ...pill(sendEmail, 'var(--accent-teal)'), opacity: email.trim() ? 1 : 0.4 }}>
                  SEND EMAIL
                </button>
                {!email.trim() && <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Enter an email to send directly</span>}
              </div>
            </div>

            <button onClick={handleCreate} disabled={creating}
              style={{ ...pill(true, 'var(--accent-green)'), padding: '8px 20px' }}>
              {creating ? 'CREATING…' : 'CREATE INVITATION'}
            </button>

            {freshLink && (
              <div style={{ marginTop: '14px', padding: '10px', background: 'var(--accent-green)10', border: '1px solid var(--accent-green)30' }}>
                <div style={{ color: 'var(--accent-green)', fontSize: '0.72rem', marginBottom: '6px' }}>
                  Copy this now — it won't be shown again.
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input readOnly value={freshLink} onFocus={(e) => e.target.select()} style={{ ...inputStyle, flex: 1, minWidth: '200px' }} />
                  <button onClick={copyLink} style={pill(true, 'var(--accent-green)')}>{copied ? '✓ COPIED' : 'COPY'}</button>
                </div>
              </div>
            )}
          </div>

          {/* ---- Existing ---- */}
          <div>
            <div style={{ color: 'var(--accent-teal)', fontSize: '0.8rem', marginBottom: '12px' }}>
              ▸ ISSUED ({invitations.length})
            </div>
            {invitations.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>No invitations yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {invitations.map(inv => (
                  <div key={inv.id} style={{
                    padding: '8px 10px', border: '1px solid var(--border-subtle)',
                    display: 'flex', justifyContent: 'space-between', gap: '10px',
                    alignItems: 'center', flexWrap: 'wrap',
                  }}>
                    <div style={{ fontSize: '0.75rem', minWidth: 0 }}>
                      <div style={{ color: 'var(--text-primary)' }}>
                        {inv.email || <span style={{ color: 'var(--text-muted)' }}>link only</span>}
                        {inv.role !== 'user' && <span style={{ color: 'var(--accent-orange)', marginLeft: '8px' }}>{inv.role}</span>}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '2px' }}>
                        {inv.note ? `${inv.note} · ` : ''}
                        by @{inv.createdByHandle || 'unknown'}
                        {inv.status === 'used' && inv.usedByHandle ? ` · claimed by @${inv.usedByHandle}` : ''}
                        {inv.status === 'pending' ? ` · expires ${new Date(inv.expiresAt).toLocaleDateString()}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ color: STATUS_COLOR[inv.status] || 'var(--text-muted)', fontSize: '0.7rem' }}>
                        {inv.status.toUpperCase()}
                      </span>
                      {inv.status === 'pending' && (
                        <button onClick={() => handleRevoke(inv.id)} style={{ ...pill(false), color: 'var(--accent-orange)' }}>REVOKE</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
};

export default InvitesAdminPanel;
