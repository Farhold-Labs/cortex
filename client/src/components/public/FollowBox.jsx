import React, { useState, useEffect } from 'react';
import { API_URL } from '../../config/constants.js';

// Shared by /events and /portal (v2.92.1). Extracted rather than copied: this
// repo has lost time to the same component existing twice and drifting, so the
// portal uses the events page's box rather than a near-identical sibling.

const card = {
  border: '1px solid var(--border-primary, #1e3a1e)',
  background: 'var(--bg-surface, #0a120a)',
  padding: 16,
};

const label = {
  color: 'var(--text-dim, #8aa08a)', fontSize: '0.7rem',
  letterSpacing: '0.12em', marginBottom: 10,
};

const btn = (primary) => ({
  padding: '9px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.8rem',
  letterSpacing: '0.05em',
  background: primary ? 'var(--overlay-amber, rgba(255,210,63,0.12))' : 'transparent',
  border: `1px solid ${primary ? 'var(--accent-amber, #ffd23f)' : 'var(--border-primary, #1e3a1e)'}`,
  color: primary ? 'var(--accent-amber, #ffd23f)' : 'var(--text-secondary, #7aad7a)',
});

// ============ FOLLOW: keep me posted, without an account (v2.92.0) ============
//
// Three states in one component, because they are three views of the same
// thing: signing up, confirming from the emailed link, and managing what you
// already have. All of them work with no account and no session.

const FollowBox = ({ slug, title }) => {
  const params = new URLSearchParams(window.location.search);
  const confirmToken = params.get('confirm');
  const manageToken = params.get('manage');

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [manage, setManage] = useState(null);

  // Coming back from the confirmation email.
  useEffect(() => {
    if (!confirmToken) return;
    fetch(`${API_URL}/public/follow/confirm`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: confirmToken }),
    })
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) setDone('Confirmed — you will hear from us.');
        else setError(d.error || 'That link is no longer valid.');
      })
      .catch(() => setError('Could not reach the server.'));
  }, [confirmToken]);

  // Coming back from the link in a digest.
  useEffect(() => {
    if (!manageToken) return;
    fetch(`${API_URL}/public/follow/manage?token=${encodeURIComponent(manageToken)}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) { setManage(d); setFrequency(d.frequency); }
        else setError(d.error || 'That link is no longer valid.');
      })
      .catch(() => setError('Could not reach the server.'));
  }, [manageToken]);

  const signUp = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/public/follow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || undefined, slug, frequency }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error || 'Could not sign you up.'); return; }
      // Deliberately the same message whatever happened server-side, so this
      // form cannot be used to find out whether an address is already on a list.
      setDone(d.message || 'Check your email to confirm.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const saveFrequency = async (next) => {
    setFrequency(next); setBusy(true);
    try {
      await fetch(`${API_URL}/public/follow/frequency`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: manageToken, frequency: next }),
      });
      setDone('Saved.');
    } catch { setError('Could not save.'); } finally { setBusy(false); }
  };

  const unsubscribe = async () => {
    if (!window.confirm('Stop all updates to this address?')) return;
    setBusy(true);
    try {
      await fetch(`${API_URL}/public/follow/unsubscribe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: manageToken }),
      });
      setManage(null);
      setDone('Unsubscribed. You will not hear from us again.');
    } catch { setError('Could not unsubscribe.'); } finally { setBusy(false); }
  };

  const box = {
    ...card, marginTop: 20,
    borderColor: 'var(--border-subtle, #1d2a1d)',
  };
  const input = {
    width: '100%', boxSizing: 'border-box', padding: '9px 10px', marginBottom: 8,
    background: 'var(--bg-elevated, #0c140c)', border: '1px solid var(--border-subtle, #1d2a1d)',
    color: 'var(--text-primary, #d8e8d8)', fontFamily: 'inherit', fontSize: '0.85rem',
  };

  if (manage) {
    return (
      <div style={box}>
        <div style={label}>YOUR UPDATES</div>
        {manage.following?.length > 0 && (
          <div style={{ color: 'var(--text-dim, #8aa08a)', fontSize: '0.8rem', marginBottom: 10 }}>
            Following: {manage.following.join(', ')}
          </div>
        )}
        <div style={{ color: 'var(--text-dim, #8aa08a)', fontSize: '0.8rem', marginBottom: 6 }}>How often?</div>
        <select value={frequency} disabled={busy} onChange={e => saveFrequency(e.target.value)} style={input}>
          <option value="immediate">As things happen</option>
          <option value="daily">Once a day</option>
          <option value="weekly">Once a week</option>
        </select>
        {done && <div style={{ color: 'var(--accent-green, #0ead69)', fontSize: '0.8rem', marginBottom: 8 }}>{done}</div>}
        <button onClick={unsubscribe} disabled={busy} style={{ ...btn(false), width: '100%' }}>
          STOP ALL UPDATES
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div style={box}>
        <div style={label}>KEEP ME POSTED</div>
        <div style={{ color: 'var(--accent-green, #0ead69)', fontSize: '0.85rem' }}>{done}</div>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={label}>KEEP ME POSTED</div>
      <div style={{ color: 'var(--text-dim, #8aa08a)', fontSize: '0.8rem', marginBottom: 10, lineHeight: 1.5 }}>
        Get an email when {title || 'this page'} posts something new. No account needed —
        just an address, and one link in every email to stop or change it.
      </div>
      <form onSubmit={signUp}>
        <input style={input} type="email" required value={email} placeholder="you@example.com"
               onChange={e => setEmail(e.target.value)} />
        <input style={input} type="text" value={name} placeholder="your name (optional)"
               onChange={e => setName(e.target.value)} />
        <select value={frequency} onChange={e => setFrequency(e.target.value)} style={input}>
          <option value="daily">Once a day (recommended)</option>
          <option value="immediate">As things happen</option>
          <option value="weekly">Once a week</option>
        </select>
        {error && <div style={{ color: 'var(--accent-orange, #ff9f45)', fontSize: '0.8rem', marginBottom: 8 }}>{error}</div>}
        <button type="submit" disabled={busy || !email} style={{ ...btn(true), width: '100%' }}>
          {busy ? 'SENDING…' : 'KEEP ME POSTED'}
        </button>
      </form>
    </div>
  );
};

export default FollowBox;
