import React, { useState, useEffect, useCallback } from 'react';
import { T } from '../../config/terminology.js';

/**
 * Community settings: channels, members and invites (v2.99.0, Phase 6).
 *
 * Every control here is rendered from the capability list the server returned,
 * not from a role name. Hiding a control the caller cannot use is a courtesy —
 * the server refuses regardless — but rendering from capabilities rather than
 * from "are they an admin" keeps the UI honest when a Community has custom
 * roles that do not map onto the four built-in ones.
 */
const CommunitySettingsPanel = ({ community, capabilities, fetchAPI, showToast, onChanged }) => {
  const can = (c) => (capabilities || []).includes(c);

  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [mintedToken, setMintedToken] = useState(null);
  const [channelName, setChannelName] = useState('');
  const [remoteAddress, setRemoteAddress] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [channels, setChannels] = useState([]);
  const [renaming, setRenaming] = useState(null);      // channel id being renamed
  const [renameTo, setRenameTo] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    if (can('channel.view')) {
      try {
        const res = await fetchAPI(`/communities/${community.id}/channels`);
        setChannels(res.channels || []);
      } catch { /* the rest of the panel is still useful */ }
    }
    if (can('member.view')) {
      try {
        const m = await fetchAPI(`/communities/${community.id}/members`);
        setMembers(m.members || []);
      } catch { /* the panel is still useful without it */ }
    }
    if (can('member.invite')) {
      try {
        const i = await fetchAPI(`/communities/${community.id}/invites`);
        setInvites(i.invites || []);
      } catch { /* ditto */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.id, fetchAPI, capabilities]);

  useEffect(() => { load(); }, [load]);

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

  const addMember = async (user) => {
    try {
      await fetchAPI(`/communities/${community.id}/members`, {
        method: 'POST', body: { userId: user.id },
      });
      showToast(`${user.displayName || user.handle} added`, 'success');
      setMemberSearch('');
      setSearchResults([]);
      load();
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not add that person', 'error');
    }
  };

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

  const createChannel = async () => {
    const name = channelName.trim();
    if (!name) return;
    try {
      await fetchAPI(`/communities/${community.id}/channels`, { method: 'POST', body: { name } });
      setChannelName('');
      showToast('Channel created', 'success');
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not create that channel', 'error');
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

  const box = {
    border: '1px solid var(--border-primary)',
    borderRadius: 3,
    padding: '0.6rem',
    marginTop: '0.6rem',
    background: 'var(--bg-primary)',
  };
  const label = { fontSize: '0.7rem', letterSpacing: '0.08em', color: 'var(--accent-amber)' };
  const input = { width: '100%', padding: '0.4rem', fontFamily: 'inherit', marginTop: '0.3rem' };
  const action = {
    marginTop: '0.35rem', padding: '0.4rem 0.6rem', cursor: 'pointer', fontFamily: 'inherit',
    background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
  };

  return (
    <div style={{ marginTop: '0.6rem' }}>
      {can('channel.view') && channels.length > 0 && (
        <div style={box}>
          <div style={label}>CHANNELS ({channels.length})</div>
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
                    Delete #{ch.name}? The {T.waves} in it are not deleted — they go back to
                    being ordinary {T.waves}.
                  </div>
                  <button onClick={() => deleteChannel(ch)} style={{ ...action, marginTop: 0, color: 'var(--accent-orange)' }}>
                    Yes, delete the channel
                  </button>
                  <button onClick={() => setConfirmDelete(null)} style={{ ...action, marginTop: 0 }}>Keep it</button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '0.82rem', minWidth: 0 }}># {ch.name}</span>
                  {can('channel.manage') && (
                    <span style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
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
        </div>
      )}

      {can('channel.manage') && (
        <div style={box}>
          <div style={label}>NEW CHANNEL</div>
          <input
            value={channelName}
            onChange={e => setChannelName(e.target.value)}
            placeholder="Productions"
            maxLength={60}
            style={input}
          />
          <button onClick={createChannel} style={action}>Create channel</button>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
            A channel holds {T.waves}. It is not a conversation itself.
          </div>
        </div>
      )}

      {can('member.invite') && (
        <div style={box}>
          <div style={label}>INVITES</div>
          <button onClick={mintInvite} style={action}>Create an invite code</button>
          {mintedToken && (
            <div style={{ marginTop: '0.4rem' }}>
              <code style={{
                display: 'block', wordBreak: 'break-all', fontSize: '0.75rem',
                background: 'var(--bg-secondary)', padding: '0.4rem', border: '1px solid var(--border-primary)',
              }}>{mintedToken}</code>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>
                Copy this now — it is shown once and cannot be retrieved later.
              </div>
            </div>
          )}

          {invites.length > 0 && (
            <div style={{ marginTop: '0.5rem' }}>
              {invites.map(inv => (
                <div key={inv.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: '0.75rem', color: 'var(--text-dim)', padding: '0.2rem 0',
                }}>
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

          <div style={{ marginTop: '0.6rem' }}>
            <div style={label}>INVITE SOMEONE FROM ANOTHER SERVER</div>
            <input
              value={remoteAddress}
              onChange={e => setRemoteAddress(e.target.value)}
              placeholder="alice@their-server"
              style={input}
            />
            <button onClick={inviteRemote} style={action}>Send invitation</button>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
              They do not need an account here. The invitation waits until they
              first sign in from their own server.
            </div>
          </div>
        </div>
      )}

      {can('member.invite') && (
        <div style={box}>
          <div style={label}>ADD SOMEONE FROM THIS SERVER</div>
          <input
            value={memberSearch}
            onChange={e => setMemberSearch(e.target.value)}
            placeholder="Search by name or handle"
            style={input}
          />
          {memberSearch.trim().length === 1 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>Keep typing…</div>
          )}
          {searchResults.map(u => (
            <div key={u.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              gap: '0.5rem', padding: '0.25rem 0',
            }}>
              <span style={{ fontSize: '0.8rem', minWidth: 0 }}>
                {u.displayName || u.handle}
                <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginLeft: 6 }}>@{u.handle}</span>
              </span>
              <button onClick={() => addMember(u)} style={{ ...action, marginTop: 0, flexShrink: 0 }}>Add</button>
            </div>
          ))}
          {memberSearch.trim().length >= 2 && searchResults.length === 0 && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
              Nobody found who is not already a member.
            </div>
          )}
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
            They join straight away — this adds them rather than asking them.
          </div>
        </div>
      )}

      {can('member.view') && (
        <div style={box}>
          <div style={label}>MEMBERS ({members.length})</div>
          {members.map(m => (
            <div key={m.userId} style={{ fontSize: '0.78rem', padding: '0.2rem 0' }}>
              {m.displayName || m.handle}
              {m.isCrossPort && (
                <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginLeft: 6 }}>
                  · from {m.homeNode}
                </span>
              )}
              <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginLeft: 6 }}>
                {m.roles.map(r => r.name).join(', ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CommunitySettingsPanel;
