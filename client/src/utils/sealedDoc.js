import { useCallback, useEffect, useRef, useState } from 'react';

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/**
 * One open document saved as a sealed blob with versioned writes: a sheet
 * (v2.159.0) or a GM's document (v2.160.0). `change(fn)` applies fn to a copy
 * at once, and saves after a short pause (text typing) or straight away
 * (`{ now: true }`, for buttons). If someone else wrote first, the server
 * refuses with theirs and the pending changes are applied again on top.
 * `{ [field]: value }` (a sheet's visibility, a document's audience) rides on
 * the next write.
 */
export function useSealedDoc({ fetchAPI, e2ee, id, url, key, conflictCode, field, event, matches, open, seal }) {
  const [meta, setMeta] = useState(null);    // the stored sheet without its data
  const [data, setData] = useState(null);    // what's shown: the stored data with pending changes
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const stored = useRef(null);               // { meta, data } as last read or written
  const pending = useRef([]);
  const timer = useRef(null);
  const inFlight = useRef(null);
  const nextField = useRef(null);
  // Callers pass new functions each render; read them late.
  const fns = useRef({ open, seal, matches });
  fns.current = { open, seal, matches };
  // The e2ee value is a new object whenever its provider renders; read it late.
  const e2eeRef = useRef(e2ee);
  e2eeRef.current = e2ee;

  const show = useCallback(() => {
    if (!stored.current) return;
    let d = clone(stored.current.data);
    for (const fn of pending.current) { try { fn(d); } catch { /* a change that no longer applies */ } }
    setMeta(stored.current.meta); setData(d);
  }, []);

  const accept = useCallback(async (item) => {
    const parsed = await fns.current.open(e2eeRef.current, item);
    const { data: _ignored, ...rest } = item;
    stored.current = { meta: rest, data: parsed };
  }, []);

  const load = useCallback(async () => {
    if (inFlight.current || pending.current.length) return; // our save will meet the newer one
    try {
      const body = await fetchAPI(url);
      await accept(body[key]);
      setError(null);
      show();
    } catch (err) {
      setError(err.locked ? 'locked' : (err.message || 'Could not load it'));
    }
  }, [fetchAPI, url, key, accept, show]);

  useEffect(() => { stored.current = null; pending.current = []; setMeta(null); setData(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (e2ee?.isUnlocked && !stored.current) load(); }, [e2ee?.isUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const listener = (e) => { if (fns.current.matches(e.detail || {})) load(); };
    window.addEventListener(event, listener);
    return () => window.removeEventListener(event, listener);
  }, [event, load]);

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
          const extra = nextField.current;
          const body = { baseVersion: stored.current.meta.version, ...(extra ? { [field]: extra } : {}), ...(await fns.current.seal(e2eeRef.current, next, { [field]: extra || stored.current.meta?.[field] })) };
          try {
            const res = await fetchAPI(url, { method: 'PUT', body });
            const { data: _ignored, ...rest } = res[key];
            stored.current = { meta: rest, data: next };
            pending.current = pending.current.slice(batch.length);
            if (extra && nextField.current === extra) nextField.current = null;
            setError(null);
            return;
          } catch (err) {
            if (err.data?.code === conflictCode && err.data[key]) { await accept(err.data[key]); continue; }
            throw err;
          }
        }
        throw new Error('It kept changing; try again');
      } catch (err) {
        // A change that can't be saved is dropped, and the sheet shows what's stored.
        pending.current = [];
        nextField.current = null;
        setError(err.message || 'Could not save');
        load();
      } finally {
        setSaving(false);
        show();
      }
    })();
    inFlight.current = run;
    try { await run; } finally { inFlight.current = null; }
    if (pending.current.length) flush();
  }, [fetchAPI, url, key, field, conflictCode, accept, show, load]);

  const change = useCallback((fn, { now = false, ...rest } = {}) => {
    if (!stored.current) return;
    if (field && rest[field]) nextField.current = rest[field];
    pending.current.push(fn);
    show();
    clearTimeout(timer.current);
    if (now) flush(); else timer.current = setTimeout(flush, 700);
  }, [show, flush, field]);

  // Don't lose a change typed just before closing.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { if (pending.current.length) flushRef.current(); }, []);

  return { meta, data, error, saving, change, reload: load };
}
