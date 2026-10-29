import React, { useState, useEffect, useCallback } from 'react';
import { T } from '../../config/terminology.js';
import { storage } from '../../utils/storage.js';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import { ContainerTile } from '../waves/WaveRail.jsx';
import { uploadFile } from '../../utils/uploads.js';

/**
 * Manage Community (v2.99.0, Phase 6; redesigned v2.124.0).
 *
 * Every control here is rendered from the capability list the server returned,
 * not from a role name. Hiding a control the caller cannot use is a courtesy —
 * the server refuses regardless — but rendering from capabilities rather than
 * from "are they an admin" keeps the UI honest when a Community has custom
 * roles that do not map onto the four built-in ones.
 *
 * v2.124.0: one long column of always-open boxes became an accordion, one
 * section open at a time, the way Settings works (v2.115.0). It also gained the
 * controls the server had supported since v2.94.0 with no way to reach them:
 * editing the Community, appointing admins and moderators, removing and banning
 * members, leaving, and closing it.
 */

// What each built-in role is for, in a line. The capability sets themselves
// live in server/lib/communities/capabilities.js.
const ROLE_LINES = {
  owner: 'Everything, including handing the community over and closing it.',
  admin: 'Runs the community: details, channels, members, roles below admin.',
  moderator: 'Keeps order: removes and bans members, moderates content, runs voice.',
};
const STAFF = ['admin', 'moderator'];
const TITLE = { owner: 'Owner', admin: 'Admin', moderator: 'Moderator', member: 'Member' };

const topPriority = (roles = []) => roles.reduce((max, r) => Math.max(max, Number(r.priority) || 0), 0);

