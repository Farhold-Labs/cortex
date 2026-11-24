import React from 'react';
import { createRoot } from 'react-dom/client';

// "Are you sure?" inside the app (v2.148.0).
//
// Leaving a wave or crew and removing a contact or someone from a crew are
// hard to take back. They used the browser's confirm(), which a browser can
// be told to stop showing and which looks like the browser asking, not
// Cortex; removing a contact or a crew member did not ask at all. This draws
// the question in the app, the way askGroupScope() does, and resolves true
// only on the confirming button. Cancel, a tap outside and Escape all say no.

function ConfirmDialog({ title, message, confirmLabel, onDone }) {
  return (
    <div
      role="alertdialog" aria-modal="true" aria-label={title}
      onClick={() => onDone(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: '420px', background: 'var(--bg-elevated)', border: '1px solid var(--accent-orange)',
        padding: '16px', fontFamily: 'monospace',
      }}>
        <div style={{ color: 'var(--accent-orange)', fontSize: '0.95rem', marginBottom: '8px' }}>{title}</div>
        <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.5, whiteSpace: 'pre-line' }}>{message}</div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px', flexWrap: 'wrap' }}>
          <button autoFocus onClick={() => onDone(false)} style={{
            padding: '10px 16px', minHeight: '44px', background: 'transparent', border: '1px solid var(--border-primary)',
            color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.8rem',
          }}>Cancel</button>
          <button onClick={() => onDone(true)} style={{
            padding: '10px 16px', minHeight: '44px', background: 'var(--accent-orange)', border: '1px solid var(--accent-orange)',
            color: 'var(--bg-base)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.8rem',
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** Ask once; resolves true only if the person confirms. */
export function askConfirm({ title, message, confirmLabel = 'Confirm' }) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    const done = (answer) => {
      window.removeEventListener('keydown', onKey);
      root.unmount();
      host.remove();
      resolve(answer === true);
    };
    window.addEventListener('keydown', onKey);
    root.render(<ConfirmDialog title={title} message={message} confirmLabel={confirmLabel} onDone={done} />);
  });
}
