import React, { useState, useEffect, useCallback } from 'react';
import { T } from '../../config/terminology.js';
import CommunitySettingsPanel from './CommunitySettingsPanel.jsx';

/**
 * Managing communities (v2.99.0, Phase 6 — rebuilt).
 *
 * This panel is for MANAGING: making a community, joining one, adding channels,
 * inviting people, seeing members. It is deliberately not where you read
 * anything.
 *
 * The first version of this screen was a top-level tab that also listed the
 * waves in each channel, and clicking one threw you into a different tab. That
 * made one activity — reading a conversation — span two destinations, and it
 * was worse than no Communities UI at all. Reading now happens where reading
 * has always happened: the {T.wave} list, where a channel appears as a group
 * beside your own categories. A community channel is the shared version of a
 * category, so that is where it belongs.
 *
 * Opened from the ⚙ on a channel group, or from the {T.wave} list options menu.
 */
const CommunityPanel = ({ fetchAPI, showToast, onClose, onChanged, initialCommunityId = null }) => {
  const [communities, setCommunities] = useState([]);
  const [selectedId, setSelectedId] = useState(initialCommunityId);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newVisibility, setNewVisibility] = useState('private');
  const [joinToken, setJoinToken] = useState('');
  const [creating, setCreating] = useState(false);
  const [browse, setBrowse] = useState(null);      // null = not looked yet
  const [search, setSearch] = useState('');

  const loadMine = useCallback(async () => {
    try {
      const data = await fetchAPI('/communities/mine');
      setCommunities(data.communities || []);
    } catch {
      showToast('Could not load communities', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => { loadMine(); }, [loadMine]);

  const openCommunity = useCallback(async (id) => {
    setSelectedId(id);
    try {
      setDetail(await fetchAPI(`/communities/${id}`));
    } catch {
      showToast('Could not open that community', 'error');
    }
  }, [fetchAPI, showToast]);

  useEffect(() => { if (initialCommunityId) openCommunity(initialCommunityId); }, [initialCommunityId, openCommunity]);

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await fetchAPI('/communities', { method: 'POST', body: { name, visibility: newVisibility } });
      setNewName(''); setCreating(false);
      showToast(`${res.community.name} created`, 'success');
      await loadMine();
      openCommunity(res.community.id);
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not create that community', 'error');
    }
  };

  const join = async () => {
    const token = joinToken.trim();
    if (!token) return;
    try {
      const res = await fetchAPI('/communities/join', { method: 'POST', body: { token } });
      setJoinToken('');
      showToast(`Joined ${res.community.name}`, 'success');
      await loadMine();
      openCommunity(res.community.id);
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'That invite is not valid', 'error');
    }
  };

  /**
   * Public communities on this node.
   *
   * The rebuild of this panel dropped browsing entirely, which left someone who
   * belonged to nothing — the exact person most in need of it — with only
   * "create one" and "paste a code". Unlisted communities are deliberately
   * absent from this list: not being listed is the whole of what unlisted means.
   */
  const loadBrowse = useCallback(async (q = '') => {
    try {
      const data = await fetchAPI(`/communities${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setBrowse(data.communities || []);
    } catch {
      showToast('Could not search communities', 'error');
      setBrowse([]);
    }
  }, [fetchAPI, showToast]);

  const joinOpen = async (community) => {
    try {
      await fetchAPI(`/communities/${community.id}/join`, { method: 'POST' });
      showToast(`Joined ${community.name}`, 'success');
      await loadMine();
      openCommunity(community.id);
      onChanged && onChanged();
    } catch (err) {
      showToast(err?.error || 'Could not join that community', 'error');
    }
  };

  const overlay = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem',
  };
  const sheet = {
    background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)',
    borderRadius: 4, padding: '1rem', width: 'min(680px, 100%)',
    maxHeight: '85vh', overflowY: 'auto',
  };
  const btn = (active) => ({
    padding: '0.45rem 0.6rem', marginRight: '0.35rem', marginBottom: '0.35rem',
    cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem',
    background: active ? 'var(--accent-amber)15' : 'transparent',
    border: `1px solid ${active ? 'var(--accent-amber)50' : 'var(--border-primary)'}`,
    color: active ? 'var(--accent-amber)' : 'var(--text-primary)',
  });
  const input = { width: '100%', padding: '0.45rem', fontFamily: 'inherit', marginBottom: '0.4rem' };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: 'var(--accent-amber)', fontSize: '0.8rem', letterSpacing: '0.1em' }}>
            COMMUNITIES
          </div>
          <button onClick={onClose} style={btn(false)}>Close</button>
        </div>

        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', margin: '0.4rem 0 0.8rem' }}>
          A community holds channels; a channel holds {T.waves}. Your channels appear
          in the {T.wave} list beside your own categories — this is only where you
          set them up.
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Loading…</div>
        ) : (
          <>
            <div style={{ marginBottom: '0.6rem' }}>
              {communities.map(c => (
                <button key={c.id} style={btn(c.id === selectedId)} onClick={() => openCommunity(c.id)}>
                  {c.name}
                </button>
              ))}
              {communities.length === 0 && (
                <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                  You are not in any communities yet.
                </span>
              )}
            </div>

            <div style={{
              borderTop: '1px solid var(--border-primary)', paddingTop: '0.6rem', marginBottom: '0.6rem',
            }}>
              {creating ? (
                <>
                  <input value={newName} onChange={e => setNewName(e.target.value)}
                         placeholder="Community name" maxLength={80} style={input} />
                  <select value={newVisibility} onChange={e => setNewVisibility(e.target.value)} style={input}>
                    <option value="private">Private — invite only</option>
                    <option value="unlisted">Unlisted — anyone with the link</option>
                    <option value="public">Public — anyone can find it</option>
                  </select>
                  <button onClick={create} style={btn(true)}>Create</button>
                  <button onClick={() => setCreating(false)} style={btn(false)}>Cancel</button>
                </>
              ) : (
                <button onClick={() => setCreating(true)} style={btn(false)}>+ New community</button>
              )}

              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                <input value={joinToken} onChange={e => setJoinToken(e.target.value)}
                       placeholder="Paste an invite code" style={{ ...input, marginBottom: 0, flex: 1 }} />
                <button onClick={join} style={btn(false)}>Join</button>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '0.6rem', marginBottom: '0.6rem' }}>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') loadBrowse(search); }}
                  placeholder="Search public communities"
                  style={{ ...input, marginBottom: 0, flex: 1 }}
                />
                <button onClick={() => loadBrowse(search)} style={btn(false)}>Browse</button>
              </div>

              {browse !== null && browse.length === 0 && (
                <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: '0.4rem' }}>
                  No public communities found on this server.
                </div>
              )}
              {browse !== null && browse.map(c => {
                const already = communities.some(m => m.id === c.id);
                return (
                  <div key={c.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: '0.5rem', padding: '0.35rem 0', borderBottom: '1px solid var(--border-subtle)',
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '0.82rem' }}>{c.name}</div>
                      {c.description && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{c.description}</div>
                      )}
                    </div>
                    {already ? (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', flexShrink: 0 }}>joined</span>
                    ) : (
                      <button onClick={() => joinOpen(c)} style={{ ...btn(false), marginBottom: 0, flexShrink: 0 }}>
                        Join
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {detail && (
              <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '0.6rem' }}>
                <div style={{ color: 'var(--accent-amber)', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
                  {detail.community.name}
                </div>
                <CommunitySettingsPanel
                  community={detail.community}
                  capabilities={detail.capabilities}
                  fetchAPI={fetchAPI}
                  showToast={showToast}
                  onChanged={() => { openCommunity(detail.community.id); onChanged && onChanged(); }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default CommunityPanel;
