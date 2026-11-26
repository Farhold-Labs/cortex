import { useCallback, useEffect, useRef, useState } from 'react';

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

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/**
 * One open sheet. `change(fn)` applies fn to a copy at once, and saves after a
 * short pause (text typing) or straight away (`{ now: true }`, for buttons).
 */
export function useSheet({ fetchAPI, e2ee, wave, sheetId }) {
  const [meta, setMeta] = useState(null);    // the stored sheet without its data
  const [data, setData] = useState(null);    // what's shown: the stored data with pending changes
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const stored = useRef(null);               // { meta, data } as last read or written
  const pending = useRef([]);
  const timer = useRef(null);
  const inFlight = useRef(null);
  const nextVisibility = useRef(null);       // only its owner changes who sees it
  const url = `${base(wave.id)}/${encodeURIComponent(sheetId)}`;
  // The e2ee value is a new object whenever its provider renders; read it late.
  const e2eeRef = useRef(e2ee);
  e2eeRef.current = e2ee;

  const show = useCallback(() => {
    if (!stored.current) return;
    let d = clone(stored.current.data);
    for (const fn of pending.current) { try { fn(d); } catch { /* a change that no longer applies */ } }
    setMeta(stored.current.meta); setData(d);
  }, []);

  const accept = useCallback(async (sheet) => {
    const parsed = await openSheet(e2eeRef.current, wave.id, sheet);
    const { data: _ignored, ...rest } = sheet;
    stored.current = { meta: rest, data: parsed };
  }, [wave.id]);

  const load = useCallback(async () => {
    if (inFlight.current || pending.current.length) return; // our save will meet the newer one
    try {
      const { sheet } = await fetchAPI(url);
      await accept(sheet);
      setError(null);
      show();
    } catch (err) {
      setError(err.locked ? 'locked' : (err.message || 'Could not load the sheet'));
    }
  }, [fetchAPI, url, accept, show]);

  useEffect(() => { stored.current = null; pending.current = []; setMeta(null); setData(null); load(); }, [sheetId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (e2ee?.isUnlocked && !stored.current) load(); }, [e2ee?.isUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onSheetUpdated(({ waveId, sheetId: changed }) => {
    if (waveId === wave.id && changed === sheetId) load();
  }), [wave.id, sheetId, load]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current); timer.current = null;
    if (inFlight.current) { await inFlight.current; if (!pending.current.length) return; }
    if (!pending.current.length || !stored.current) return;
    const run = (async () => {
      setSaving(true);
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          const batch = pending.current.slice();
          const next = clone(stored.current.data);
          for (const fn of batch) { try { fn(next); } catch { /* skip */ } }
          const visibility = nextVisibility.current;
          const body = { baseVersion: stored.current.meta.version, ...(visibility ? { visibility } : {}), ...(await seal(e2eeRef.current, wave, sheetId, next)) };
          try {
            const { sheet } = await fetchAPI(url, { method: 'PUT', body });
            const { data: _ignored, ...rest } = sheet;
            stored.current = { meta: rest, data: next };
            pending.current = pending.current.slice(batch.length);
            if (visibility && nextVisibility.current === visibility) nextVisibility.current = null;
            setError(null);
            return;
          } catch (err) {
            if (err.data?.code === 'SHEET_CONFLICT' && err.data.sheet) { await accept(err.data.sheet); continue; }
            throw err;
          }
        }
        throw new Error('The sheet kept changing; try again');
      } catch (err) {
        // A change that can't be saved is dropped, and the sheet shows what's stored.
        pending.current = [];
        nextVisibility.current = null;
        setError(err.message || 'Could not save the sheet');
        load();
      } finally {
        setSaving(false);
        show();
      }
    })();
    inFlight.current = run;
    try { await run; } finally { inFlight.current = null; }
    if (pending.current.length) flush();
  }, [wave, sheetId, fetchAPI, url, accept, show, load]);

  const change = useCallback((fn, { now = false, visibility = null } = {}) => {
    if (!stored.current) return;
    if (visibility) nextVisibility.current = visibility;
    pending.current.push(fn);
    show();
    clearTimeout(timer.current);
    if (now) flush(); else timer.current = setTimeout(flush, 700);
  }, [show, flush]);

  // Don't lose a change typed just before closing.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { if (pending.current.length) flushRef.current(); }, []);

  return { meta, data, error, saving, change, reload: load };
}
