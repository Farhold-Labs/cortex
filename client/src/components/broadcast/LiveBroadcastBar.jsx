import React, { useEffect, useState, useCallback } from 'react';
import { plainText } from '../../utils/plainText.js';

/**
 * "🔴 LIVE" strip at the top of a wave while it is broadcasting (v2.109.0).
 * Stays current from the WebSocket (MainApp re-dispatches broadcast events as
 * a window event) and re-checks when the wave changes.
 */
const LiveBroadcastBar = ({ waveId, fetchAPI, currentUserId }) => {
  const [live, setLive] = useState(null);

  const load = useCallback(() => {
    if (!waveId) return;
    fetchAPI(`/waves/${waveId}/broadcast`).then(d => setLive(d.broadcast || null)).catch(() => setLive(null));
  }, [waveId, fetchAPI]);

  useEffect(() => { setLive(null); load(); }, [load]);

  useEffect(() => {
    const onEvent = (e) => {
      const d = e.detail || {};
      if (d.type === 'broadcast_started' && d.broadcast?.waveId === waveId) setLive(d.broadcast);
      if (d.type === 'broadcast_ended' && d.waveId === waveId) setLive(null);
    };
    window.addEventListener('cortex:broadcast', onEvent);
    return () => window.removeEventListener('cortex:broadcast', onEvent);
  }, [waveId]);

  if (!live || live.state !== 'live') return null;
  const mine = live.createdBy === currentUserId;

  return (
    <a href={mine ? `/broadcast/${live.id}` : `/watch/${live.id}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', textDecoration: 'none',
        background: 'rgba(224, 36, 43, 0.14)', borderBottom: '1px solid rgba(224, 36, 43, 0.5)',
        color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '0.82rem',
      }}>
      <span style={{ background: '#e0242b', color: '#fff', padding: '1px 7px', borderRadius: 3, fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: '0.1em' }}>● LIVE</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plainText(live.title)}</span>
      <span style={{ color: '#ff6b6b', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{mine ? 'BACK TO STUDIO →' : 'WATCH →'}</span>
    </a>
  );
};

export default LiveBroadcastBar;
