import React, { useContext, useEffect, useState } from 'react';
import E2EEContext from '../../../e2ee-context.jsx';
import { KEY_FINGERPRINT as K } from '../../../messages.js';
import { askConfirm } from '../../utils/askConfirm.jsx';

// Fingerprints (v2.149.0; of a lasting identity since v2.150.0,
// docs/federated-e2ee/02-identity-keys.md).
//
// A fingerprint is what two people compare, over a call or in person, to know
// the keys their apps use for each other are the real ones. Since v2.150.0 it
// is the fingerprint of a person's identity key, which signs their encryption
// keys: those can be replaced and the fingerprint, and everyone's verification
// of it, stays. The identity is locked by the recovery key alone.

const mono = { fontFamily: 'monospace' };
const hint = { color: 'var(--text-dim)', fontSize: '0.75rem', lineHeight: 1.5 };
const warn = (color) => ({ color: `var(${color})`, fontSize: '0.75rem', lineHeight: 1.5 });

/** 8 groups of 4, set as two lines of four so it reads aloud in order. */
export function FingerprintText({ fingerprint, size = '0.85rem' }) {
  const groups = (fingerprint || '').split(' ');
  return (
    <div aria-label={`Fingerprint ${fingerprint}`} style={{ ...mono, fontSize: size, letterSpacing: '0.05em', color: 'var(--text-primary)', lineHeight: 1.6, userSelect: 'all' }}>
      <div>{groups.slice(0, 4).join(' ')}</div>
      <div>{groups.slice(4).join(' ')}</div>
    </div>
  );
}

const STANDING_STYLE = {
  verified: { color: 'var(--accent-green)', label: K.verified, short: K.verified },
  lost: { color: 'var(--accent-orange)', label: K.lost, short: K.lostShort },
  changed: { color: 'var(--accent-amber)', label: K.changed, short: K.changedShort },
  recheck: { color: 'var(--accent-amber)', label: K.recheck, short: K.recheckShort },
  unsigned: { color: 'var(--accent-orange)', label: K.unsigned, short: K.unsignedShort },
};

/** A small mark for a member list: nothing unless there is something to say. */
export function KeyStandingBadge({ standing, short = false }) {
  const s = STANDING_STYLE[standing];
  if (!s) return null;
  return (
    <span style={{ ...mono, color: s.color, marginLeft: '4px', fontSize: '0.6rem' }}>{short ? s.short : s.label}</span>
  );
}

const buttonStyle = (color, busy) => ({
  ...mono, padding: '8px 12px', minHeight: '36px', background: 'transparent', cursor: busy ? 'wait' : 'pointer',
  fontSize: '0.65rem', border: `1px solid var(${color})`, color: `var(${color})`,
});

function RecoveryKeyInput({ label, value, onChange, autoFocus = false }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
      {label}
      <input
        value={value}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        onChange={e => onChange(e.target.value.toUpperCase())}
        style={{ ...mono, padding: '8px', fontSize: '0.85rem', background: 'var(--bg-base)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', width: '100%', maxWidth: '22rem', boxSizing: 'border-box' }}
      />
    </label>
  );
}

/** A new recovery key, shown once. Nothing changes until the person says they saved it. */
function NewRecoveryKeyCard({ recoveryKey, onSaved, onCancel, busy }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px', border: '1px solid var(--accent-green)' }}>
      <div style={{ ...mono, color: 'var(--accent-green)', fontSize: '0.75rem' }}>{K.newRecoveryTitle.toUpperCase()}</div>
      <div style={{ ...mono, color: 'var(--accent-green)', fontSize: '1rem', letterSpacing: '1px', wordBreak: 'break-all', userSelect: 'all' }}>{recoveryKey}</div>
      <div style={hint}>{K.newRecoveryHint}</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" style={buttonStyle('--accent-green', false)} onClick={async () => {
          try { await navigator.clipboard.writeText(recoveryKey); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select it instead */ }
        }}>{copied ? K.copied : K.copy}</button>
        <button type="button" disabled={busy} style={buttonStyle('--accent-green', busy)} onClick={onSaved}>{K.saved}</button>
        <button type="button" disabled={busy} style={buttonStyle('--border-primary', busy)} onClick={onCancel}>{K.cancel}</button>
      </div>
    </div>
  );
}

