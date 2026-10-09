// File uploads with progress, shared by every upload in the app (v2.111.0).
//
// `fetch` cannot report upload progress, so on a slow connection a picture or
// a recording sat behind a "uploading…" toast for a minute with nothing
// moving — and people refreshed the page, which silently threw the upload
// away. Everything now goes through `uploadFile`, which:
//
//   - reports bytes sent (XMLHttpRequest's upload.onprogress) to a small
//     store that <UploadProgress> renders as an uploading screen;
//   - asks the browser to confirm before the page is closed, refreshed or
//     navigated away from while anything is still uploading;
//   - can be cancelled;
//   - refreshes the access token first if it is about to expire, and retries
//     once on TOKEN_EXPIRED, because a slow upload can outlive an hour-long token.

import { API_URL } from '../config/constants.js';
import { storage, getTokenExpiry } from './storage.js';
import { refreshAccessToken } from './sessionRefresh.js';

const uploads = new Map(); // id -> { id, label, loaded, total, phase, startedAt, cancel }
const listeners = new Set();
let snapshot = [];
let seq = 0;

// ---- Getting a finished upload to the right message box ----
//
// "Keep browsing" means the person may be somewhere else entirely when an
// upload finishes. The app reuses one wave view for every wave, so inserting
// into "the composer" would drop a picture into whichever wave happened to be
// open — where its members could not even load it, since the file is bound to
// the wave it was uploaded for — or lose it when no wave was open. Instead
// each upload names its target (wave + which composer: the wave's own, a
// thread's, a focused ping's), and is held here until that composer is
// mounted. If that exact composer is gone (a thread panel since closed), the
// wave's main composer takes it.
const pending = []; // { id, waveId, surface, text, kind, label, waveTitle }
const composers = new Map(); // token -> { waveId, surface, insert }
let waitingSnapshot = [];
const dismissed = new Set();
let composerSeq = 0;

let retryTimer = null;
function flushPending() {
  let notReady = false;
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    const all = [...composers.values()].filter(c => c.waveId === item.waveId);
    const target = all.find(c => c.surface === item.surface) || all.find(c => c.surface === 'wave');
    if (!target) continue;
    // A host can be registered while its composer is not on screen yet (a
    // wave view shows a spinner while it loads, then mounts a fresh, empty
    // composer). It returns false then; keep the upload and try again shortly,
    // or the picture lands in a composer that is about to be thrown away.
    let ok = false;
    try { ok = target.insert(item.text, item) !== false; } catch (err) { console.error('[uploads] insert failed:', err); }
    if (ok) pending.splice(i--, 1);
    else notReady = true;
  }
  if (notReady && !retryTimer) {
    retryTimer = setTimeout(() => { retryTimer = null; flushPending(); emit(); }, 400);
  }
  waitingSnapshot = pending.filter(p => !dismissed.has(p.id)).map(({ id, label, waveTitle, kind }) => ({ id, label, waveTitle, kind }));
}

/**
 * A composer that can receive finished uploads. `surface` is 'wave' for a
 * wave's own message box, or e.g. `thread:<rootId>` / `focus:<pingId>`.
 * `insert(text, item)` appends to it, returning false if its composer is not
 * mounted yet. Returns an unregister function.
 */
export function registerUploadTarget(waveId, surface, insert) {
  if (!waveId) return () => {};
  const token = ++composerSeq;
  composers.set(token, { waveId, surface, insert });
  // Deliver anything that was waiting for this composer — after the current
  // render, so the composer's ref is attached.
  setTimeout(() => { flushPending(); emit(); }, 0);
  return () => composers.delete(token);
}

/** Hand a finished upload's text (a URL or file marker) to its composer, now or when it next opens. */
export function deliverUpload({ waveId, surface = 'wave', text, kind = 'file', label = '', waveTitle = '' }) {
  const item = { id: ++seq, waveId, surface, text, kind, label, waveTitle };
  pending.push(item);
  flushPending();
  // Not delivered on the spot: the person had moved on. Whoever receives it
  // later says so, rather than the usual "uploaded".
  if (pending.includes(item)) item.deferred = true;
  emit();
}

