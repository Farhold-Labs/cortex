import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribeUploads, getUploadsSnapshot, cancelUpload } from '../../utils/uploads.js';

/**
 * The uploading screen (v2.111.0).
 *
 * Shown while any file is uploading: what is going up, how far along, how
 * long is left, and — the reason this exists — that refreshing or closing the
 * page will cancel it. "Keep browsing" shrinks it to a pill so a long upload
 * does not hold the whole app hostage; the pill reopens it.
 *
 * Waits a moment before appearing, so a quick upload on a good connection
 * does not flash a screen at all.
 */
const SHOW_AFTER_MS = 600;

function fmtBytes(n) {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function fmtDuration(s) {
  if (!isFinite(s) || s <= 0) return null;
  if (s < 60) return `${Math.ceil(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s % 60)} s`;
}

const UploadProgress = () => {
  const uploads = useSyncExternalStore(subscribeUploads, getUploadsSnapshot);
  const [now, setNow] = useState(Date.now());
  const [minimized, setMinimized] = useState(false);

  // Tick while anything is uploading: drives the show delay and the estimate.
  useEffect(() => {
    if (!uploads.length) { setMinimized(false); return; }
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [uploads.length]);

  const visible = uploads.filter(u => now - u.startedAt >= SHOW_AFTER_MS);
  if (!visible.length) return null;

  const loaded = visible.reduce((a, u) => a + (u.loaded || 0), 0);
  const total = visible.reduce((a, u) => a + (u.total || 0), 0);
  const pct = total ? Math.min(100, Math.floor((loaded / total) * 100)) : 0;
  const processing = visible.every(u => u.phase === 'processing');
  const oldest = Math.min(...visible.map(u => u.startedAt));
  const elapsed = (now - oldest) / 1000;
  const rate = elapsed > 2 && loaded ? loaded / elapsed : 0;
  const remaining = rate ? fmtDuration((total - loaded) / rate) : null;
  const title = visible.length === 1 ? visible[0].label : `${visible.length} files`;

  if (minimized) {
    return (
      <button onClick={() => setMinimized(false)} aria-label="Show upload progress"
        style={{
          position: 'fixed', top: 'calc(8px + env(safe-area-inset-top))', left: '50%', transform: 'translateX(-50%)', zIndex: 4000,
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 16, cursor: 'pointer',
          background: 'var(--bg-elevated)', border: '1px solid var(--accent-amber)', color: 'var(--accent-amber)',
          fontFamily: 'monospace', fontSize: '0.75rem', boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
        }}>
        <span style={{ width: 60, height: 4, background: 'var(--border-primary)', borderRadius: 2, overflow: 'hidden' }}>
          <span style={{ display: 'block', height: '100%', width: `${processing ? 100 : pct}%`, background: 'var(--accent-amber)' }} />
        </span>
        {processing ? 'PROCESSING…' : `UPLOADING ${pct}%`}
      </button>
    );
  }

  const btn = {
    padding: '9px 14px', minHeight: 40, fontFamily: 'monospace', fontSize: '0.78rem', cursor: 'pointer',
    background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)', letterSpacing: '0.04em',
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Uploading"
      style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ width: 'min(420px, 100%)', background: 'var(--bg-elevated)', border: '2px solid var(--accent-amber)', padding: '20px 22px', fontFamily: 'monospace', boxSizing: 'border-box' }}>
        <div style={{ color: 'var(--accent-amber)', fontSize: '0.75rem', letterSpacing: '0.16em', marginBottom: 10 }}>
          {processing ? '⧗ PROCESSING' : '⇪ UPLOADING'}
        </div>
        <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 12 }}>
          {title}
        </div>

        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={processing ? 100 : pct}
          style={{ height: 10, background: 'var(--bg-base)', border: '1px solid var(--border-primary)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${processing ? 100 : pct}%`, background: 'var(--accent-amber)',
            transition: 'width 0.4s', opacity: processing ? 0.6 : 1,
          }} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8, color: 'var(--text-dim)', fontSize: '0.75rem' }}>
          <span>{processing ? 'Uploaded — the server is finishing up…' : `${pct}% · ${fmtBytes(loaded)} of ${fmtBytes(total)}`}</span>
          {!processing && remaining && <span>~{remaining} left</span>}
        </div>

        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.5, margin: '14px 0 0' }}>
          <strong style={{ color: 'var(--accent-orange, #ff6b35)' }}>Keep this page open.</strong>{' '}
          Refreshing, closing or leaving it will cancel the upload.
        </p>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
          {!processing && (
            <button onClick={() => visible.forEach(u => cancelUpload(u.id))} style={btn}>CANCEL</button>
          )}
          <button onClick={() => setMinimized(true)} style={{ ...btn, borderColor: 'var(--accent-amber)', color: 'var(--accent-amber)' }}>KEEP BROWSING</button>
        </div>
      </div>
    </div>
  );
};

export default UploadProgress;
