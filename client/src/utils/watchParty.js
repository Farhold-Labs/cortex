// Watch parties (v2.14.0; wired up end to end in v2.155.3).
//
// The server describes a party as { id, waveId, hostUserId, hostName,
// jellyfinConnectionId, jellyfinItemId, mediaTitle, playbackPosition,
// isPlaying }. The UI works with one shape, made here, so the REST answers and
// every WebSocket message agree.

export function normaliseParty(raw, fallbackWaveId = null) {
  if (!raw || !raw.id) return null;
  const isPlaying = raw.isPlaying ?? (raw.state === 'playing');
  return {
    id: raw.id,
    waveId: raw.waveId || fallbackWaveId,
    hostId: raw.hostUserId ?? raw.hostId ?? null,
    hostName: raw.hostName || raw.hostHandle || null,
    connectionId: raw.jellyfinConnectionId ?? raw.connectionId ?? null,
    itemId: raw.jellyfinItemId ?? raw.itemId ?? null,
    name: raw.mediaTitle ?? raw.name ?? 'Untitled',
    state: isPlaying ? 'playing' : 'paused',
    position: Number(raw.playbackPosition ?? raw.position ?? 0) || 0,
    // When the host last said where it was, so a viewer can add the time since.
    syncedAt: Date.now(),
  };
}

// The party with a host's play, pause, seek or heartbeat applied.
export function applyPlayback(party, { command, position, isPlaying }) {
  if (!party) return party;
  const next = { ...party, syncedAt: Date.now() };
  if (typeof position === 'number' && Number.isFinite(position)) next.position = position;
  if (command === 'play') next.state = 'playing';
  else if (command === 'pause') next.state = 'paused';
  else if (typeof isPlaying === 'boolean') next.state = isPlaying ? 'playing' : 'paused';
  return next;
}

// Where the host is now: its last position, plus the time since if playing.
export function expectedPosition(party) {
  if (!party) return 0;
  return party.position + (party.state === 'playing' ? (Date.now() - party.syncedAt) / 1000 : 0);
}

// Jellyfin connections this person owns, asked once a session: only the
// owner of a connection can host a party with it.
let ownConnections = null;
export function ownJellyfinConnectionIds(fetchJSON) {
  if (!ownConnections) {
    ownConnections = fetchJSON('/jellyfin/connections')
      .then(data => new Set((data.connections || data || []).map(c => c.id)))
      .catch(() => { ownConnections = null; return new Set(); });
  }
  return ownConnections;
}
