import React, { useEffect, useState } from 'react';
import { T } from '../../config/terminology.js';
import { roleTitle } from './roleWords.js';

/**
 * Who can see a channel (v2.136.0). The server has had restricted channels
 * since v2.103.3 (`visibility: 'restricted'`, admitting only roles allowed
 * `channel.view`, plus anyone who manages channels), but nothing in the app
 * set them, so a channel could not be limited at all.
 *
 * Everything else a role's override says (other allows, any denies) is kept:
 * this changes only `channel.view`.
 */
const VIEW = 'channel.view';

const ChannelAccessEditor = ({ community, channel, roles, fetchAPI, showToast, onSaved, onCancel, styles }) => {
  const { action, hint, label } = styles;
  const [perms, setPerms] = useState(null); // [{ role_id, allow: [], deny: [] }]
  const [restricted, setRestricted] = useState(channel.visibility === 'restricted');
  const [chosen, setChosen] = useState([]);
  const [saving, setSaving] = useState(false);
  // Owners and admins see every channel; listing them would suggest otherwise.
  const choosable = roles.filter(r => r.name !== 'owner' && r.name !== 'admin');

  useEffect(() => {
    let alive = true;
    fetchAPI(`/communities/${community.id}/channels/${channel.id}/roles`).then(res => {
      if (!alive) return;
      const list = (res.permissions || []).map(p => ({
        role_id: p.role_id,
        allow: typeof p.allow === 'string' ? JSON.parse(p.allow || '[]') : (p.allow || []),
        deny: typeof p.deny === 'string' ? JSON.parse(p.deny || '[]') : (p.deny || []),
      }));
      setPerms(list);
      setChosen(list.filter(p => p.allow.includes(VIEW) && !p.deny.includes(VIEW)).map(p => p.role_id));
    }).catch(err => { if (alive) { setPerms([]); showToast(err?.data?.error || 'Could not load who can see it', 'error'); } });
    return () => { alive = false; };
  }, [community.id, channel.id, fetchAPI, showToast]);

  const save = async () => {
    setSaving(true);
    const base = `/communities/${community.id}/channels/${channel.id}`;
    try {
      // Roles first, then the switch: restricting before anyone is let in would
      // lock the members out for a moment, live.
      const wanted = new Set(restricted ? chosen : []);
      for (const role of choosable) {
        const p = perms.find(x => x.role_id === role.id) || { allow: [], deny: [] };
        const has = p.allow.includes(VIEW);
        if (wanted.has(role.id) === has) continue;
        const allow = wanted.has(role.id) ? [...p.allow, VIEW] : p.allow.filter(c => c !== VIEW);
        if (allow.length === 0 && p.deny.length === 0) {
          await fetchAPI(`${base}/roles/${role.id}`, { method: 'DELETE' });
        } else {
          await fetchAPI(`${base}/roles/${role.id}`, { method: 'PUT', body: { allow, deny: p.deny } });
        }
      }
      const visibility = restricted ? 'restricted' : 'members';
      if (visibility !== (channel.visibility || 'members')) {
        await fetchAPI(base, { method: 'PATCH', body: { visibility } });
      }
      showToast(restricted ? `#${channel.name} is limited to the roles chosen` : `Everyone in the community can see #${channel.name}`, 'success');
      onSaved && onSaved();
    } catch (err) {
      showToast(err?.data?.error || 'Could not change who can see it', 'error');
    } finally {
      setSaving(false);
    }
  };

  const radio = (value, title, desc) => (
    <label style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start', padding: '0.3rem 0', cursor: 'pointer' }}>
      <input type="radio" name={`access-${channel.id}`} checked={restricted === value} onChange={() => setRestricted(value)} />
      <span>
        <span style={{ color: 'var(--text-primary)', fontSize: '0.8rem' }}>{title}</span>
        <span style={{ display: 'block', ...hint, marginTop: 0 }}>{desc}</span>
      </span>
    </label>
  );

  return (
    <div style={{ padding: '0.45rem', border: '1px solid var(--border-subtle)', marginTop: '0.3rem' }}>
      <div style={label}>WHO CAN SEE #{channel.name}</div>
      {!perms ? <div style={hint}>Loading…</div> : (
        <>
          {radio(false, 'Everyone in the community', 'Every member sees the channel.')}
          {radio(true, 'Only these roles', `Plus the community's owners and admins, who see every channel. Everyone else loses the channel and its ${T.waves}.`)}
          {restricted && (
            <div style={{ paddingLeft: '1.4rem' }}>
              {choosable.length === 0 && <div style={hint}>No roles to choose yet besides owners and admins. Make one under ROLES.</div>}
              {choosable.map(r => (
                <label key={r.id} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', padding: '0.2rem 0', cursor: 'pointer', fontSize: '0.8rem' }}>
                  <input type="checkbox" checked={chosen.includes(r.id)}
                    onChange={() => setChosen(c => c.includes(r.id) ? c.filter(x => x !== r.id) : [...c, r.id])} />
                  <span style={{ color: 'var(--text-primary)' }}>{roleTitle(r)}</span>
                </label>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
            <button type="button" style={{ ...action, marginTop: 0 }} disabled={saving} onClick={save}>{saving ? '…' : 'Save'}</button>
            <button type="button" style={{ ...action, marginTop: 0 }} disabled={saving} onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
};

export default ChannelAccessEditor;
