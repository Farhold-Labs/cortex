import React, { useState, useEffect, useRef, useCallback } from 'react';
import { API_URL } from '../../config/constants.js';
import { storage } from '../../utils/storage.js';
import { setStepUpPrompt, storeStepUpToken } from '../../utils/stepUp.js';

// Password confirmation for sensitive actions (v2.75.0).
//
// Mounted once near the app root. It registers itself as the step-up prompt, so
// any request that gets STEP_UP_REQUIRED raises this dialog and is replayed
// afterwards — no caller has to know which routes are gated.

const StepUpModal = () => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const resolveRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    setStepUpPrompt((why) => new Promise((resolve) => {
      resolveRef.current = resolve;
      setReason(why || null);
      setPassword('');
      setError(null);
      setOpen(true);
    }));
    return () => setStepUpPrompt(null);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  const finish = useCallback((token) => {
    setOpen(false);
    setPassword('');
    setBusy(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(token);
  }, []);

  const submit = async (e) => {
    e?.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/step-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${storage.getToken()}` },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not confirm your password');
        setBusy(false);
        setPassword('');
        inputRef.current?.focus();
        return;
      }
      storeStepUpToken(data.stepUpToken, data.expiresInMinutes);
      finish(data.stepUpToken);
    } catch {
      setError('Network error — please try again');
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm your password"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onKeyDown={(e) => { if (e.key === 'Escape') finish(null); }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 'min(420px, 100%)',
          background: 'var(--bg-elevated, #0d160d)',
          border: '2px solid var(--accent-amber, #ffd23f)',
          padding: '22px 24px',
          fontFamily: 'monospace',
        }}
      >
        <div style={{
          color: 'var(--accent-amber, #ffd23f)', fontSize: '0.68rem',
          letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 10,
        }}>
          🔐 Confirm it's you
        </div>

        <p style={{ color: 'var(--text-secondary, #b8ccb8)', fontSize: '0.85rem', lineHeight: 1.5, margin: '0 0 16px' }}>
          {reason || 'This action needs your password, even though you are already signed in.'}
        </p>

        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          placeholder="Your password"
          autoComplete="current-password"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 12px',
            background: 'var(--bg-surface, #0a120a)',
            border: `1px solid ${error ? 'var(--accent-orange, #ff6b35)' : 'var(--border-primary, #3a4a3a)'}`,
            color: 'var(--text-primary, #d8e8d8)', fontFamily: 'monospace', fontSize: '0.9rem',
          }}
        />

        {error && (
          <div role="alert" style={{ color: 'var(--accent-orange, #ff6b35)', fontSize: '0.75rem', marginTop: 8 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button
            type="button"
            onClick={() => finish(null)}
            style={{
              padding: '9px 16px', minHeight: 38, background: 'transparent',
              border: '1px solid var(--border-primary, #3a4a3a)', color: 'var(--text-dim, #8aa08a)',
              cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!password || busy}
            style={{
              padding: '9px 16px', minHeight: 38,
              background: 'var(--accent-amber, #ffd23f)20',
              border: '1px solid var(--accent-amber, #ffd23f)',
              color: 'var(--accent-amber, #ffd23f)',
              cursor: (!password || busy) ? 'default' : 'pointer',
              opacity: (!password || busy) ? 0.5 : 1,
              fontFamily: 'monospace', fontSize: '0.75rem',
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}
          >
            {busy ? 'Checking…' : 'Confirm'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default StepUpModal;