/** This person's own fingerprint, for Settings, with what can be done about it. */
export function MyKeyFingerprint() {
  const e2ee = useContext(E2EEContext);
  if (!e2ee) return null;
  if (!e2ee.isUnlocked) return <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{K.locked}</div>;
  return <MyIdentity e2ee={e2ee} />;
}

function MyIdentity({ e2ee }) {
  const id = e2ee.myIdentity;
  const [recovery, setRecovery] = useState('');
  const [password, setPassword] = useState('');
  const [newKey, setNewKey] = useState(null);   // { key, then }
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const run = async (fn) => {
    setBusy(true); setError(null); setDone(null);
    try { await fn(); } catch (err) { setError(err.message || String(err)); } finally { setBusy(false); }
  };
  // A new recovery key is shown first; `then` runs only once it is saved.
  const withNewKey = (then) => { setError(null); setNewKey({ key: e2ee.newRecoveryKey(), then }); };
  const savedNewKey = () => run(async () => {
    await newKey.then(newKey.key);
    setNewKey(null); setRecovery('');
    setDone(K.identityDone);
  });

  if (!id) return <div style={hint}>…</div>;
  const errorLine = error && <div role="alert" style={warn('--accent-orange')}>{error}</div>;
  const doneLine = done && <div role="status" style={warn('--accent-green')}>{done}</div>;
  if (newKey) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <NewRecoveryKeyCard recoveryKey={newKey.key} busy={busy} onSaved={savedNewKey} onCancel={() => setNewKey(null)} />
        {errorLine}
      </div>
    );
  }

  if (id.state === 'none') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>{K.noneTitle}</div>
        <div style={hint}>{K.noneHint}</div>
        <RecoveryKeyInput label={K.enterRecovery} value={recovery} onChange={setRecovery} />
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" disabled={busy || !recovery.trim()} style={buttonStyle('--accent-green', busy)}
            onClick={() => run(async () => { await e2ee.createIdentity({ recoveryKey: recovery.trim() }); setRecovery(''); setDone(K.identityDone); })}>{K.create}</button>
          <button type="button" disabled={busy} style={buttonStyle('--border-primary', busy)}
            onClick={() => withNewKey(key => e2ee.createIdentity({ recoveryKey: key, isNewRecoveryKey: true }))}>{K.noRecovery}</button>
        </div>
        {errorLine}{doneLine}
      </div>
    );
  }

  if (id.state === 'stale') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <FingerprintText fingerprint={id.fingerprint} size="1rem" />
        <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>{K.staleTitle}</div>
        <div style={hint}>{K.staleHint}</div>
        <RecoveryKeyInput label={K.previousRecovery} value={recovery} onChange={setRecovery} />
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" disabled={busy || !recovery.trim()} style={buttonStyle('--accent-green', busy)}
            onClick={() => run(async () => {
              const old = recovery.trim();
              // Check it opens the identity before showing a new key to save.
              await e2ee.checkIdentityKey(old);
              withNewKey(key => e2ee.keepIdentity({ oldRecoveryKey: old, newRecoveryKey: key }));
            })}>{K.keep}</button>
          <button type="button" disabled={busy} style={buttonStyle('--accent-orange', busy)}
            onClick={async () => { if (await askConfirm(K.replaceIdentityAsk)) withNewKey(key => e2ee.replaceIdentity({ newRecoveryKey: key })); }}>{K.startNew}</button>
        </div>
        {errorLine}{doneLine}
      </div>
    );
  }

  if (id.state !== 'ok') {
    const text = id.state === 'elsewhere' || id.state === 'outdated' ? K.elsewhere : id.state === 'mismatch' ? K.mismatch : K.unknown;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {id.fingerprint && <FingerprintText fingerprint={id.fingerprint} size="1rem" />}
        <div role="alert" style={warn(id.state === 'mismatch' ? '--accent-orange' : '--text-secondary')}>{text}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <FingerprintText fingerprint={id.fingerprint} size="1rem" />
      <div style={hint}>{K.yourKeyHint}</div>
      {id.changedAt && (
        <div role="alert" style={{ ...warn('--accent-orange'), display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span>{K.changedSelf(new Date(id.changedAt).toLocaleString())}</span>
          <button type="button" style={buttonStyle('--accent-orange', false)} onClick={async () => { await e2ee.acknowledgeKeyChange(id.userId); e2ee.refreshIdentity(); }}>OK</button>
        </div>
      )}
      {replacing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', border: '1px solid var(--border-subtle)' }}>
          <div style={hint}>{K.replaceKeysHint}</div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
            {K.password}
            <input type="password" value={password} autoComplete="current-password" onChange={e => setPassword(e.target.value)}
              style={{ ...mono, padding: '8px', fontSize: '0.85rem', background: 'var(--bg-base)', border: '1px solid var(--border-primary)', color: 'var(--text-primary)', width: '100%', maxWidth: '22rem', boxSizing: 'border-box' }} />
          </label>
          <RecoveryKeyInput label={K.enterRecovery} value={recovery} onChange={setRecovery} />
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" disabled={busy || !password || !recovery.trim()} style={buttonStyle('--accent-teal', busy)}
              onClick={() => run(async () => {
                const r = await e2ee.replaceKeys({ password, recoveryKey: recovery.trim() });
                setPassword(''); setRecovery(''); setReplacing(false);
                setDone(K.keysReplaced(r?.dropped || 0));
              })}>{busy ? '…' : K.replaceKeysGo}</button>
            <button type="button" disabled={busy} style={buttonStyle('--border-primary', busy)} onClick={() => { setReplacing(false); setPassword(''); setRecovery(''); }}>{K.cancel}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} style={buttonStyle('--accent-teal', busy)} onClick={() => { setReplacing(true); setDone(null); }}>{K.replaceKeys}</button>
          <button type="button" disabled={busy} style={buttonStyle('--accent-orange', busy)}
            onClick={async () => { if (await askConfirm(K.replaceIdentityAsk)) withNewKey(key => e2ee.replaceIdentity({ newRecoveryKey: key })); }}>{K.replaceIdentity}</button>
        </div>
      )}
      {errorLine}{doneLine}
    </div>
  );
}