const CommunitySettingsPanel = ({ community, capabilities, myRoles = [], fetchAPI, showToast, onChanged, onGone, focus = null, voiceEnabled = false, isMobile = false }) => {
  const can = (c) => (capabilities || []).includes(c);
  const myId = storage.getUser()?.id;
  const myPriority = topPriority(myRoles);

  // One section open at a time. A menu item that named a section opens it.
  const [open, setOpen] = useState(() => ({ channels: 'channels', invites: 'invites' }[focus] || null));
  useEffect(() => {
    const target = { channels: 'channels', invites: 'invites' }[focus];
    if (target) setOpen(target);
  }, [focus]);
  const toggle = (key) => setOpen(o => (o === key ? null : key));

  // ABOUT
  const [aboutName, setAboutName] = useState(community.name || '');
  const [aboutDesc, setAboutDesc] = useState(community.description || '');
  const [aboutVis, setAboutVis] = useState(community.visibility || 'private');
  useEffect(() => {
    setAboutName(community.name || '');
    setAboutDesc(community.description || '');
    setAboutVis(community.visibility || 'private');
  }, [community.id, community.name, community.description, community.visibility]);

  // MEMBERS
  const [members, setMembers] = useState([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [membersMore, setMembersMore] = useState(false);
  const [memberFilter, setMemberFilter] = useState('');
  const [actionsFor, setActionsFor] = useState(null);   // member whose actions are open
  const [confirming, setConfirming] = useState(null);   // { userId, kind: 'remove' | 'ban' | 'handover' }
  const [banReason, setBanReason] = useState('');
  const [roles, setRoles] = useState([]);                // the Community's roles, for ids
  const [staff, setStaff] = useState([]);

  // CHANNELS
  const [channels, setChannels] = useState([]);
  const [channelName, setChannelName] = useState('');
  const [channelType, setChannelType] = useState('text'); // 'text' | 'voice' | 'stage'
  const [renaming, setRenaming] = useState(null);
  const [renameTo, setRenameTo] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  // INVITES
  const [invites, setInvites] = useState([]);
  const [mintedToken, setMintedToken] = useState(null);
  const [remoteAddress, setRemoteAddress] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // LEAVE OR CLOSE — handing over (v2.108.0, CORTEX-COMM-021) lives here too.
  const [transfer, setTransfer] = useState(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const loadMembers = useCallback(async (q = '', offset = 0) => {
    if (!can('member.view')) return;
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (offset) params.set('offset', String(offset));
      const m = await fetchAPI(`/communities/${community.id}/members${params.toString() ? `?${params}` : ''}`);
      setMembers(prev => (offset ? [...prev, ...(m.members || [])] : (m.members || [])));
      // The server pages this from v2.105.0. Showing 500 of 3000 as though it
      // were the whole list would be a quietly wrong answer.
      setMemberTotal(typeof m.total === 'number' ? m.total : (m.members || []).length);
      setMembersMore(Boolean(m.hasMore));
    } catch { /* the rest of the panel is still useful */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.id, fetchAPI, capabilities]);

  const loadStaff = useCallback(async () => {
    if (!can('member.view')) return;
    try {
      const m = await fetchAPI(`/communities/${community.id}/members?staff=1`);
      setStaff(m.members || []);
    } catch { /* ditto */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.id, fetchAPI, capabilities]);

  const load = useCallback(async () => {
    if (can('channel.view')) {
      try {
        const res = await fetchAPI(`/communities/${community.id}/channels`);
        setChannels(res.channels || []);
      } catch { /* the rest of the panel is still useful */ }
    }
    if (can('member.roles')) {
      try {
        const r = await fetchAPI(`/communities/${community.id}/roles`);
        setRoles(r.roles || []);
      } catch { /* role changes are simply not offered */ }
    }
    if (can('community.transfer')) {
      try {
        const t = await fetchAPI(`/communities/${community.id}/transfer`);
        setTransfer(t.transfer || null);
      } catch { /* ditto */ }
    }
    if (can('member.invite')) {
      try {
        const i = await fetchAPI(`/communities/${community.id}/invites`);
        setInvites(i.invites || []);
      } catch { /* ditto */ }
    }
    loadStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.id, fetchAPI, capabilities]);

  useEffect(() => { load(); }, [load]);

  // The member list follows the filter box, searched on the server so it
  // covers people beyond the first page.
  useEffect(() => {
    const timer = setTimeout(() => loadMembers(memberFilter), memberFilter ? 300 : 0);
    return () => clearTimeout(timer);
  }, [memberFilter, loadMembers]);

  const refreshPeople = () => { loadMembers(memberFilter); loadStaff(); };

  /**
   * Find people on this node to add directly.
   *
   * Debounced, and the current members are filtered out so the list does not
   * offer to add somebody who is already here. Two characters minimum is the
   * server's rule, not ours — it refuses shorter queries rather than returning
   * the whole directory.
   */
  useEffect(() => {
    if (memberSearch.trim().length < 2) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const results = await fetchAPI(`/users/search?q=${encodeURIComponent(memberSearch.trim())}`);
        const existing = new Set(members.map(m => m.userId));
        setSearchResults((Array.isArray(results) ? results : []).filter(u => !existing.has(u.id)));
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [memberSearch, fetchAPI, members]);

  // ----- ABOUT -----

  const saveAbout = async () => {
    const body = {};
    if (aboutName.trim() && aboutName.trim() !== community.name) body.name = aboutName.trim();
    if ((aboutDesc || '') !== (community.description || '')) body.description = aboutDesc;
    if (aboutVis !== community.visibility) body.visibility = aboutVis;
    if (!Object.keys(body).length) return;
    try {
      await fetchAPI(`/communities/${community.id}`, { method: 'PATCH', body });
      showToast('Community updated', 'success');
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not update the community', 'error');
    }
  };

  // Logo (v2.125.0): replaces the initials on the rail and beside the name.
  const logoInputRef = React.useRef(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const uploadLogo = async (file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('That image is over 2 MB', 'error'); return; }
    setLogoBusy(true);
    try {
      const form = new FormData();
      form.append('logo', file);
      await uploadFile(`/communities/${community.id}/logo`, form, { label: file.name || 'Community logo', size: file.size });
      showToast('Logo updated', 'success');
      onChanged && onChanged();
    } catch (err) {
      if (!err?.cancelled) showToast(err?.message || 'Could not upload that logo', 'error');
    } finally {
      setLogoBusy(false);
      if (logoInputRef.current) logoInputRef.current.value = '';
    }
  };
  const removeLogo = async () => {
    setLogoBusy(true);
    try {
      await fetchAPI(`/communities/${community.id}/logo`, { method: 'DELETE' });
      showToast('Logo removed', 'success');
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not remove the logo', 'error');
    } finally { setLogoBusy(false); }
  };

  // ----- MEMBERS -----

  const roleByName = (name) => roles.find(r => r.name === name);
  const levelOf = (m) => (m.roles.some(r => r.name === 'owner') ? 'owner'
    : STAFF.find(name => m.roles.some(r => r.name === name)) || 'member');

  /**
   * The role changes this person may make to `m`, mirroring the server's two
   * rules: you act only on people below you, and you grant only roles below
   * your own. So an owner appoints admins, and an admin appoints moderators.
   */
  const levelChoices = (m) => {
    if (!can('member.roles') || m.userId === myId) return [];
    if (myPriority <= topPriority(m.roles)) return [];
    const current = levelOf(m);
    if (current === 'owner') return [];
    return ['admin', 'moderator', 'member'].filter(level => {
      if (level === current) return false;
      if (level === 'member') return true;
      const role = roleByName(level);
      return role && Number(role.priority) < myPriority;
    });
  };

  // Exactly one staff role at a time: grant the new one first, then drop the
  // other, so the person is never left with less than either.
  const setLevel = async (m, level) => {
    try {
      const target = roleByName(level);
      if (STAFF.includes(level) && target && !m.roles.some(r => r.id === target.id)) {
        await fetchAPI(`/communities/${community.id}/members/${m.userId}/roles/${target.id}`, { method: 'PUT' });
      }
      for (const r of m.roles.filter(r => STAFF.includes(r.name) && r.name !== level)) {
        await fetchAPI(`/communities/${community.id}/members/${m.userId}/roles/${r.id}`, { method: 'DELETE' });
      }
      showToast(`${m.displayName || m.handle} is now ${level === 'admin' ? 'an admin' : level === 'moderator' ? 'a moderator' : 'a member'}`, 'success');
      setActionsFor(null);
      refreshPeople();
    } catch (err) {
      showToast(err?.error || 'Could not change that role', 'error');
      refreshPeople();
    }
  };

  const removeMember = async (m) => {
    try {
      await fetchAPI(`/communities/${community.id}/members/${m.userId}`, { method: 'DELETE' });
      showToast(`${m.displayName || m.handle} removed`, 'success');
      setConfirming(null); setActionsFor(null);
      refreshPeople();
    } catch (err) {
      showToast(err?.error || 'Could not remove them', 'error');
    }
  };

  const banMember = async (m) => {
    try {
      await fetchAPI(`/communities/${community.id}/bans`, {
        method: 'POST', body: { userId: m.userId, ...(banReason.trim() ? { reason: banReason.trim() } : {}) },
      });
      showToast(`${m.displayName || m.handle} banned`, 'success');
      setConfirming(null); setActionsFor(null); setBanReason('');
      refreshPeople();
    } catch (err) {
      showToast(err?.error || 'Could not ban them', 'error');
    }
  };

  const offerHandover = async (member) => {
    try {
      // Step-up re-authentication is requested by fetchAPI if the server asks.
      const res = await fetchAPI(`/communities/${community.id}/transfer`, {
        method: 'POST', body: { toUserId: member.userId },
        stepUpReason: `Confirm it is you before offering ${community.name} to someone else.`,
      });
      setTransfer(res.transfer);
      setConfirming(null); setActionsFor(null);
      showToast(`Offered to ${member.displayName || member.handle}. Nothing changes until they accept.`, 'success');
    } catch (err) {
      showToast(err.message || 'Could not make the offer', 'error');
    }
  };

  const withdrawHandover = async () => {
    if (!transfer) return;
    try {
      await fetchAPI(`/communities/${community.id}/transfer/${transfer.id}`, { method: 'DELETE' });
      setTransfer(null);
      showToast('Offer withdrawn', 'success');
    } catch (err) {
      showToast(err.message || 'Could not withdraw the offer', 'error');
      load();
    }
  };

  // ----- CHANNELS -----

  const renameChannel = async (channel) => {
    const name = renameTo.trim();
    if (!name || name === channel.name) { setRenaming(null); return; }
    try {
      await fetchAPI(`/communities/${community.id}/channels/${channel.id}`, {
        method: 'PATCH', body: { name },
      });
      setRenaming(null);
      setRenameTo('');
      showToast('Channel renamed', 'success');
      load();
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not rename that channel', 'error');
    }
  };

  /**
   * Deleting a channel does NOT delete the waves in it — they fall back to
   * uncontained, which is the normal state for most waves anyway. The confirm
   * step says so, because "delete" is a frightening word next to something
   * holding conversations.
   */
  const deleteChannel = async (channel) => {
    try {
      await fetchAPI(`/communities/${community.id}/channels/${channel.id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      showToast(`#${channel.name} removed`, 'success');
      load();
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not delete that channel', 'error');
    }
  };

  // A stage is a voice channel run differently (v2.119.0), so it is a third
  // choice here and a switch on the channel afterwards, not a separate type.
  const toggleStage = async (channel) => {
    try {
      await fetchAPI(`/communities/${community.id}/channels/${channel.id}`, {
        method: 'PATCH', body: { stage: !channel.stage },
      });
      showToast(channel.stage ? `${channel.name} is an ordinary voice channel` : `${channel.name} is a stage`, 'success');
      load();
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not change that channel', 'error');
    }
  };

  const createChannel = async () => {
    const name = channelName.trim();
    if (!name) return;
    try {
      const choice = voiceEnabled ? channelType : 'text';
      const type = choice === 'stage' ? 'voice' : choice;
      await fetchAPI(`/communities/${community.id}/channels`, { method: 'POST', body: { name, type, stage: choice === 'stage' } });
      setChannelName('');
      setChannelType('text');
      showToast(choice === 'stage' ? 'Stage created' : type === 'voice' ? 'Voice channel created' : 'Channel created', 'success');
      load();
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not create that channel', 'error');
    }
  };

  // ----- INVITES -----

  const addMember = async (user) => {
    try {
      await fetchAPI(`/communities/${community.id}/members`, {
        method: 'POST', body: { userId: user.id },
      });
      showToast(`${user.displayName || user.handle} added`, 'success');
      setMemberSearch('');
      setSearchResults([]);
      refreshPeople();
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not add that person', 'error');
    }
  };

  const mintInvite = async () => {
    try {
      const res = await fetchAPI(`/communities/${community.id}/invites`, { method: 'POST', body: {} });
      // Shown once and never again: the server stores only a hash, so this is
      // the sole moment the code exists anywhere it can be read.
      setMintedToken(res.invite.token);
      load();
    } catch (err) {
      showToast(err?.error || 'Could not create an invite', 'error');
    }
  };

  const inviteRemote = async () => {
    const address = remoteAddress.trim();
    if (!address) return;
    try {
      await fetchAPI(`/communities/${community.id}/members/remote`, { method: 'POST', body: { address } });
      setRemoteAddress('');
      showToast(`Invitation waiting for ${address}`, 'success');
    } catch (err) {
      showToast(err?.error || 'Could not invite that address', 'error');
    }
  };

  const revokeInvite = async (id) => {
    try {
      await fetchAPI(`/communities/${community.id}/invites/${id}`, { method: 'DELETE' });
      load();
    } catch { showToast('Could not revoke that invite', 'error'); }
  };

  // ----- LEAVE OR CLOSE -----

  const leave = async () => {
    try {
      await fetchAPI(`/communities/${community.id}/leave`, { method: 'POST' });
      showToast(`You left ${community.name}`, 'success');
      onGone && onGone();
    } catch (err) {
      setConfirmLeave(false);
      showToast(err?.error || 'Could not leave', 'error');
    }
  };

  const closeCommunity = async () => {
    try {
      await fetchAPI(`/communities/${community.id}`, {
        method: 'DELETE',
        stepUpReason: `Confirm it is you before closing ${community.name}.`,
      });
      showToast(`${community.name} closed`, 'success');
      onGone && onGone();
    } catch (err) {
      setConfirmClose(false);
      showToast(err?.error || err?.message || 'Could not close the community', 'error');
    }
  };

  // ----- styles -----

  const label = { fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--accent-amber)' };
  const hint = { fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem', lineHeight: 1.4 };
  const input = { width: '100%', padding: '0.4rem', fontFamily: 'inherit', marginTop: '0.3rem', boxSizing: 'border-box' };
  const action = {
    marginTop: '0.35rem', padding: isMobile ? '0.5rem 0.7rem' : '0.4rem 0.6rem', cursor: 'pointer', fontFamily: 'inherit',
    background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
  };
  const danger = { ...action, color: 'var(--accent-orange, var(--accent-amber))', borderColor: 'var(--accent-orange, var(--border-primary))' };
  const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' };
  const sub = { marginTop: '0.9rem', paddingTop: '0.6rem', borderTop: '1px solid var(--border-subtle)' };
  const section = (key, title, badge) => ({
    title, badge, isMobile, dense: true,
    isOpen: open === key, onToggle: () => toggle(key),
  });

  const who = (m) => (
    <span style={{ minWidth: 0 }}>
      {m.displayName || m.handle}
      <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginLeft: 6 }}>@{m.handle}</span>
      {m.isCrossPort && (
        <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginLeft: 6 }}>· from {m.homeNode}</span>
      )}
    </span>
  );

  const memberActions = (m) => {
    const outranks = m.userId !== myId && myPriority > topPriority(m.roles);
    return {
      levels: levelChoices(m),
      remove: can('member.remove') && outranks,
      ban: can('member.ban') && outranks,
      handover: can('community.transfer') && !transfer && m.userId !== myId && levelOf(m) !== 'owner',
    };
  };

  const isMember = myRoles.length > 0;

  return (
    <div>
      {/* ABOUT — everyone may read it; managers edit it. */}
      <CollapsibleSection {...section('about', 'ABOUT')}>
        {can('community.manage') ? (
          <div>
            <div style={label}>LOGO</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
              <ContainerTile name={community.name} logoUrl={community.logo_url} size={56} />
              <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
                style={{ display: 'none' }} onChange={e => uploadLogo(e.target.files?.[0])} />
              <button onClick={() => logoInputRef.current?.click()} disabled={logoBusy} style={{ ...action, marginTop: 0 }}>
                {community.logo_url ? 'Replace logo' : 'Upload logo'}
              </button>
              {community.logo_url && (
                <button onClick={removeLogo} disabled={logoBusy} style={{ ...action, marginTop: 0 }}>Remove</button>
              )}
            </div>
            <div style={hint}>Square works best; it is cropped to a square either way. Without one, the initials are used.</div>
            <div style={{ ...label, marginTop: '0.6rem' }}>NAME</div>
            <input value={aboutName} onChange={e => setAboutName(e.target.value)} maxLength={80} style={input} />
            <div style={{ ...label, marginTop: '0.6rem' }}>DESCRIPTION</div>
            <textarea value={aboutDesc} onChange={e => setAboutDesc(e.target.value)} maxLength={1000} rows={3}
              style={{ ...input, resize: 'vertical' }} />
            <div style={{ ...label, marginTop: '0.6rem' }}>WHO CAN FIND IT</div>
            <select value={aboutVis} onChange={e => setAboutVis(e.target.value)} style={input}>
              <option value="private">Private — invite only</option>
              <option value="unlisted">Unlisted — anyone with the link</option>
              <option value="public">Public — anyone can find it</option>
            </select>
            <button onClick={saveAbout} style={action}>Save</button>
          </div>
        ) : (
          <div style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
            {community.description || <span style={{ color: 'var(--text-dim)' }}>No description.</span>}
            <div style={hint}>
              {{ private: 'Private — invite only.', unlisted: 'Unlisted — anyone with the link.', public: 'Public — anyone on this server can find it.' }[community.visibility]}
            </div>
          </div>
        )}
      </CollapsibleSection>

      {can('channel.view') && (
        <CollapsibleSection {...section('channels', 'CHANNELS', String(channels.length))}>
          {channels.length === 0 && <div style={hint}>No channels yet.</div>}
          {channels.map(ch => (
            <div key={ch.id} style={{ padding: '0.3rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
              {renaming === ch.id ? (
                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                  <input
                    value={renameTo}
                    onChange={e => setRenameTo(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') renameChannel(ch); if (e.key === 'Escape') setRenaming(null); }}
                    maxLength={60}
                    autoFocus
                    style={{ ...input, marginTop: 0, flex: 1 }}
                  />
                  <button onClick={() => renameChannel(ch)} style={{ ...action, marginTop: 0 }}>Save</button>
                  <button onClick={() => setRenaming(null)} style={{ ...action, marginTop: 0 }}>Cancel</button>
                </div>
              ) : confirmDelete === ch.id ? (
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '0.25rem' }}>
                    {ch.type === 'voice'
                      ? <>Delete 🔊 {ch.name}? Anyone in it is disconnected.</>
                      : <>Delete #{ch.name}? The {T.waves} in it are not deleted — they go back to
                    being ordinary {T.waves}.</>}
                  </div>
                  <button onClick={() => deleteChannel(ch)} style={{ ...danger, marginTop: 0 }}>
                    Yes, delete the channel
                  </button>
                  <button onClick={() => setConfirmDelete(null)} style={{ ...action, marginTop: 0, marginLeft: 6 }}>Keep it</button>
                </div>
              ) : (
                <div style={row}>
                  <span style={{ fontSize: '0.82rem', minWidth: 0 }}>{ch.type === 'voice' ? (ch.stage ? '🎤' : '🔊') : '#'} {ch.name}</span>
                  {can('channel.manage') && (
                    <span style={{ display: 'flex', gap: '0.3rem', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {ch.type === 'voice' && (
                        <button
                          onClick={() => toggleStage(ch)}
                          style={{ ...action, marginTop: 0 }}
                          title={ch.stage ? 'Let everyone speak' : 'Only hosts speak; others raise a hand'}
                        >{ch.stage ? 'Not a stage' : 'Make stage'}</button>
                      )}
                      <button
                        onClick={() => { setRenaming(ch.id); setRenameTo(ch.name); setConfirmDelete(null); }}
                        style={{ ...action, marginTop: 0 }}
                      >Rename</button>
                      <button
                        onClick={() => { setConfirmDelete(ch.id); setRenaming(null); }}
                        style={{ ...action, marginTop: 0 }}
                      >Delete</button>
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}

          {can('channel.manage') && (
            <div style={sub}>
              <div style={label}>NEW CHANNEL</div>
              <input
                value={channelName}
                onChange={e => setChannelName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') createChannel(); }}
                placeholder="Productions"
                maxLength={60}
                style={input}
              />
              {voiceEnabled && (
                <div role="radiogroup" aria-label="Channel type" style={{ display: 'flex', gap: '0.35rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                  {[['text', '# Text'], ['voice', '🔊 Voice'], ['stage', '🎤 Stage']].map(([value, text]) => (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={channelType === value}
                      onClick={() => setChannelType(value)}
                      style={{
                        ...action, marginTop: 0,
                        borderColor: channelType === value ? 'var(--accent-amber)' : 'var(--border-primary)',
                        color: channelType === value ? 'var(--accent-amber)' : 'var(--text-primary)',
                      }}
                    >{text}</button>
                  ))}
                </div>
              )}
              <button onClick={createChannel} style={action}>{!voiceEnabled || channelType === 'text' ? 'Create channel' : channelType === 'stage' ? 'Create stage' : 'Create voice channel'}</button>
              <div style={hint}>
                {channelType === 'voice' && voiceEnabled
                  ? 'A voice channel is a room people drop in and out of, with voice, video and screen sharing. It does not hold ' + T.waves + '.'
                  : channelType === 'stage' && voiceEnabled
                    ? 'A stage is a voice channel where the hosts (moderators) speak and everyone else listens, raising a hand to be brought up.'
                    : <>A channel holds {T.waves}. It is not a conversation itself.</>}
              </div>
            </div>
          )}
        </CollapsibleSection>
      )}

      {can('member.view') && (
        <CollapsibleSection {...section('members', 'MEMBERS', String(memberFilter ? members.length : memberTotal))}>
          <input
            value={memberFilter}
            onChange={e => setMemberFilter(e.target.value)}
            placeholder="Filter by name or handle"
            aria-label="Filter members"
            style={{ ...input, marginTop: 0, marginBottom: '0.4rem' }}
          />
          {members.length === 0 && <div style={hint}>{memberFilter ? 'Nobody matches.' : 'No members.'}</div>}
          {members.map(m => {
            const acts = memberActions(m);
            const hasActions = acts.levels.length || acts.remove || acts.ban || acts.handover;
            const level = levelOf(m);
            const isOpenRow = actionsFor === m.userId;
            return (
              <div key={m.userId} style={{ fontSize: '0.78rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={row}>
                  {who(m)}
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexShrink: 0 }}>
                    {level !== 'member' && (
                      <span style={{ fontSize: '0.65rem', letterSpacing: '0.05em', color: level === 'owner' ? 'var(--accent-amber)' : 'var(--accent-teal)' }}>
                        {TITLE[level].toUpperCase()}
                      </span>
                    )}
                    {hasActions ? (
                      <button
                        onClick={() => { setActionsFor(isOpenRow ? null : m.userId); setConfirming(null); }}
                        aria-label={`Actions for ${m.displayName || m.handle}`}
                        aria-expanded={isOpenRow}
                        style={{ ...action, marginTop: 0, padding: isMobile ? '0.3rem 0.7rem' : '0.15rem 0.5rem', color: isOpenRow ? 'var(--accent-amber)' : 'var(--text-dim)' }}
                      >⋮</button>
                    ) : null}
                  </span>
                </div>

                {isOpenRow && !confirming && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.3rem' }}>
                    {acts.levels.map(lv => (
                      <button key={lv} onClick={() => setLevel(m, lv)} style={{ ...action, marginTop: 0 }}>
                        {lv === 'member' ? `Remove ${TITLE[level].toLowerCase()}` : `Make ${TITLE[lv].toLowerCase()}`}
                      </button>
                    ))}
                    {acts.handover && (
                      <button onClick={() => setConfirming({ userId: m.userId, kind: 'handover' })} style={{ ...action, marginTop: 0 }}>Hand over</button>
                    )}
                    {acts.remove && (
                      <button onClick={() => setConfirming({ userId: m.userId, kind: 'remove' })} style={{ ...danger, marginTop: 0 }}>Remove</button>
                    )}
                    {acts.ban && (
                      <button onClick={() => setConfirming({ userId: m.userId, kind: 'ban' })} style={{ ...danger, marginTop: 0 }}>Ban</button>
                    )}
                  </div>
                )}

                {isOpenRow && confirming?.userId === m.userId && (
                  <div style={{ marginTop: '0.35rem' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '0.25rem', lineHeight: 1.4 }}>
                      {confirming.kind === 'remove' && <>Remove {m.displayName || m.handle} from {community.name}? They can rejoin if they are invited again.</>}
                      {confirming.kind === 'ban' && <>Ban {m.displayName || m.handle}? They are removed and cannot rejoin until the ban is lifted.</>}
                      {confirming.kind === 'handover' && <>Offer {community.name} to {m.displayName || m.handle}? If they accept they become its owner and
                        you stay on as an admin. Nothing changes until they say yes.</>}
                    </div>
                    {confirming.kind === 'ban' && (
                      <input value={banReason} onChange={e => setBanReason(e.target.value)} maxLength={500}
                        placeholder="Reason (optional, kept in the audit log)" style={{ ...input, marginTop: 0, marginBottom: '0.3rem' }} />
                    )}
                    <button
                      onClick={() => (confirming.kind === 'remove' ? removeMember(m) : confirming.kind === 'ban' ? banMember(m) : offerHandover(m))}
                      style={{ ...(confirming.kind === 'handover' ? action : danger), marginTop: 0, ...(confirming.kind === 'handover' ? { color: 'var(--accent-amber)' } : {}) }}
                    >
                      {confirming.kind === 'remove' ? 'Yes, remove' : confirming.kind === 'ban' ? 'Yes, ban' : 'Yes, offer it'}
                    </button>
                    <button onClick={() => setConfirming(null)} style={{ ...action, marginTop: 0, marginLeft: 6 }}>Cancel</button>
                  </div>
                )}
              </div>
            );
          })}
          {membersMore && (
            <button onClick={() => loadMembers(memberFilter, members.length)} style={action}>
              Show more ({members.length} of {memberTotal})
            </button>
          )}
        </CollapsibleSection>
      )}

      {can('member.invite') && (
        <CollapsibleSection {...section('invites', 'INVITES', invites.filter(i => !i.revoked_at).length ? String(invites.filter(i => !i.revoked_at).length) : undefined)}>
          <div style={label}>ADD SOMEONE FROM THIS SERVER</div>
          <input
            value={memberSearch}
            onChange={e => setMemberSearch(e.target.value)}
            placeholder="Search by name or handle"
            style={input}
          />
          {memberSearch.trim().length === 1 && (
            <div style={hint}>Keep typing…</div>
          )}
          {searchResults.map(u => (
            <div key={u.id} style={{ ...row, gap: '0.5rem', padding: '0.25rem 0' }}>
              <span style={{ fontSize: '0.8rem', minWidth: 0 }}>
                {u.displayName || u.handle}
                <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginLeft: 6 }}>@{u.handle}</span>
              </span>
              <button onClick={() => addMember(u)} style={{ ...action, marginTop: 0, flexShrink: 0 }}>Add</button>
            </div>
          ))}
          {memberSearch.trim().length >= 2 && searchResults.length === 0 && (
            <div style={hint}>Nobody found who is not already a member.</div>
          )}
          <div style={hint}>They join straight away — this adds them rather than asking them.</div>

          <div style={sub}>
            <div style={label}>INVITE CODES</div>
            <button onClick={mintInvite} style={action}>Create an invite code</button>
            {mintedToken && (
              <div style={{ marginTop: '0.4rem' }}>
                <code style={{
                  display: 'block', wordBreak: 'break-all', fontSize: '0.75rem',
                  background: 'var(--bg-base)', padding: '0.4rem', border: '1px solid var(--border-primary)',
                }}>{mintedToken}</code>
                <div style={hint}>Copy this now — it is shown once and cannot be retrieved later.</div>
              </div>
            )}
            {invites.length > 0 && (
              <div style={{ marginTop: '0.5rem' }}>
                {invites.map(inv => (
                  <div key={inv.id} style={{ ...row, fontSize: '0.75rem', color: 'var(--text-dim)', padding: '0.2rem 0' }}>
                    <span>
                      {inv.revoked_at ? 'revoked' : `used ${inv.use_count}${inv.max_uses ? ` / ${inv.max_uses}` : ''}`}
                    </span>
                    {!inv.revoked_at && (
                      <button onClick={() => revokeInvite(inv.id)} style={{ ...action, marginTop: 0 }}>Revoke</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={sub}>
            <div style={label}>INVITE SOMEONE FROM ANOTHER SERVER</div>
            <input
              value={remoteAddress}
              onChange={e => setRemoteAddress(e.target.value)}
              placeholder="alice@their-server"
              style={input}
            />
            <button onClick={inviteRemote} style={action}>Send invitation</button>
            <div style={hint}>
              They do not need an account here. The invitation waits until they
              first sign in from their own server.
            </div>
          </div>
        </CollapsibleSection>
      )}

      {can('member.view') && (
        <CollapsibleSection {...section('roles', 'ROLES', String(staff.length))}>
          {['owner', 'admin', 'moderator'].map(name => {
            const holders = staff.filter(m => levelOf(m) === name);
            return (
              <div key={name} style={{ marginBottom: '0.7rem' }}>
                <div style={label}>{name === 'owner' ? 'OWNER' : `${TITLE[name].toUpperCase()}S`}</div>
                <div style={hint}>{ROLE_LINES[name]}</div>
                {holders.length === 0 ? (
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>Nobody yet.</div>
                ) : holders.map(m => (
                  <div key={m.userId} style={{ fontSize: '0.78rem', padding: '0.2rem 0' }}>{who(m)}</div>
                ))}
              </div>
            );
          })}
          {can('member.roles') ? (
            <div style={hint}>
              To appoint someone, open MEMBERS and use the ⋮ beside them.
              {myPriority >= 400 ? ' As owner you can appoint admins and moderators.' : ' You can appoint roles below your own.'}
            </div>
          ) : null}
        </CollapsibleSection>
      )}

      {isMember && (
        <CollapsibleSection {...section('leave', 'LEAVE OR CLOSE')}>
          {transfer && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.6rem', lineHeight: 1.4 }}>
              Handover offered to {members.find(m => m.userId === transfer.toUserId)?.displayName || 'a member'} —
              waiting for them to accept (lapses {new Date(transfer.expiresAt).toLocaleDateString()}).
              <button onClick={withdrawHandover} style={{ ...action, marginTop: 0, marginLeft: 6 }}>Withdraw</button>
            </div>
          )}
          {can('community.transfer') && !transfer && (
            <div style={{ ...hint, marginTop: 0, marginBottom: '0.6rem' }}>
              To hand {community.name} over, open MEMBERS and choose Hand over beside the new owner.
            </div>
          )}

          <div style={label}>LEAVE</div>
          {confirmLeave ? (
            <div>
              <div style={hint}>Leave {community.name}? You will need an invite to come back unless it is public.</div>
              <button onClick={leave} style={danger}>Yes, leave</button>
              <button onClick={() => setConfirmLeave(false)} style={{ ...action, marginLeft: 6 }}>Stay</button>
            </div>
          ) : (
            <button onClick={() => setConfirmLeave(true)} style={action}>Leave {community.name}</button>
          )}

          {can('community.delete') && (
            <div style={sub}>
              <div style={label}>CLOSE THE COMMUNITY</div>
              {confirmClose ? (
                <div>
                  <div style={hint}>
                    Close {community.name} for everyone? Its channels are removed. The {T.waves} in them are not
                    deleted: they go back to being ordinary {T.waves} for the people in them.
                  </div>
                  <button onClick={closeCommunity} style={danger}>Yes, close it</button>
                  <button onClick={() => setConfirmClose(false)} style={{ ...action, marginLeft: 6 }}>Keep it</button>
                </div>
              ) : (
                <button onClick={() => setConfirmClose(true)} style={danger}>Close {community.name}</button>
              )}
            </div>
          )}
        </CollapsibleSection>
      )}
    </div>
  );
};

export default CommunitySettingsPanel;
