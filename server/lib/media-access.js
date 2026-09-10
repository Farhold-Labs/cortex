// An embed identifier is a locator, never permission to use another user's server.
export function validMediaTarget(provider, connectionId, itemId) {
  return ['jellyfin', 'plex'].includes(provider)
    && typeof connectionId === 'string' && /^[A-Za-z0-9-]{1,100}$/.test(connectionId)
    && typeof itemId === 'string' && /^[A-Za-z0-9]{1,100}$/.test(itemId);
}

export function canAccessMedia({ db, canAccessWave, userId, provider, connection, itemId, shareId, partyId }) {
  if (!connection || !userId || !validMediaTarget(provider, connection.id, itemId)) return false;
  if (connection.userId === userId) return true;
  if (typeof shareId === 'string' && shareId.length <= 100) {
    const share = db.getMediaShare?.(shareId);
    if (share && share.provider === provider && share.connectionId === connection.id
      && share.itemId === itemId && share.ownerId === connection.userId
      && canAccessWave(share.waveId, userId) && canAccessWave(share.waveId, share.ownerId)) return true;
  }
  if (provider === 'jellyfin' && typeof partyId === 'string' && partyId.length <= 100) {
    const party = db.getWatchParty?.(partyId);
    return !!(party && party.status === 'active' && party.jellyfinConnectionId === connection.id
      && party.jellyfinItemId === itemId && party.hostUserId === connection.userId
      && canAccessWave(party.waveId, userId) && canAccessWave(party.waveId, party.hostUserId));
  }
  return false;
}
