import { useSealedDoc } from './sealedDoc.js';

/**
 * The GM's documents (v2.160.0, docs/ttrpg/README.md phase 3): encounters,
 * the GMs' half of an encounter, monster stat blocks and notes. The server
 * decides who reads each (its audience) and lets only GMs write.
 *  - For the table (an encounter, a handout): sealed under the wave key in an
 *    encrypted wave like sheets, plain elsewhere.
 *  - For the GMs only (v2.162.0): sealed with the GM key in every wave, so
 *    only the GMs' devices can open them.
 * Either way bound to the wave, the id and the kind.
 */

export const DEFAULT_AUDIENCE = { encounter: 'table', encounter_gm: 'gm', monster: 'gm', note: 'gm', map: 'gm', token: 'table' };

const base = (waveId) => `/waves/${encodeURIComponent(waveId)}/table-docs`;

export const newDocId = () => `doc-${crypto.randomUUID()}`;

async function seal(e2ee, wave, id, kind, data, audience = DEFAULT_AUDIENCE[kind]) {
  const text = JSON.stringify(data);
  if (audience === 'gm') {
    if (!e2ee?.isUnlocked) throw new Error('Unlock encryption to use the GM screen');
    const sealed = await e2ee.encryptGmDoc(text, wave.id, id, kind);
    return { keyScope: 'gm', encrypted: true, data: sealed.data, nonce: sealed.nonce, keyVersion: sealed.keyVersion };
  }
  if (!wave?.encrypted) return { data: text };
  if (!e2ee?.isUnlocked) throw new Error('Unlock encryption to change this in an encrypted wave');
  const sealed = await e2ee.encryptTableDoc(text, wave.id, id, kind);
  return { encrypted: true, data: sealed.data, nonce: sealed.nonce, keyVersion: sealed.keyVersion };
}

export async function openTableDoc(e2ee, waveId, doc) {
  if (!doc.encrypted) return JSON.parse(doc.data);
  if (!e2ee?.isUnlocked) throw Object.assign(new Error('Unlock encryption to read this'), { locked: true });
  if (doc.keyScope === 'gm') return JSON.parse(await e2ee.decryptGmDoc(doc.data, doc.nonce, waveId, doc.id, doc.kind, doc.keyVersion));
  return JSON.parse(await e2ee.decryptTableDoc(doc.data, doc.nonce, waveId, doc.id, doc.kind, doc.keyVersion));
}

/** Every document of a kind this person may read, opened; unreadable ones carry `error`. */
export async function listTableDocs(fetchAPI, e2ee, waveId, kind) {
  const { docs } = await fetchAPI(`${base(waveId)}?kind=${encodeURIComponent(kind)}`);
  return Promise.all((docs || []).map(async (d) => {
    try { return { ...d, body: await openTableDoc(e2ee, waveId, d) }; }
    catch (err) { return { ...d, body: null, error: err.locked ? 'locked' : err.code === 'NO_GM_KEY' ? 'no-gm-key' : 'unreadable' }; }
  }));
}

export async function createTableDoc(fetchAPI, e2ee, wave, { kind, audience, data, id = newDocId(), ownerId }) {
  const body = { id, kind, ...(audience ? { audience } : {}), ...(ownerId ? { ownerId } : {}), ...(await seal(e2ee, wave, id, kind, data, audience || DEFAULT_AUDIENCE[kind])) };
  const { doc } = await fetchAPI(base(wave.id), { method: 'POST', body });
  return doc;
}

export async function deleteTableDoc(fetchAPI, waveId, docId) {
  await fetchAPI(`${base(waveId)}/${encodeURIComponent(docId)}`, { method: 'DELETE' });
}

export function onTableDocUpdated(handler) {
  const listener = (e) => handler(e.detail || {});
  window.addEventListener('cortex:table-doc-updated', listener);
  return () => window.removeEventListener('cortex:table-doc-updated', listener);
}

export function onTableRoll(handler) {
  const listener = (e) => handler(e.detail || {});
  window.addEventListener('cortex:table-roll', listener);
  return () => window.removeEventListener('cortex:table-roll', listener);
}

/** One open document; `change(fn, { audience })` (see useSealedDoc). */
export function useTableDoc({ fetchAPI, e2ee, wave, docId, kind }) {
  return useSealedDoc({
    fetchAPI, e2ee, id: docId,
    url: `${base(wave.id)}/${encodeURIComponent(docId)}`,
    key: 'doc', conflictCode: 'DOC_CONFLICT', field: 'audience', event: 'cortex:table-doc-updated',
    matches: (d) => d.waveId === wave.id && d.docId === docId,
    open: (e, item) => openTableDoc(e, wave.id, item),
    seal: (e, data, { audience } = {}) => seal(e, wave, docId, kind, data, audience || DEFAULT_AUDIENCE[kind]),
  });
}

/**
 * Seal again with the GM key every GM-only document that isn't yet: ones made
 * before v2.162.0, or under a GM key version a departed GM held. Returns how
 * many were done.
 */
export async function resealGmDocs(fetchAPI, e2ee, wave, currentVersion) {
  const { docs } = await fetchAPI(base(wave.id));
  let n = 0;
  for (const d of docs || []) {
    if (d.audience !== 'gm' || (d.keyScope === 'gm' && d.keyVersion === currentVersion)) continue;
    try {
      const data = await openTableDoc(e2ee, wave.id, d);
      await fetchAPI(`${base(wave.id)}/${encodeURIComponent(d.id)}`, { method: 'PUT', body: { baseVersion: d.version, ...(await seal(e2ee, wave, d.id, d.kind, data, 'gm')) } });
      n++;
    } catch { /* tried again next time */ }
  }
  return n;
}

/**
 * Change a document without holding it open (v2.166.0, a token moved on a
 * map): apply `mutate` to the latest, and if someone wrote first, to theirs.
 * `audience` changes who reads it (GMs only). Returns the stored document.
 */
export async function updateTableDoc(fetchAPI, e2ee, wave, doc, mutate, { audience } = {}) {
  let current = doc;
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = await openTableDoc(e2ee, wave.id, current);
    mutate(data);
    const to = audience || current.audience;
    try {
      const res = await fetchAPI(`${base(wave.id)}/${encodeURIComponent(current.id)}`, {
        method: 'PUT', body: { baseVersion: current.version, ...(audience ? { audience } : {}), ...(await seal(e2ee, wave, current.id, current.kind, data, to)) },
      });
      return res.doc;
    } catch (err) {
      if (err.data?.code === 'DOC_CONFLICT' && err.data.doc) { current = err.data.doc; continue; }
      throw err;
    }
  }
  throw new Error('It kept changing; try again');
}
