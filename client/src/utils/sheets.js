import { useSealedDoc } from './sealedDoc.js';

/**
 * Character sheets (v2.159.0, docs/ttrpg/README.md phase 2).
 *
 * A sheet is one blob: JSON in a plain wave, sealed under the wave key in an
 * encrypted one (e2ee.encryptSheet, bound to the wave and the sheet's id).
 * The server can't merge what it can't read, so every change is a function
 * applied to the latest sheet: a write names the version it started from, and
 * if someone else wrote first the server says so, sends theirs, and the
 * pending changes are applied again on top. Two people changing HP at once
 * both count.
 */

const base = (waveId) => `/waves/${encodeURIComponent(waveId)}/sheets`;

export const newSheetId = () => `sheet-${crypto.randomUUID()}`;

async function seal(e2ee, wave, sheetId, data) {
  const text = JSON.stringify(data);
  if (!wave?.encrypted) return { data: text };
  if (!e2ee?.isUnlocked) throw new Error('Unlock encryption to change sheets in this wave');
  const sealed = await e2ee.encryptSheet(text, wave.id, sheetId);
  return { encrypted: true, data: sealed.data, nonce: sealed.nonce, keyVersion: sealed.keyVersion };
}

export async function openSheet(e2ee, waveId, sheet) {
  if (!sheet.encrypted) return JSON.parse(sheet.data);
  if (!e2ee?.isUnlocked) throw Object.assign(new Error('Unlock encryption to read this sheet'), { locked: true });
  return JSON.parse(await e2ee.decryptSheet(sheet.data, sheet.nonce, waveId, sheet.id, sheet.keyVersion));
}

export async function listSheets(fetchAPI, waveId) {
  const { sheets } = await fetchAPI(base(waveId));
  return sheets || [];
}

export async function createSheet(fetchAPI, e2ee, wave, { system, visibility, data }) {
  const id = newSheetId();
  const body = { id, system, visibility, ...(await seal(e2ee, wave, id, data)) };
  const { sheet } = await fetchAPI(base(wave.id), { method: 'POST', body });
  return sheet;
}

export async function deleteSheet(fetchAPI, waveId, sheetId) {
  await fetchAPI(`${base(waveId)}/${encodeURIComponent(sheetId)}`, { method: 'DELETE' });
}

/** Only the id comes over the socket; the sheet is read again. */
export function onSheetUpdated(handler) {
  const listener = (e) => handler(e.detail || {});
  window.addEventListener('cortex:sheet-updated', listener);
  return () => window.removeEventListener('cortex:sheet-updated', listener);
}

/** One open sheet: see useSealedDoc. `change(fn, { visibility })` also changes who sees it (its owner only). */
export function useSheet({ fetchAPI, e2ee, wave, sheetId }) {
  return useSealedDoc({
    fetchAPI, e2ee, id: sheetId,
    url: `${base(wave.id)}/${encodeURIComponent(sheetId)}`,
    key: 'sheet', conflictCode: 'SHEET_CONFLICT', field: 'visibility', event: 'cortex:sheet-updated',
    matches: (d) => d.waveId === wave.id && d.sheetId === sheetId,
    open: (e, item) => openSheet(e, wave.id, item),
    seal: (e, data) => seal(e, wave, sheetId, data),
  });
}
