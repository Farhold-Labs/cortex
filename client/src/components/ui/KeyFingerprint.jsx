import React, { useContext, useEffect, useState } from 'react';
import E2EEContext from '../../../e2ee-context.jsx';
import { KEY_FINGERPRINT as K } from '../../../messages.js';
import { askConfirm } from '../../utils/askConfirm.jsx';

// Encryption key fingerprints (v2.149.0, docs/federated-e2ee/ phase 1).
//
// A fingerprint is what two people compare, over a call or in person, to know
// the key their apps use for each other is the real one. The server hands out
// public keys, so without this a server that swapped one would go unseen.
// After comparing, a person marks the key verified; the mark is for that key
// only, and a later change says the verification no longer holds.

const mono = { fontFamily: 'monospace' };

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
  changed: { color: 'var(--accent-amber)', label: K.changed, short: K.changed },
};

/** A small mark for a member list: nothing unless verified or changed. */
export function KeyStandingBadge({ standing, short = false }) {
  const s = STANDING_STYLE[standing];
  if (!s) return null;
  return (
    <span style={{ ...mono, color: s.color, marginLeft: '4px', fontSize: '0.6rem' }}>{short ? s.short : s.label}</span>
  );
}

/** This person's own fingerprint, for Settings. */
export function MyKeyFingerprint() {
  const e2ee = useContext(E2EEContext);
  if (!e2ee) return null;
  if (!e2ee.isUnlocked) return <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{K.locked}</div>;
  return (
    <div>
      <FingerprintText fingerprint={e2ee.myFingerprint} size="1rem" />
      <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '8px', lineHeight: 1.5 }}>{K.yourKeyHint}</div>
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
    if (info?.standing === 'changed' || info?.standing === 'lost') {
      if ((e2ee.keyChanges || []).some(c => c.personId === userId)) e2ee.acknowledgeKeyChange(userId);
    }
  }, [info?.standing, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!e2ee.isUnlocked) return <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{K.locked}</div>;
  if (error) return <div style={{ color: 'var(--accent-orange)', fontSize: '0.75rem' }}>{K.loadFailed}</div>;
  if (info === undefined) return <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>…</div>;
  if (info === null) return <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{K.noKey(name)}</div>;

  const s = STANDING_STYLE[info.standing];
  const verify = async () => {
    if (!(await askConfirm(K.verifyAsk(name, info.fingerprint)))) return;
    setBusy(true);
    try {
      // Look it up again: mark the key the server gives now, not one shown earlier.
      const now = await e2ee.describeKey(userId);
      if (!now || now.publicKey !== info.publicKey) { setInfo(now); setNotice(K.keyMovedOn); return; }
      setNotice(null);
      await e2ee.markKeyVerified(userId, info.publicKey);
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
