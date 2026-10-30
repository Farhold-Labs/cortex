import React, { useState, useEffect, useCallback } from 'react';
import { useModalDismiss } from '../../hooks/useModalDismiss.js';
import { GlowText, LoadingSpinner } from '../ui/SimpleComponents.jsx';
import { T } from '../../config/terminology.js';
import { plainText } from '../../utils/plainText.js';

/**
 * Who can see a wave in a Community channel (v2.134.0, wave-access phase 4).
 *
 * Everyone sees the answer: the channel, or the people and roles it is
 * narrowed to, "and the community's owners and admins" (who always see a
 * narrowed wave, so nobody in it is misled about who can read it). Owners and
 * admins can change it. The picker lists only the Community: its members who
 * can see the channel, and its roles. The server refuses anyone else.
 */
const WaveAudienceModal = ({ isOpen, onClose, waveId, fetchAPI, showToast, isMobile, currentUserId, onChanged }) => {
  const [view, setView] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('channel');
  const [userIds, setUserIds] = useState([]);
  const [roleIds, setRoleIds] = useState([]);
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const dirty = view?.canEdit && (mode !== view.mode
    || (mode === 'only' && (
      JSON.stringify([...userIds].sort()) !== JSON.stringify((view.users || []).map(u => u.id).sort())
      || JSON.stringify([...roleIds].sort()) !== JSON.stringify((view.roles || []).map(r => r.id).sort()))));
  const { backdropProps, bumped } = useModalDismiss({ onClose, hasUnsavedInput: () => dirty });

  const load = useCallback(async () => {
    setError(null);
    try {
      const v = await fetchAPI(`/waves/${waveId}/audience`);
      setView(v);
      setMode(v.mode === 'only' ? 'only' : 'channel');
      // A crew wave narrowed to its crew lists the crew by name when edited.
      setUserIds(v.mode === 'only' ? [...new Set([...(v.users || []).map(u => u.id), ...(v.crew?.memberIds || [])])] : [currentUserId]);
      setRoleIds((v.roles || []).map(r => r.id));
      if (v.canEdit) {
        const [m, r] = await Promise.all([
          fetchAPI(`/communities/${v.communityId}/members?channel=${encodeURIComponent(v.channelId)}`),
          fetchAPI(`/communities/${v.communityId}/roles`),
        ]);
        setMembers((m?.members || []).filter(x => x.canSeeChannel !== false));
        // The built-in owner and admin roles always see it; listing them would suggest otherwise.
        setRoles((r?.roles || []).filter(x => x.name !== 'owner' && x.name !== 'admin'));
      }
    } catch (err) {
      setError(err?.error || err?.message || 'Could not load who can see this');
    }
  }, [fetchAPI, waveId, currentUserId]);

  useEffect(() => { if (isOpen && waveId) { setView(null); setFilter(''); load(); } }, [isOpen, waveId, load]);

  if (!isOpen) return null;

  const save = async () => {
    setSaving(true);
    try {
      const body = mode === 'channel' ? { mode } : { mode, userIds, roleIds };
      const v = await fetchAPI(`/waves/${waveId}/audience`, { method: 'PUT', body });
      setView(v);
      showToast(mode === 'channel' ? `Open to #${v.channelName} again` : 'Narrowed', 'success');
      onChanged && onChanged();
      onClose();
    } catch (err) {
      showToast(err?.error || err?.message || 'Could not change who can see this', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const name = (m) => plainText(m.displayName || m.name || m.handle || '');
  const shown = members.filter(m => {
    const q = filter.trim().toLowerCase();
    return !q || name(m).toLowerCase().includes(q) || (m.handle || '').toLowerCase().includes(q);
  });
  const box = { padding: '10px 12px', border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', marginBottom: '10px' };
  const choice = (key, title, desc) => (
    <label key={key} style={{ ...box, display: 'flex', gap: '10px', cursor: 'pointer', borderColor: mode === key ? 'var(--accent-amber)' : 'var(--border-subtle)' }}>
      <input type="radio" name="audience-mode" checked={mode === key} onChange={() => setMode(key)} />
      <span>
        <span style={{ color: 'var(--text-primary)' }}>{title}</span>
        <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '2px' }}>{desc}</span>
      </span>
    </label>
  );
  const button = (primary, disabled = false) => ({
    opacity: disabled ? 0.45 : 1,
    padding: isMobile ? '0.55rem 0.9rem' : '0.45rem 0.8rem', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem',
    background: primary ? 'var(--accent-amber)' : 'transparent', color: primary ? 'var(--bg-base)' : 'var(--text-primary)',
    border: `1px solid ${primary ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: isMobile ? '12px' : '20px' }}
      {...backdropProps}>
      <div role="dialog" aria-label="Who can see this" style={{
        width: '100%', maxWidth: '460px', maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box',
        background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-hover))',
        border: bumped ? '2px solid var(--accent-amber)' : '2px solid var(--accent-amber)40', padding: isMobile ? '16px' : '22px',
        fontSize: '0.82rem', color: 'var(--text-secondary)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '8px' }}>
          <GlowText color="var(--accent-amber)" size="1.05rem">Who can see this</GlowText>
          <button onClick={onClose} style={button(false)}>Close</button>
        </div>

        {error && <div style={{ color: 'var(--accent-orange)' }}>{error}</div>}
        {!error && !view && <LoadingSpinner />}

        {view && view.mode === 'review' && (
          <div style={{ lineHeight: 1.5 }}>
            Some people in this {T.wave} can't see #{view.channelName}. It keeps the access it had until the
            community's owner or an admin decides: move it out of the community, or keep it for a community role.
          </div>
        )}
        {view && view.mode === 'federated' && (
          <div style={{ lineHeight: 1.5 }}>This {T.wave} has people on other servers, so it follows its own list of people.</div>
        )}

        {view && !view.canEdit && (view.mode === 'channel' || view.mode === 'only') && (
          <div style={{ lineHeight: 1.5 }}>
            {view.mode === 'channel' ? (
              <>Everyone who can see #{view.channelName}.</>
            ) : (
              <>
                Only{' '}
                {[...(view.users || []).map(u => plainText(u.name || u.handle)),
                  ...(view.roles || []).map(r => `everyone with the ${plainText(r.name)} role`),
                  ...(view.crew ? [`the ${T.crew} ${plainText(view.crew.name || '')}`] : [])].join(', ') || 'nobody named'}
                , and the community's owners and admins.
              </>
            )}
          </div>
        )}

        {view?.canEdit && (
          <>
            {choice('channel', `Everyone who can see #${view.channelName}`, `The ${T.wave} is open to the channel.`)}
            {choice('only', 'Only these people and roles', "Plus you, and the community's owners and admins, who see every narrowed " + T.wave + '.')}

            {mode === 'only' && (
              <div style={{ marginTop: '4px' }}>
                {roles.length > 0 && (
                  <>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', margin: '6px 0 4px' }}>ROLES</div>
                    {roles.map(r => (
                      <label key={r.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0', cursor: 'pointer' }}>
                        <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggle(roleIds, setRoleIds, r.id)} />
                        <span style={{ color: 'var(--text-primary)' }}>{plainText(r.name)}</span>
                      </label>
                    ))}
                  </>
                )}
                <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', margin: '10px 0 4px' }}>PEOPLE WHO CAN SEE #{view.channelName}</div>
                <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by name or handle" aria-label="Filter people"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px', fontFamily: 'inherit', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }} />
                <div style={{ maxHeight: '240px', overflowY: 'auto', marginTop: '4px' }}>
                  {shown.map(m => (
                    <label key={m.userId} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '4px 0', cursor: m.userId === currentUserId ? 'default' : 'pointer' }}>
                      <input type="checkbox" checked={m.userId === currentUserId || userIds.includes(m.userId)} disabled={m.userId === currentUserId}
                        onChange={() => toggle(userIds, setUserIds, m.userId)} />
                      <span style={{ color: 'var(--text-primary)' }}>{name(m)}</span>
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>@{m.handle}</span>
                    </label>
                  ))}
                  {shown.length === 0 && <div style={{ color: 'var(--text-dim)', padding: '4px 0' }}>Nobody matches.</div>}
                </div>
              </div>
            )}

            {view.mode !== mode && mode === 'only' && (
              <div style={{ color: 'var(--accent-orange)', fontSize: '0.75rem', marginTop: '8px', lineHeight: 1.45 }}>
                Everyone else who can see #{view.channelName} loses this {T.wave} at once.
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
              <button style={button(true, saving || !dirty)} disabled={saving || !dirty} onClick={save}>{saving ? '…' : 'SAVE'}</button>
              <button style={button(false)} disabled={saving} onClick={onClose}>CANCEL</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default WaveAudienceModal;
