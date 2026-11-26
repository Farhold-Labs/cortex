import { useSealedDoc } from './sealedDoc.js';

/**
 * The GM's documents (v2.160.0, docs/ttrpg/README.md phase 3): encounters,
 * the GMs' half of an encounter, monster stat blocks and notes. Sealed under
 * the wave key in an encrypted wave like sheets, bound to the wave, the id and
 * the kind. The server decides who reads each (its audience) and lets only
 * GMs write.
 */

const base = (waveId) => `/waves/${encodeURIComponent(waveId)}/table-docs`;

export const newDocId = () => `doc-${crypto.randomUUID()}`;

async function seal(e2ee, wave, id, kind, data) {
  const text = JSON.stringify(data);
  if (!wave?.encrypted) return { data: text };
  if (!e2ee?.isUnlocked) throw new Error('Unlock encryption to change this in an encrypted wave');
  const sealed = await e2ee.encryptTableDoc(text, wave.id, id, kind);
  return { encrypted: true, data: sealed.data, nonce: sealed.nonce, keyVersion: sealed.keyVersion };
}

export async function openTableDoc(e2ee, waveId, doc) {
  if (!doc.encrypted) return JSON.parse(doc.data);
  if (!e2ee?.isUnlocked) throw Object.assign(new Error('Unlock encryption to read this'), { locked: true });
  return JSON.parse(await e2ee.decryptTableDoc(doc.data, doc.nonce, waveId, doc.id, doc.kind, doc.keyVersion));
}

/** Every document of a kind this person may read, opened; unreadable ones carry `error`. */
export async function listTableDocs(fetchAPI, e2ee, waveId, kind) {
  const { docs } = await fetchAPI(`${base(waveId)}?kind=${encodeURIComponent(kind)}`);
  return Promise.all((docs || []).map(async (d) => {
    try { return { ...d, body: await openTableDoc(e2ee, waveId, d) }; }
    catch (err) { return { ...d, body: null, error: err.locked ? 'locked' : 'unreadable' }; }
  }));
}

export async function createTableDoc(fetchAPI, e2ee, wave, { kind, audience, data, id = newDocId() }) {
  const body = { id, kind, ...(audience ? { audience } : {}), ...(await seal(e2ee, wave, id, kind, data)) };
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
    seal: (e, data) => seal(e, wave, docId, kind, data),
  });
}
