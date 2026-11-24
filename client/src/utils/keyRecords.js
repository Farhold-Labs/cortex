/**
 * Keys seen (v2.143.0).
 *
 * Each person keeps a record of the public key their devices have seen for
 * everyone they have given a wave key to. When the server hands over a
 * different key for someone, the device still gives them the wave key (Jared,
 * 2026-11-20: seamless until encryption across servers is finished), but the
 * change is flagged in every encrypted wave shared with them. That is what
 * makes a server that substitutes a key visible instead of silent.
 *
 * The record is stored on the server encrypted under the person's own key
 * (crypto.js encryptKeyRecords), so the server cannot read or forge it. It
 * could delete or roll it back, which makes a change look like a first
 * sighting; that limit is accepted (docs/federated-e2ee/01-design.md).
 *
 * Identities (v2.150.0, docs/federated-e2ee/02-identity-keys.md). Someone with
 * an identity has a fingerprint that lasts: their identity key signs a
 * statement naming their encryption key, with a seq that only goes up. Their
 * keys can be renewed (a higher seq under the same identity) and nothing is
 * flagged; verification is of the identity, so it stays. A different identity
 * is a change, and loses a verification. Keys not signed by their identity
 * ("unsigned") are never legitimate and are flagged; the device withholds wave
 * keys from them. Verifications from v2.149.0 were of an encryption key and
 * can't carry over: they become "compare once more" (`recheck`).
 *
 * Shape: { v: 1, people: { [personId]: { key, seenAt, changedAt?, previousKey?,
 *   unacknowledged?, identity?, seq?, previousIdentity?, renewedAt?,
 *   verifiedIdentity?, verifiedAt?, unverifiedAt?, verificationLost?, recheck?,
 *   unsigned?, unsignedAt?, unsignedRaised?, verifiedKey? (v2.149.0 only) } } }
 * Pure functions: callers save what they return.
 */

export function emptyKeyRecords() {
  return { v: 1, people: {} };
}

const put = (records, personId, entry) => ({ v: 1, people: { ...(records?.people || {}), [personId]: entry } });

/**
 * Note the key just looked up for someone without an identity (yet).
 * @returns {{ status: 'new'|'same'|'changed'|'downgrade', records: object }}
 *   downgrade: they had an identity, and now come without one. Nothing is
 *   changed; the caller treats it as unsigned.
 */
export function noteKey(records, personId, publicKey, now = new Date().toISOString()) {
  const prev = records?.people?.[personId];
  if (!prev) {
    return { status: 'new', records: put(records, personId, { key: publicKey, seenAt: now }) };
  }
  if (prev.identity) return { status: 'downgrade', records };
  if (prev.key === publicKey) return { status: 'same', records };
  const next = { key: publicKey, seenAt: prev.seenAt, changedAt: now, previousKey: prev.key, unacknowledged: true };
  if (prev.verifiedKey || prev.verificationLost) next.verificationLost = true;
  return { status: 'changed', records: put(records, personId, next) };
}

/**
 * Note someone's identity and the keys it signed, after the statement checked.
 * @returns {{ status: 'new'|'same'|'renewed'|'changed'|'rollback', records }}
 *   renewed: same identity, a later statement: their keys were replaced, the
 *     fingerprint and any verification stay, nothing is flagged.
 *   rollback: an older statement than one already seen, or a different key
 *     under one already seen. Nothing is changed; the caller refuses the key.
 */
export function noteIdentity(records, personId, { identity, seq, key }, now = new Date().toISOString()) {
  const prev = records?.people?.[personId];
  if (!prev) {
    return { status: 'new', records: put(records, personId, { key, identity, seq, seenAt: now }) };
  }
  // A valid statement settles an earlier unsigned lookup; the flag goes with
  // it unless something else had raised it.
  const { unsigned, unsignedAt, unsignedRaised, ...rest } = prev;
  if (unsignedRaised) delete rest.unacknowledged;
  if (!prev.identity) {
    // Their first identity. A verification from v2.149.0 was of a key, and the
    // server could have made this identity and signed that key with it.
    const { verifiedKey, verifiedAt, unverifiedAt, verificationLost, ...plain } = rest;
    const next = { ...plain, key, identity, seq, seenAt: prev.seenAt || now };
    if (verifiedKey || verificationLost) next.recheck = true;
    return { status: 'new', records: put(records, personId, next) };
  }
  if (prev.identity === identity) {
    if (seq < prev.seq || (seq === prev.seq && key !== prev.key)) return { status: 'rollback', records };
    if (seq === prev.seq) {
      return { status: 'same', records: unsigned ? put(records, personId, rest) : records };
    }
    return { status: 'renewed', records: put(records, personId, { ...rest, key, seq, previousKey: prev.key, renewedAt: now }) };
  }
  const next = {
    key, identity, seq, seenAt: prev.seenAt, changedAt: now,
    previousIdentity: prev.identity, previousKey: prev.key, unacknowledged: true,
  };
  if (prev.verifiedIdentity || prev.verificationLost || prev.recheck) next.verificationLost = true;
  return { status: 'changed', records: put(records, personId, next) };
}

/**
 * The keys served for someone aren't signed by their identity: a statement
 * that doesn't check, doesn't name the key, or is missing for someone who had
 * one. A person's own device never makes that; it means the server (or a bug).
 */