/** Finished uploads still waiting for their wave to be opened. */
export function getWaitingSnapshot() { return waitingSnapshot; }
export function dismissWaiting(id) {
  // Only the notice goes; the upload still waits for its wave.
  dismissed.add(id);
  waitingSnapshot = waitingSnapshot.filter(w => w.id !== id);
  listeners.forEach(l => l());
}

function emit() {
  snapshot = [...uploads.values()].map(({ cancel, xhr, ...u }) => u);
  listeners.forEach(l => l());
  syncUnloadGuard();
}

/** For useSyncExternalStore. */
export function subscribeUploads(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getUploadsSnapshot() { return snapshot; }
export function hasActiveUploads() { return uploads.size > 0; }
export function cancelUpload(id) { uploads.get(id)?.cancel(); }

// ---- Leaving the page mid-upload ----
// Browsers show their own generic wording; a custom message is ignored. The
// uploading screen says the specific thing ("refreshing cancels it").
function onBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = '';
  return '';
}
let guarded = false;
function syncUnloadGuard() {
  const want = uploads.size > 0;
  if (want === guarded) return;
  guarded = want;
  if (want) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}

/** Ask before an in-app reload (the update banner, etc.) would cancel an upload. */
export function confirmLeaveDuringUpload() {
  if (!hasActiveUploads()) return true;
  return window.confirm('A file is still uploading. Reloading now will cancel it. Reload anyway?');
}

async function freshToken() {
  const token = storage.getToken();
  const exp = token ? getTokenExpiry(token) : null;
  // Expiring within five minutes: rotate before sending a body that may take that long.
  if (exp && exp - Date.now() < 5 * 60 * 1000) {
    const next = await refreshAccessToken();
    if (next) return next;
  }
  return token;
}

function send(entry, path, formData, token) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    entry.xhr = xhr;
    xhr.open('POST', `${API_URL}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      entry.loaded = e.loaded;
      entry.total = e.total;
      emit();
    };
    // Every byte has left; the server may still be working (videos are transcoded).
    xhr.upload.onload = () => { entry.phase = 'processing'; entry.loaded = entry.total; emit(); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      resolve({ status: xhr.status, data, text: xhr.responseText });
    };
    xhr.onerror = () => reject(Object.assign(new Error('Upload failed — check your connection and try again'), { network: true }));
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { cancelled: true }));
    xhr.send(formData);
  });
}

/**
 * Upload `formData` to `path` (relative to the API, e.g. '/uploads').
 * Resolves with the parsed JSON response; rejects with an Error whose message
 * is the server's, or `{ cancelled: true }` if the person cancelled.
 *
 * `label` names the file on the uploading screen; `size` (bytes) lets it show
 * a total before the first progress event arrives.
 */
export async function uploadFile(path, formData, { label = 'File', size = 0 } = {}) {
  const id = ++seq;
  const entry = { id, label, loaded: 0, total: size, phase: 'uploading', startedAt: Date.now(), xhr: null, cancelled: false };
  entry.cancel = () => { entry.cancelled = true; entry.xhr?.abort(); };
  uploads.set(id, entry);
  emit();
  try {
    let res = await send(entry, path, formData, await freshToken());
    if (res.status === 401 && res.data?.code === 'TOKEN_EXPIRED' && !entry.cancelled) {
      const next = await refreshAccessToken();
      if (next) {
        entry.loaded = 0; entry.phase = 'uploading'; emit();
        res = await send(entry, path, formData, next);
      }
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(res.data?.error || (res.text && res.text.length < 200 ? res.text : '') || `Upload failed (${res.status})`);
    }
    return res.data;
  } finally {
    uploads.delete(id);
    emit();
  }
}
