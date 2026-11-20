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
 * Shape: { v: 1, people: { [personId]: { key, seenAt, changedAt?, previousKey?, unacknowledged? } } }
 * Pure functions: callers save what they return.
 */

export function emptyKeyRecords() {
  return { v: 1, people: {} };
}

/**
 * Note the key just looked up for someone.
 * @returns {{ status: 'new'|'same'|'changed', records: object }}
 */
export function noteKey(records, personId, publicKey, now = new Date().toISOString()) {
  const people = records?.people || {};
  const prev = people[personId];
  if (!prev) {
    return { status: 'new', records: { v: 1, people: { ...people, [personId]: { key: publicKey, seenAt: now } } } };
  }
  if (prev.key === publicKey) return { status: 'same', records };
  return {
    status: 'changed',
    records: {
      v: 1,
      people: {
        ...people,
        [personId]: { key: publicKey, seenAt: prev.seenAt, changedAt: now, previousKey: prev.key, unacknowledged: true },
      },
    },
  };
}

/** The person has seen the flag. */
export function acknowledgeKeyChange(records, personId) {
  const prev = records?.people?.[personId];
  if (!prev?.unacknowledged) return records;
  const { unacknowledged, ...rest } = prev;
  return { v: 1, people: { ...records.people, [personId]: rest } };
}

/** Changes not yet seen: [{ personId, changedAt }]. */
export function unacknowledgedChanges(records) {
  return Object.entries(records?.people || {})
    .filter(([, e]) => e.unacknowledged)
    .map(([personId, e]) => ({ personId, changedAt: e.changedAt }));
}

const latest = (e) => e.changedAt || e.seenAt || '';

/**
 * Two devices saved at once: keep both. For the same person with the same
 * key, a flag dismissed on either device stays dismissed; with different
 * keys, the later sighting wins and stays flagged.
 */
export function mergeKeyRecords(a, b) {
  const people = { ...(a?.people || {}) };
  for (const [id, theirs] of Object.entries(b?.people || {})) {
    const mine = people[id];
    if (!mine) { people[id] = theirs; continue; }
    if (mine.key === theirs.key) {
      const merged = latest(mine) >= latest(theirs) ? { ...mine } : { ...theirs };
      if (!(mine.unacknowledged && theirs.unacknowledged)) delete merged.unacknowledged;
      people[id] = merged;
    } else {
      people[id] = latest(mine) >= latest(theirs) ? mine : theirs;
    }
  }
  return { v: 1, people };
}
