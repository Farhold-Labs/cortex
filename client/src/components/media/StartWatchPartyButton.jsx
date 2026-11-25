import React, { useState, useEffect } from 'react';
import { ownConnectionIds, normaliseParty } from '../../utils/watchParty.js';

/**
 * START WATCH PARTY on a Jellyfin or Plex card (v2.155.3; Plex v2.156.0).
 *
 * Shown only to the owner of the media connection, the only person the
 * server lets host with it, and only where the card knows its wave. Starting
 * tells MainApp, which shows the party and opens the player.
 */
const StartWatchPartyButton = ({ provider, connectionId, itemId, name, type, waveId, fetchAPI, color = 'var(--accent-purple)' }) => {
  const [canHost, setCanHost] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!waveId || !fetchAPI || !connectionId) return undefined;
    let live = true;
    ownConnectionIds(fetchAPI, provider).then(ids => { if (live) setCanHost(ids.has(connectionId)); });
    return () => { live = false; };
  }, [waveId, fetchAPI, connectionId, provider]);

  if (!canHost) return null;

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const data = await fetchAPI('/watch-parties', {
        method: 'POST',
        body: { waveId, provider, connectionId, itemId, mediaTitle: name, mediaType: type },
      });
      const party = normaliseParty(data.party, waveId);
      if (party) window.dispatchEvent(new CustomEvent('cortex:watch-party-hosted', { detail: { party } }));
    } catch (err) {
      setError(err.message || 'Could not start the watch party');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div style={{ marginTop: '12px' }}>
      <button
        onClick={start}
        disabled={starting}
        style={{
          width: '100%',
          padding: '10px',
          minHeight: '44px',
          background: 'transparent',
          border: `1px solid ${color}`,
          color,
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: '0.75rem',
          fontWeight: 'bold',
        }}
      >
        {starting ? 'STARTING…' : 'START WATCH PARTY'}
      </button>
      {error && <div style={{ marginTop: '6px', color: 'var(--accent-orange)', fontSize: '0.75rem' }}>{error}</div>}
    </div>
  );
};

export default StartWatchPartyButton;
