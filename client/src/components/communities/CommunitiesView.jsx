import React, { useState, useEffect, useCallback } from 'react';
import { useWindowSize } from '../../hooks/useWindowSize.js';
import { LoadingSpinner, GlowText } from '../ui/SimpleComponents.jsx';
import { T } from '../../config/terminology.js';
import CommunitySettingsPanel from './CommunitySettingsPanel.jsx';

/**
 * Communities (v2.99.0, Phase 6 — the first Communities UI).
 *
 * Community -> Channel -> Wave -> Ping. A channel is a CONTAINER that holds
 * waves; it is not itself a conversation. That distinction drives this screen:
 * picking a channel lists the waves filed in it, and opening one hands off to
 * the ordinary wave view, because a wave inside a channel is an ordinary wave
 * with all its usual rules about who may read it.
 *
 * WHAT THIS SCREEN MUST NOT IMPLY
 * That belonging to a Community grants access to the waves in it. It does not,
 * and the server will refuse — so the list shows only what the caller may
 * already see, and the channel's wave count is a count of what they can see
 * rather than of what is there. Showing a fuller count would be a slow leak of
 * a private wave's existence.
 */
const CommunitiesView = ({ fetchAPI, showToast, onOpenWave, currentUser }) => {
  const { isMobile } = useWindowSize();
  const [communities, setCommunities] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [channelWaves, setChannelWaves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newVisibility, setNewVisibility] = useState('private');
  const [discover, setDiscover] = useState(null);
  const [joinToken, setJoinToken] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [newWaveTitle, setNewWaveTitle] = useState('');
  const [filePicker, setFilePicker] = useState(null);   // waves this person could file here

  const loadMine = useCallback(async () => {
    try {
      const data = await fetchAPI('/communities/mine');
      setCommunities(data.communities || []);
    } catch (err) {
      // A disabled feature is not an error worth shouting about — the nav item
      // should not have been there, and saying so twice helps nobody.
      if (err?.code !== 'FEATURE_DISABLED') showToast('Could not load communities', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => { loadMine(); }, [loadMine]);

  const openCommunity = useCallback(async (id) => {
    setSelectedId(id);
    setSelectedChannel(null);
    setChannelWaves([]);
    try {
      const [d, ch] = await Promise.all([
        fetchAPI(`/communities/${id}`),
        fetchAPI(`/communities/${id}/channels`).catch(() => ({ channels: [] })),
      ]);
      setDetail(d);
      setChannels(ch.channels || []);
    } catch {
      showToast('Could not open that community', 'error');
    }
  }, [fetchAPI, showToast]);

  const openChannel = useCallback(async (channel) => {
    setSelectedChannel(channel);
    try {
      // The waves the CALLER may see, which is not necessarily every wave filed
      // here. The server decides; this screen does not second-guess it.
      const data = await fetchAPI('/waves');
      const list = Array.isArray(data) ? data : (data.waves || []);
      setChannelWaves(list.filter(w => (w.channelId || w.channel_id) === channel.id));
    } catch {
      showToast(`Could not load ${T.waves}`, 'error');
    }
  }, [fetchAPI, showToast]);

  const createCommunity = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await fetchAPI('/communities', {
        method: 'POST',
        body: { name, visibility: newVisibility },
      });
      showToast(`${res.community.name} created`, 'success');
      setNewName('');
      setCreating(false);
      await loadMine();
      openCommunity(res.community.id);
    } catch (err) {
      showToast(err?.error || 'Could not create that community', 'error');
    }
  };

  const joinByToken = async () => {
    const token = joinToken.trim();
    if (!token) return;
    try {
      const res = await fetchAPI('/communities/join', { method: 'POST', body: { token } });
      showToast(`Joined ${res.community.name}`, 'success');
      setJoinToken('');
      await loadMine();
      openCommunity(res.community.id);
    } catch (err) {
      showToast(err?.error || 'That invite is not valid', 'error');
    }
  };

  const loadDiscover = async () => {
    try {
      const data = await fetchAPI('/communities');
      setDiscover(data.communities || []);
    } catch {
      showToast('Could not search communities', 'error');
    }
  };

  /**
   * Start a wave inside the selected channel.
   *
   * One request: the server creates it and files it together, so a failure
   * cannot leave an orphan wave the person never asked for and cannot find.
   */
  const createWaveHere = async () => {
    const title = newWaveTitle.trim();
    if (!title || !selectedChannel) return;
    try {
      const wave = await fetchAPI('/waves', {
        method: 'POST',
        body: { title, privacy: 'private', channelId: selectedChannel.id },
      });
      setNewWaveTitle('');
      showToast(`${title} created`, 'success');
      await openChannel(selectedChannel);
      onOpenWave && onOpenWave(wave.wave || wave);
    } catch (err) {
      showToast(err?.error || `Could not start a ${T.wave} here`, 'error');
    }
  };

  /**
   * Offer the waves this person could file here: ones they created that are not
   * already in a channel. Filtered client-side for convenience only — the
   * server checks authority over the wave itself and will refuse the rest.
   */
  const openFilePicker = async () => {
    try {
      const data = await fetchAPI('/waves');
      const list = Array.isArray(data) ? data : (data.waves || []);
      setFilePicker(list.filter(w =>
        !(w.channelId || w.channel_id) && w.createdBy === currentUser?.id));
    } catch {
      showToast(`Could not list your ${T.waves}`, 'error');
    }
  };

  const fileWave = async (wave) => {
    try {
      await fetchAPI(
        `/communities/${detail.community.id}/channels/${selectedChannel.id}/waves/${wave.id}`,
        { method: 'PUT' });
      setFilePicker(null);
      showToast(`${wave.title} filed in #${selectedChannel.name}`, 'success');
      openChannel(selectedChannel);
    } catch (err) {
      showToast(err?.error || `Could not file that ${T.wave}`, 'error');
    }
  };

  const unfileWave = async (wave) => {
    try {
      await fetchAPI(
        `/communities/${detail.community.id}/channels/${selectedChannel.id}/waves/${wave.id}`,
        { method: 'DELETE' });
      showToast(`${wave.title} removed from #${selectedChannel.name}`, 'success');
      openChannel(selectedChannel);
    } catch (err) {
      showToast(err?.error || `Could not remove that ${T.wave}`, 'error');
    }
  };

  const can = (capability) => (detail?.capabilities || []).includes(capability);

  const panel = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    borderRadius: 4,
    padding: '0.75rem',
  };
  const btn = (active) => ({
    width: '100%',
    textAlign: 'left',
    padding: '0.5rem 0.65rem',
    marginBottom: '0.35rem',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    background: active ? 'var(--accent-amber)15' : 'transparent',
    border: `1px solid ${active ? 'var(--accent-amber)50' : 'var(--border-primary)'}`,
    color: active ? 'var(--accent-amber)' : 'var(--text-primary)',
    borderRadius: 3,
  });

  if (loading) return <LoadingSpinner />;

  return (
    <div style={{
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap: '1rem',
      alignItems: 'flex-start',
    }}>
      {/* The rail. On mobile it becomes a strip above the detail rather than a
          column beside it, because four levels of nesting in a narrow column is
          not navigable. */}
      <div style={{ ...panel, width: isMobile ? '100%' : 260, flexShrink: 0 }}>
        <GlowText style={{ fontSize: '0.75rem', letterSpacing: '0.1em' }}>COMMUNITIES</GlowText>

        <div style={{ marginTop: '0.6rem' }}>
          {communities.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', padding: '0.4rem 0' }}>
              You are not in any communities yet.
            </div>
          )}
          {communities.map(c => (
            <button key={c.id} style={btn(c.id === selectedId)} onClick={() => openCommunity(c.id)}>
              {c.name}
              <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginLeft: 6 }}>
                {c.visibility === 'public' ? '' : c.visibility === 'unlisted' ? '· unlisted' : '· private'}
              </span>
            </button>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--border-primary)', marginTop: '0.6rem', paddingTop: '0.6rem' }}>
          {creating ? (
            <>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Community name"
                maxLength={80}
                style={{ width: '100%', marginBottom: '0.4rem', padding: '0.4rem', fontFamily: 'inherit' }}
              />
              <select
                value={newVisibility}
                onChange={e => setNewVisibility(e.target.value)}
                style={{ width: '100%', marginBottom: '0.4rem', padding: '0.4rem', fontFamily: 'inherit' }}
              >
                <option value="private">Private — invite only</option>
                <option value="unlisted">Unlisted — anyone with the link</option>
                <option value="public">Public — anyone can find it</option>
              </select>
              <button onClick={createCommunity} style={btn(true)}>Create</button>
              <button onClick={() => setCreating(false)} style={btn(false)}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setCreating(true)} style={btn(false)}>+ New community</button>
          )}

          <div style={{ marginTop: '0.5rem' }}>
            <input
              value={joinToken}
              onChange={e => setJoinToken(e.target.value)}
              placeholder="Paste an invite code"
              style={{ width: '100%', marginBottom: '0.4rem', padding: '0.4rem', fontFamily: 'inherit' }}
            />
            <button onClick={joinByToken} style={btn(false)}>Join with code</button>
          </div>

          <button onClick={loadDiscover} style={{ ...btn(false), marginTop: '0.5rem' }}>Browse public</button>
          {discover && discover.map(c => (
            <div key={c.id} style={{ fontSize: '0.78rem', color: 'var(--text-dim)', padding: '0.3rem 0' }}>
              {c.name}
              <div style={{ fontSize: '0.7rem' }}>/{c.slug}</div>
            </div>
          ))}
          {discover && discover.length === 0 && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', padding: '0.3rem 0' }}>
              No public communities on this server.
            </div>
          )}
        </div>
      </div>

      {/* Detail */}
      <div style={{ ...panel, flex: 1, minWidth: 0, width: isMobile ? '100%' : 'auto' }}>
        {!detail && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
            Pick a community, or make one. A community holds channels, and a channel holds {T.waves}.
          </div>
        )}

        {detail && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
              <GlowText style={{ fontSize: '1rem' }}>{detail.community.name}</GlowText>
              {can('community.manage') && (
                <button onClick={() => setShowSettings(s => !s)} style={{ ...btn(showSettings), width: 'auto' }}>
                  {showSettings ? 'Close settings' : 'Settings'}
                </button>
              )}
            </div>
            {detail.community.description && (
              <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', margin: '0.35rem 0' }}>
                {detail.community.description}
              </div>
            )}

            {showSettings && (
              <CommunitySettingsPanel
                community={detail.community}
                capabilities={detail.capabilities}
                fetchAPI={fetchAPI}
                showToast={showToast}
                onChanged={() => openCommunity(detail.community.id)}
              />
            )}

            <div style={{ marginTop: '0.8rem' }}>
              <GlowText style={{ fontSize: '0.72rem', letterSpacing: '0.1em' }}>CHANNELS</GlowText>
              {channels.length === 0 && (
                <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', padding: '0.4rem 0' }}>
                  No channels yet.
                </div>
              )}
              {channels.map(ch => (
                <button key={ch.id} style={btn(selectedChannel?.id === ch.id)} onClick={() => openChannel(ch)}>
                  # {ch.name}
                </button>
              ))}
            </div>

            {selectedChannel && (
              <div style={{ marginTop: '0.8rem', borderTop: '1px solid var(--border-primary)', paddingTop: '0.6rem' }}>
                <GlowText style={{ fontSize: '0.72rem', letterSpacing: '0.1em' }}>
                  {T.WAVES} IN #{selectedChannel.name.toUpperCase()}
                </GlowText>
                {channelWaves.length === 0 && (
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', padding: '0.4rem 0' }}>
                    Nothing filed here that you can see.
                  </div>
                )}
                {channelWaves.map(w => (
                  <div key={w.id} style={{ display: 'flex', gap: '0.35rem', alignItems: 'stretch' }}>
                    <button style={{ ...btn(false), flex: 1 }} onClick={() => onOpenWave && onOpenWave(w)}>
                      {w.title}
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginLeft: 6 }}>
                        {w.privacy === 'private' ? '· private' : ''}
                      </span>
                    </button>
                    {can('channel.move_wave') && (
                      <button
                        title={`Remove from #${selectedChannel.name}`}
                        onClick={() => unfileWave(w)}
                        style={{ ...btn(false), width: 'auto', padding: '0.5rem 0.6rem' }}
                      >×</button>
                    )}
                  </div>
                ))}

                {can('channel.create_wave') && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <input
                      value={newWaveTitle}
                      onChange={e => setNewWaveTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') createWaveHere(); }}
                      placeholder={`Start a ${T.wave} in #${selectedChannel.name}`}
                      maxLength={200}
                      style={{ width: '100%', padding: '0.4rem', fontFamily: 'inherit' }}
                    />
                    <button onClick={createWaveHere} style={btn(false)}>
                      + New {T.wave} here
                    </button>
                  </div>
                )}

                {can('channel.move_wave') && (
                  <div style={{ marginTop: '0.3rem' }}>
                    {filePicker === null ? (
                      <button onClick={openFilePicker} style={btn(false)}>
                        File an existing {T.wave} here
                      </button>
                    ) : (
                      <>
                        {filePicker.length === 0 && (
                          <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', padding: '0.3rem 0' }}>
                            You have no unfiled {T.waves} to move.
                          </div>
                        )}
                        {filePicker.map(w => (
                          <button key={w.id} style={btn(false)} onClick={() => fileWave(w)}>
                            {w.title}
                          </button>
                        ))}
                        <button onClick={() => setFilePicker(null)} style={btn(false)}>Cancel</button>
                      </>
                    )}
                  </div>
                )}

                <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '0.4rem' }}>
                  Filing a {T.wave} here does not change who can read it.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default CommunitiesView;
