import React, { useState } from 'react';
import { T } from '../../config/terminology.js';
import { plainText } from '../../utils/plainText.js';
import {
  CAPABILITY_GROUPS, OFFERED_CAPABILITIES, RANKS, rankTitle, rolePermissions,
} from './roleWords.js';

/**
 * The community's own roles (v2.139.0).
 *
 * The server has had custom roles since v2.96.0; until now the only ones were
 * those "Make it a role" created in review, and nothing could give, take,
 * rename or delete them. Limiting a channel (v2.136.0) and narrowing a
 * wave (v2.134.0) are both chosen by role, so this is where those choices come
 * from.
 *
 * The server's rules, mirrored here so nothing is offered that it would
 * refuse: you edit only roles ranked below you, and you add or take away only
 * powers you hold yourself. A role starts with no powers; what every member
 * can do comes from the member role, and a role adds to it.
 */

const MEMBER_DEFAULTS = new Set([
  'member.view', 'channel.view', 'channel.create_wave', 'channel.move_wave',
  'voice.connect', 'voice.speak', 'voice.video', 'voice.screen',
]);

const CommunityRolesEditor = ({
  community, roles, capabilities, myPriority, voiceEnabled, fetchAPI, showToast,
  styles, onChanged, isMobile = false,
}) => {
  const { action, danger, hint, label, input, row } = styles;
  const held = new Set(capabilities || []);
  const canManage = held.has('member.roles');
  const custom = roles.filter(r => !r.managed);

  const [editing, setEditing] = useState(null);      // role id, 'new', or null
  const [name, setName] = useState('');
  const [priority, setPriority] = useState(100);
  const [perms, setPerms] = useState([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [peopleFor, setPeopleFor] = useState(null);
  const [people, setPeople] = useState(null);

  const editable = (r) => canManage && !r.managed && Number(r.priority) < myPriority;
  const ranks = RANKS.filter(r => r.priority < myPriority);

  const startEdit = (role) => {
    setConfirmDelete(null); setPeopleFor(null);
    if (role === 'new') {
      setEditing('new'); setName(''); setPriority(100); setPerms([]);
    } else {
      setEditing(role.id); setName(plainText(role.name)); setPriority(Number(role.priority)); setPerms(rolePermissions(role));
    }
  };

  const toggle = (cap) => setPerms(p => (p.includes(cap) ? p.filter(c => c !== cap) : [...p, cap]));

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { showToast('A role needs a name', 'error'); return; }
    setSaving(true);
    try {
      if (editing === 'new') {
        await fetchAPI(`/communities/${community.id}/roles`, { method: 'POST', body: { name: trimmed, priority, permissions: perms } });
        showToast(`${trimmed} created`, 'success');
      } else {
        const role = roles.find(r => r.id === editing);
        const body = {};
        if (trimmed !== plainText(role.name)) body.name = trimmed;
        if (priority !== Number(role.priority)) body.priority = priority;
        const before = rolePermissions(role);
        if (before.length !== perms.length || before.some(c => !perms.includes(c))) body.permissions = perms;
        if (Object.keys(body).length) {
          await fetchAPI(`/communities/${community.id}/roles/${role.id}`, { method: 'PATCH', body });
          showToast(`${trimmed} saved`, 'success');
        }
      }
      setEditing(null);
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.data?.error || 'Could not save that role', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (role) => {
    try {
      await fetchAPI(`/communities/${community.id}/roles/${role.id}`, { method: 'DELETE' });
      showToast(`${plainText(role.name)} deleted`, 'success');
      setConfirmDelete(null);
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.data?.error || 'Could not delete that role', 'error');
    }
  };

  const showPeople = async (role) => {
    if (peopleFor === role.id) { setPeopleFor(null); return; }
    setPeopleFor(role.id); setPeople(null); setEditing(null); setConfirmDelete(null);
    try {
      const res = await fetchAPI(`/communities/${community.id}/members?role=${encodeURIComponent(role.id)}`);
      setPeople(res.members || []);
    } catch { setPeople([]); }
  };

  const takeAway = async (role, m) => {
    try {
      await fetchAPI(`/communities/${community.id}/members/${m.userId}/roles/${role.id}`, { method: 'DELETE' });
      setPeople(p => (p || []).filter(x => x.userId !== m.userId));
      showToast(`${m.displayName || m.handle} no longer has ${plainText(role.name)}`, 'success');
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.data?.error || 'Could not take that role away', 'error');
    }
  };

  const powersLine = (role) => {
    const p = rolePermissions(role).filter(c => OFFERED_CAPABILITIES.includes(c) && !MEMBER_DEFAULTS.has(c));
    if (!p.length) return 'No powers beyond a member’s: a name for choosing who sees channels and ' + T.waves + '.';
    const words = CAPABILITY_GROUPS.flatMap(g => g.caps).filter(([c]) => p.includes(c)).map(([, w]) => w().toLowerCase());
    return 'Can also ' + words.join('; ') + '.';
  };

  const editor = () => (
    <div style={{ padding: '0.5rem', border: '1px solid var(--border-subtle)', marginTop: '0.35rem' }}>
      <div style={label}>NAME</div>
      <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="Cast" autoFocus style={input} />

      <div style={{ ...label, marginTop: '0.7rem' }}>RANK</div>
      {ranks.map(r => (
        <label key={r.priority} style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start', padding: '0.25rem 0', cursor: 'pointer' }}>
          <input type="radio" name="role-rank" checked={priority === r.priority} onChange={() => setPriority(r.priority)} />
          <span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>{r.title}</span>
            <span style={{ ...hint, display: 'block', marginTop: 0 }}>{r.desc}</span>
          </span>
        </label>
      ))}
      {!ranks.some(r => r.priority === priority) && (
        <div style={hint}>Currently: {rankTitle(priority)}.</div>
      )}

      <div style={{ ...label, marginTop: '0.7rem' }}>WHAT IT LETS THEM DO</div>
      <div style={hint}>
        Every member can already do what is marked “every member”. Ticking it here still matters where a channel
        takes it away from members but allows this role.
      </div>
      {CAPABILITY_GROUPS.filter(g => !g.voice || voiceEnabled).map(g => (
        <div key={g.title} style={{ marginTop: '0.45rem' }}>
          <div style={{ fontSize: '0.65rem', letterSpacing: '0.08em', color: 'var(--text-dim)' }}>{g.title}</div>
          {g.caps.map(([cap, words]) => {
            const mine = held.has(cap);
            return (
              <label key={cap} style={{
                display: 'flex', gap: '0.45rem', alignItems: 'flex-start', padding: isMobile ? '0.3rem 0' : '0.15rem 0',
                cursor: mine ? 'pointer' : 'default', opacity: mine ? 1 : 0.55,
              }} title={mine ? undefined : 'Only someone who has this can give it or take it away'}>
                <input type="checkbox" checked={perms.includes(cap)} disabled={!mine} onChange={() => toggle(cap)} />
                <span style={{ fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.35 }}>
                  {words()}
                  {MEMBER_DEFAULTS.has(cap) && <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}> · every member</span>}
                </span>
              </label>
            );
          })}
        </div>
      ))}
      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
        <button type="button" onClick={save} disabled={saving} style={{ ...action, marginTop: 0, color: 'var(--accent-amber)' }}>
          {saving ? '…' : editing === 'new' ? 'Create role' : 'Save'}
        </button>
        <button type="button" onClick={() => setEditing(null)} disabled={saving} style={{ ...action, marginTop: 0 }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div>
      <div style={label}>COMMUNITY ROLES</div>
      <div style={hint}>
        Roles you make. Give one to people from the ⋮ beside them in MEMBERS, then choose it when limiting a channel
        or narrowing a {T.wave}{canManage ? '; or give it powers here' : ''}.
      </div>
      {custom.length === 0 && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>None yet.</div>
      )}
      {custom.map(r => (
        <div key={r.id} style={{ padding: '0.35rem 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8rem' }}>
          <div style={{ ...row, flexWrap: 'wrap', rowGap: '0.3rem' }}>
            <span style={{ minWidth: 0, flex: '1 1 8rem', overflowWrap: 'anywhere' }}>
              {plainText(r.name)}
              <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginLeft: 6 }}>
                {r.holders === 1 ? '1 person' : `${r.holders || 0} people`} · {rankTitle(r.priority).toLowerCase()}
              </span>
            </span>
            <span style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', flexShrink: 0 }}>
              <button type="button" onClick={() => showPeople(r)} aria-expanded={peopleFor === r.id}
                style={{ ...action, marginTop: 0, color: peopleFor === r.id ? 'var(--accent-amber)' : 'var(--text-primary)' }}>People</button>
              {editable(r) && (
                <>
                  <button type="button" onClick={() => startEdit(r)} style={{ ...action, marginTop: 0 }}>Edit</button>
                  <button type="button" onClick={() => { setConfirmDelete(r.id); setEditing(null); setPeopleFor(null); }}
                    style={{ ...action, marginTop: 0 }}>Delete</button>
                </>
              )}
            </span>
          </div>
          <div style={{ ...hint, marginTop: '0.15rem' }}>{powersLine(r)}</div>

          {editing === r.id && editor()}

          {confirmDelete === r.id && (
            <div style={{ marginTop: '0.35rem' }}>
              <div style={{ ...hint, marginTop: 0, marginBottom: '0.3rem' }}>
                Delete {plainText(r.name)}? {r.holders ? (r.holders === 1 ? 'The 1 person with it loses it. ' : `The ${r.holders} people with it lose it. `) : ''}
                {r.channels ? `${r.channels === 1 ? 'A channel has' : `${r.channels} channels have`} rules for it, which go with it. ` : ''}
                {r.waves ? `${r.waves === 1 ? `A ${T.wave} is` : `${r.waves} ${T.waves} are`} shown to it: its people no longer see ${r.waves === 1 ? 'it' : 'them'} unless something else lets them. ` : ''}
                This cannot be undone.
              </div>
              <button type="button" onClick={() => remove(r)} style={{ ...danger, marginTop: 0 }}>Yes, delete it</button>
              <button type="button" onClick={() => setConfirmDelete(null)} style={{ ...action, marginTop: 0, marginLeft: 6 }}>Keep it</button>
            </div>
          )}

          {peopleFor === r.id && (
            <div style={{ marginTop: '0.3rem', paddingLeft: '0.6rem', borderLeft: '1px solid var(--border-subtle)' }}>
              {!people ? <div style={hint}>Loading…</div>
                : people.length === 0 ? <div style={{ ...hint, marginTop: 0 }}>Nobody has it. Give it from the ⋮ beside someone in MEMBERS.</div>
                : people.map(m => {
                  const top = (m.roles || []).reduce((max, x) => Math.max(max, Number(x.priority) || 0), 0);
                  return (
                    <div key={m.userId} style={{ ...row, padding: '0.15rem 0', fontSize: '0.78rem' }}>
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        {m.displayName || m.handle}
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginLeft: 6 }}>@{m.handle}</span>
                      </span>
                      {canManage && top < myPriority && (
                        <button type="button" onClick={() => takeAway(r, m)} style={{ ...action, marginTop: 0, flexShrink: 0 }}>Take away</button>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      ))}

      {canManage && ranks.length > 0 && (
        editing === 'new' ? editor() : (
          <button type="button" onClick={() => startEdit('new')} style={action}>New role</button>
        )
      )}
    </div>
  );
};

export default CommunityRolesEditor;
