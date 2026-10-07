import React, { useEffect, useState, useCallback } from 'react';
import { API_URL } from '../../config/constants.js';
import { storage } from '../../utils/storage.js';
import { plainText } from '../../utils/plainText.js';

/**
 * Watching a broadcast's recording (v2.110.0).
 *
 * The file streams through Cortex from a private bucket; the server hands out
 * a short-lived URL after checking wave membership, and checks it again on
 * every range request. The browser's own <video> controls do the rest — seek,
 * full screen and picture-in-picture all come for free.
 */
const RecordingPlayer = ({ broadcastId }) => {
  const [info, setInfo] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | unavailable | error
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');

  const api = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${API_URL}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storage.getToken()}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status });
    return data;
  }, []);

  const load = useCallback(() => {
    api(`/broadcasts/${encodeURIComponent(broadcastId)}/recording`)
      .then(d => { setInfo(d); setState('ok'); })
      .catch(err => setState(err.status === 404 ? 'unavailable' : 'error'));
  }, [api, broadcastId]);

  useEffect(() => { load(); }, [load]);

  // Still being finalised: look again shortly.
  useEffect(() => {
    if (info?.status !== 'processing' && info?.status !== 'recording') return;
    const t = setTimeout(load, 15000);
    return () => clearTimeout(t);
  }, [info, load]);

  const remove = async () => {
    try {
      await api(`/broadcasts/${encodeURIComponent(broadcastId)}/recording`, { method: 'DELETE' });
      load();
      setConfirmDelete(false);
    } catch (err) { setError(err.message); }
  };

  // The stream URL is relative to the API, which may live on another origin.
  const src = info?.streamUrl ? `${API_URL.replace(/\/api\/?$/, '')}${info.streamUrl}` : null;
  const minutes = info?.durationMs ? Math.max(1, Math.round(info.durationMs / 60000)) : null;

  const message = state === 'unavailable' ? 'This recording is not available.'
    : state === 'error' ? 'The recording could not be loaded.'
    : !info ? 'Loading…'
    : {
      none: 'This broadcast was not recorded.',
      recording: 'This broadcast is still live and being recorded. The recording appears here once it ends.',
      processing: 'The recording is being finished — this usually takes a minute or two.',
      failed: 'Recording this broadcast failed, so there is nothing to watch.',
      deleted: 'This recording has been deleted.',
    }[info.status] || null;

  const btn = (danger = false) => ({
    padding: '9px 14px', minHeight: 40, fontFamily: 'monospace', fontSize: '0.8rem', cursor: 'pointer', borderRadius: 4,
    background: danger ? '#e0242b' : 'transparent', color: danger ? '#fff' : '#ddd',
    border: `1px solid ${danger ? '#e0242b' : 'rgba(255,255,255,0.35)'}`,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', color: '#fff', fontFamily: 'monospace', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 'calc(10px + env(safe-area-inset-top)) 14px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ background: '#444', padding: '2px 8px', borderRadius: 3, fontSize: '0.72rem', letterSpacing: '0.1em' }}>▶ RECORDING</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plainText(info?.broadcast?.title || '')}</span>
        {minutes && <span style={{ color: '#aaa', fontSize: '0.8rem' }}>{minutes} min</span>}
        <button onClick={() => { window.location.href = '/'; }} style={btn()}>✕ CLOSE</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {src ? (
          <video src={src} controls playsInline preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} />
        ) : (
          <div style={{ color: '#ccc', padding: 24, textAlign: 'center', maxWidth: 480, lineHeight: 1.5 }}>{message}</div>
        )}
      </div>

      {info?.canDelete && (info.status === 'ready' || info.status === 'failed') && (
        <div style={{ padding: '10px 14px calc(12px + env(safe-area-inset-bottom))', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: '0.8rem' }}>
          {error && <span role="alert" style={{ color: '#ff6b35' }}>{error}</span>}
          {confirmDelete ? (
            <>
              <span>Delete this recording for everyone? This cannot be undone.</span>
              <button onClick={remove} style={btn(true)}>YES, DELETE</button>
              <button onClick={() => setConfirmDelete(false)} style={btn()}>KEEP IT</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={btn()}>🗑 DELETE RECORDING</button>
          )}
        </div>
      )}
    </div>
  );
};

export default RecordingPlayer;
