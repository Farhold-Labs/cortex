import React from 'react';
import { createRoot } from 'react-dom/client';
import { T } from '../config/terminology.js';

// "This wave only, or the whole group?" (v2.132.0).
//
// A group shared by several waves makes adding or removing someone a choice,
// and the server asks it with a 409 GROUP_SCOPE_REQUIRED rather than guessing.
// withGroupScope() runs a request, and if the server asks, shows this question
// and sends the request again with the answer. Cancelling throws an error with
// `cancelled` set, which callers treat as nothing having happened.

const COPY = {
  add: (who, n) => ({
    wave: [`This ${T.wave} only`, `${who} joins only this ${T.wave}. It moves into a group of its own with everyone already here; nobody is asked again.`],
    group: ['The whole group', `${who} is invited to all ${n} ${T.waves} of the group.`],
  }),
  remove: (who, n) => ({
    wave: [`This ${T.wave} only`, `${who} leaves only this ${T.wave}. It moves into a group of its own without them.`],
    group: ['The whole group', `${who} leaves the group and all ${n} of its ${T.waves}.`],
  }),
};

function ScopeDialog({ info, onDone }) {
  const n = info.waveCount || 2;
  const copy = COPY[info.action || 'add'](info.who || 'They', n);
  const option = (key) => (
    <button
      key={key}
      onClick={() => onDone(key)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginTop: '8px',
        background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-primary)',
        cursor: 'pointer', fontFamily: 'monospace',
      }}
    >
      <div style={{ color: 'var(--accent-amber)', fontSize: '0.85rem' }}>{copy[key][0]}</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '3px', lineHeight: 1.4 }}>{copy[key][1]}</div>
    </button>
  );
  return (
    <div
      role="dialog" aria-modal="true" aria-label="This wave or the whole group"
      onClick={() => onDone(null)}
      style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: '420px', background: 'var(--bg-elevated)', border: '1px solid var(--border-primary)',
        padding: '16px', fontFamily: 'monospace',
      }}>
        <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.4 }}>
          {info.groupName ? `${info.groupName} has` : 'This group has'} {n} {T.waves}.
        </div>
        {option('wave')}
        {option('group')}
        <button onClick={() => onDone(null)} style={{
          marginTop: '12px', padding: '6px 12px', background: 'transparent', border: '1px solid var(--border-subtle)',
          color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem',
        }}>Cancel</button>
      </div>
    </div>
  );
}

/** Ask once; resolves 'wave', 'group' or null. */
export function askGroupScope(info) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    const done = (answer) => {
      window.removeEventListener('keydown', onKey);
      root.unmount();
      host.remove();
      resolve(answer);
    };
    window.addEventListener('keydown', onKey);
    root.render(<ScopeDialog info={info} onDone={done} />);
  });
}

/** Run `send(scope)`; if the server asks which, ask the person and send again. */
export async function withGroupScope(send, { action = 'add', who } = {}) {
  try {
    return await send(undefined);
  } catch (err) {
    if (err?.code !== 'GROUP_SCOPE_REQUIRED') throw err;
    const scope = await askGroupScope({ action, who, waveCount: err.data?.waveCount, groupName: err.data?.groupName });
    if (!scope) {
      const cancelled = new Error('Cancelled');
      cancelled.cancelled = true;
      throw cancelled;
    }
    return send(scope);
  }
}