/**
 * Someone else's key: fingerprint, standing, and Mark as verified. Opening it
 * counts as seeing a change, so the flag on them clears.
 */
export function PersonKey(props) {
  const e2ee = useContext(E2EEContext);
  return e2ee ? <PersonKeyView e2ee={e2ee} {...props} /> : null;
}

/**
 * A collapsed "ENCRYPTION KEY" line that opens to PersonKey. Collapsed by
 * default: opening looks the key up, and a lookup records the key as seen.
 */
export function PersonKeyDisclosure({ userId, name, isMobile = false }) {
  const e2ee = useContext(E2EEContext);
  const [open, setOpen] = useState(false);
  if (!e2ee?.isE2EEEnabled) return null;
  const standing = e2ee.keyStandingOf(userId);
  return (
    <div style={{ border: '1px solid var(--border-subtle)', padding: '8px 10px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{ ...mono, background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: isMobile ? '6px 0' : 0, fontSize: '0.7rem', width: '100%', textAlign: 'left' }}
      >
        {open ? '▾' : '▸'} {K.theirKey(name).toUpperCase()}<KeyStandingBadge standing={standing} />
      </button>
      {open && <div style={{ marginTop: '8px' }}><PersonKey userId={userId} name={name} isMobile={isMobile} /></div>}
    </div>
  );
}

function PersonKeyView({ e2ee, userId, name, isMobile = false }) {
  const [info, setInfo] = useState(undefined); // undefined loading, null no key
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!e2ee.isUnlocked || !userId) return undefined;
    let live = true;
    e2ee.describeKey(userId)
      .then(d => { if (live) { setInfo(d); setError(false); } })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
    // keyRecordsTick: re-read after any change to the record, here or on another device
  }, [userId, e2ee.isUnlocked, e2ee.keyRecordsTick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (info?.standing === 'changed' || info?.standing === 'lost' || info?.standing === 'unsigned') {
      if ((e2ee.keyChanges || []).some(c => c.personId === userId)) e2ee.acknowledgeKeyChange(userId);
    }
  }, [info?.standing, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!e2ee.isUnlocked) return <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{K.locked}</div>;
  if (error) return <div style={{ color: 'var(--accent-orange)', fontSize: '0.75rem' }}>{K.loadFailed}</div>;
  if (info === undefined) return <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>…</div>;
  if (info === null) return <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{K.noKey(name)}</div>;

  if (info.standing === 'legacy') return <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', lineHeight: 1.5 }}>{K.legacy(name)}</div>;
  if (info.standing === 'unsigned') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ ...mono, fontSize: '0.65rem', color: STANDING_STYLE.unsigned.color }}>{K.unsigned}</div>
        <div style={{ color: 'var(--accent-orange)', fontSize: '0.75rem', lineHeight: 1.5 }}>{K.unsignedHint(name)}</div>
      </div>
    );
  }

  const s = STANDING_STYLE[info.standing];
  const verify = async () => {
    if (!(await askConfirm(K.verifyAsk(name, info.fingerprint)))) return;
    setBusy(true);
    try {
      // Look it up again: mark the identity the server gives now, not one shown earlier.
      const now = await e2ee.describeKey(userId);
      if (!now || now.identityKey !== info.identityKey) { setInfo(now); setNotice(K.keyMovedOn); return; }
      setNotice(null);
      await e2ee.markKeyVerified(userId, info.identityKey);
    } finally { setBusy(false); }
  };
  const unverify = async () => {
    setBusy(true);
    try { await e2ee.unmarkKeyVerified(userId); } finally { setBusy(false); }
  };
  const button = {
    ...mono, padding: isMobile ? '8px 12px' : '4px 10px', minHeight: isMobile ? '40px' : 'auto',
    background: 'transparent', cursor: busy ? 'wait' : 'pointer', fontSize: '0.65rem',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ ...mono, fontSize: '0.65rem', color: s?.color || 'var(--text-dim)' }}>{s?.label || K.notVerified}</div>
      <FingerprintText fingerprint={info.fingerprint} />
      {info.standing === 'lost' && <div style={{ color: 'var(--accent-orange)', fontSize: '0.75rem', lineHeight: 1.5 }}>{K.lostHint(name)}</div>}
      {info.standing === 'changed' && <div style={{ color: 'var(--accent-amber)', fontSize: '0.75rem', lineHeight: 1.5 }}>{K.changedHint(name)}</div>}
      {info.standing === 'recheck' && <div style={{ color: 'var(--accent-amber)', fontSize: '0.75rem', lineHeight: 1.5 }}>{K.recheckHint(name)}</div>}
      {notice && <div role="status" style={{ color: 'var(--accent-orange)', fontSize: '0.75rem' }}>{notice}</div>}
      {info.standing !== 'verified' && <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', lineHeight: 1.5 }}>{K.compareHint(name)}</div>}
      <div>
        {info.standing === 'verified' ? (
          <button disabled={busy} onClick={unverify} style={{ ...button, border: '1px solid var(--border-primary)', color: 'var(--text-secondary)' }}>{K.unmarkVerified}</button>
        ) : (
          <button disabled={busy} onClick={verify} style={{ ...button, border: '1px solid var(--accent-green)', color: 'var(--accent-green)' }}>{K.markVerified}</button>
        )}
      </div>
    </div>
  );
}