export function markUnsigned(records, personId, now = new Date().toISOString()) {
  const prev = records?.people?.[personId];
  if (prev?.unsigned) return records;
  return put(records, personId, {
    ...(prev || { seenAt: now }), unsigned: true, unsignedAt: now, unacknowledged: true,
    ...(prev?.unacknowledged ? {} : { unsignedRaised: true }),
  });
}

/**
 * The person compared fingerprints and says this identity is theirs. Only the
 * identity on record can be verified: if it changed since they looked, nothing
 * is marked and they must compare the new one.
 */
export function markVerified(records, personId, identity, now = new Date().toISOString()) {
  const prev = records?.people?.[personId];
  if (!prev?.identity || prev.identity !== identity || prev.unsigned) return records;
  const { unacknowledged, verificationLost, unverifiedAt, recheck, verifiedKey, ...rest } = prev;
  return put(records, personId, { ...rest, verifiedIdentity: identity, verifiedAt: now });
}

export function unmarkVerified(records, personId, now = new Date().toISOString()) {
  const prev = records?.people?.[personId];
  if (!prev?.verifiedIdentity) return records;
  const { verifiedIdentity, verifiedAt, ...rest } = prev;
  return put(records, personId, { ...rest, unverifiedAt: now });
}

/**
 * How someone stands for this person:
 *   'verified'  they verified this identity
 *   'lost'      they had verified an earlier identity; this one is not verified
 *   'recheck'   they verified a key before identities (v2.149.0): compare once more
 *   'changed'   the identity changed and they have not looked yet
 *   'unsigned'  the keys served aren't signed by their identity: wave keys withheld
 *   'legacy'    no identity yet (an app from before v2.150.0)
 *   'seen'      on record, never verified
 *   'unknown'   not on record (or a different identity from the one on record)
 * @param identity the identity being shown, or null for someone without one
 */
export function keyStanding(records, personId, identity) {
  const e = records?.people?.[personId];
  if (!e) return 'unknown';
  if (e.unsigned) return 'unsigned';
  if (!identity) return e.identity ? 'unsigned' : 'legacy';
  if (e.identity !== identity) return 'unknown';
  if (e.verifiedIdentity === identity) return 'verified';
  if (e.verificationLost) return 'lost';
  if (e.recheck) return 'recheck';
  if (e.unacknowledged) return 'changed';
  return 'seen';
}

/** The person has seen the flag. */
export function acknowledgeKeyChange(records, personId) {
  const prev = records?.people?.[personId];
  if (!prev?.unacknowledged) return records;
  const { unacknowledged, ...rest } = prev;
  return put(records, personId, rest);
}

/** Changes not yet seen: [{ personId, changedAt, verificationLost, unsigned }]. */
export function unacknowledgedChanges(records) {
  return Object.entries(records?.people || {})
    .filter(([, e]) => e.unacknowledged)
    .map(([personId, e]) => ({
      personId,
      changedAt: e.unsigned ? e.unsignedAt : e.changedAt,
      verificationLost: !!e.verificationLost,
      unsigned: !!e.unsigned,
    }));
}

const latest = (e) => [e.changedAt, e.seenAt, e.verifiedAt, e.unverifiedAt, e.renewedAt, e.unsignedAt]
  .filter(Boolean).sort().pop() || '';

const VERIFICATION_FIELDS = ['verifiedIdentity', 'verifiedAt', 'unverifiedAt', 'verificationLost', 'recheck'];
const verificationTime = (e) => [e.verifiedAt, e.unverifiedAt].filter(Boolean).sort().pop() || '';

/**
 * Two devices saved at once: keep both. For the same person with the same
 * key, a flag dismissed on either device stays dismissed; with different
 * keys, the later sighting wins and stays flagged. Under one identity, the
 * later statement's keys win and the later verification decision wins.
 */
export function mergeKeyRecords(a, b) {
  const people = { ...(a?.people || {}) };
  for (const [id, theirs] of Object.entries(b?.people || {})) {
    const mine = people[id];
    if (!mine) { people[id] = theirs; continue; }
    if (mine.identity && mine.identity === theirs.identity && !mine.unsigned && !theirs.unsigned) {
      const base = (mine.seq || 0) !== (theirs.seq || 0)
        ? ((mine.seq || 0) > (theirs.seq || 0) ? mine : theirs)
        : (latest(mine) >= latest(theirs) ? mine : theirs);
      const decided = verificationTime(mine) >= verificationTime(theirs) ? mine : theirs;
      const merged = { ...base };
      for (const f of VERIFICATION_FIELDS) { if (decided[f] !== undefined) merged[f] = decided[f]; else delete merged[f]; }
      if (merged.verifiedIdentity) { delete merged.verificationLost; delete merged.recheck; }
      if (!(mine.unacknowledged && theirs.unacknowledged)) delete merged.unacknowledged;
      people[id] = merged;
    } else if (mine.key === theirs.key && (mine.identity || null) === (theirs.identity || null) && !!mine.unsigned === !!theirs.unsigned) {
      const merged = latest(mine) >= latest(theirs) ? { ...mine } : { ...theirs };
      if (!(mine.unacknowledged && theirs.unacknowledged)) delete merged.unacknowledged;
      people[id] = merged;
    } else {
      people[id] = latest(mine) >= latest(theirs) ? mine : theirs;
    }
  }
  return { v: 1, people };
}