const PROMPT_LATER = 'farhold_identity_prompt_later';

/**
 * Asks, once a session, someone without a fingerprint (everyone on the day
 * v2.150.0 arrives, and anyone whose encryption was reset) to set it up. It
 * needs their recovery key, which only they have, so it can't be done for
 * them. LATER puts it off until the next session; Settings → Security → Your
 * fingerprint always has it.
 */
export function IdentityPrompt() {
  const e2ee = useContext(E2EEContext);
  const [later, setLater] = useState(() => { try { return sessionStorage.getItem(PROMPT_LATER) === '1'; } catch { return false; } });
  const [shown, setShown] = useState(false);
  const state = e2ee?.myIdentity?.state;
  useEffect(() => { if (state === 'none' || state === 'stale' || state === 'outdated') setShown(true); }, [state]);
  if (!e2ee?.isUnlocked || later || !shown) return null;
  const close = () => {
    try { sessionStorage.setItem(PROMPT_LATER, '1'); } catch { /* the next session asks again */ }
    setLater(true);
  };
  const finished = state === 'ok';
  return (
    <div role="dialog" aria-modal="true" aria-label={K.yourKey}
      style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent-teal)', padding: '16px', width: '100%', maxWidth: '30rem', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ ...mono, color: 'var(--accent-teal)', fontSize: '0.85rem' }}>{K.yourKey.toUpperCase()}</div>
        <MyKeyFingerprint />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={close} style={buttonStyle(finished ? '--accent-green' : '--border-primary', false)}>{finished ? 'DONE' : K.later}</button>
        </div>
      </div>
    </div>
  );
}
