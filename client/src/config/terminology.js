// Instance terminology (v2.82.0)
//
// The Firefly vocabulary is Cortex's identity, but it is a barrier for
// communities that just want a message board. The nouns are therefore an
// INSTANCE setting: everyone on a node reads the same words, so support,
// documentation and email all agree. (A per-user setting was considered and
// rejected — "click Waves" is meaningless to someone whose UI says Messages.)
//
// Only { one, many } is configured per term. Every other form is derived here,
// so an admin cannot get the capitalised variants out of sync.

export const TERM_KEYS = ['wave', 'ping', 'crew', 'thread'];

export const TERM_PRESETS = {
  firefly: {
    wave: { one: 'wave', many: 'waves' },
    ping: { one: 'ping', many: 'pings' },
    crew: { one: 'crew', many: 'crews' },
    thread: { one: 'thread', many: 'threads' },
  },
  standard: {
    wave: { one: 'message', many: 'messages' },
    ping: { one: 'comment', many: 'comments' },
    crew: { one: 'group', many: 'groups' },
    thread: { one: 'thread', many: 'threads' },
  },
};

export const PRESET_LABELS = { firefly: 'Firefly (default)', standard: 'Standard' };

const CACHE_KEY = 'farhold_terminology';

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Expand { wave: {one, many}, ... } into every form the UI needs:
 * T.wave / T.waves / T.Wave / T.Waves / T.WAVE / T.WAVES
 */
export function buildTerms(resolved) {
  const terms = (resolved && resolved.terms) || TERM_PRESETS.firefly;
  const out = { __preset: (resolved && resolved.preset) || 'firefly' };
  for (const key of TERM_KEYS) {
    const entry = terms[key] || TERM_PRESETS.firefly[key];
    const one = entry.one || TERM_PRESETS.firefly[key].one;
    const many = entry.many || TERM_PRESETS.firefly[key].many;
    out[key] = one;
    out[key + 's'] = many;                       // T.waves — reads naturally at call sites
    out[titleCase(key)] = titleCase(one);        // T.Wave
    out[titleCase(key) + 's'] = titleCase(many); // T.Waves
    out[key.toUpperCase()] = one.toUpperCase();  // T.WAVE  (nav labels, buttons)
    out[key.toUpperCase() + 'S'] = many.toUpperCase();
  }
  return out;
}

// Hydrate synchronously from cache at import time. Without this the UI paints
// the default vocabulary and then swaps it a moment later, which reads as a
// glitch on every single load.
function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) return buildTerms(JSON.parse(raw));
  } catch { /* corrupt cache is not worth failing a boot over */ }
  return buildTerms(null);
}

let current = readCache();
const listeners = new Set();

export function getTerms() { return current; }

export function setTerminology(resolved) {
  const next = buildTerms(resolved);
  // Reference equality drives useSyncExternalStore; only publish real changes.
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(resolved)); } catch { /* private mode */ }
  listeners.forEach((fn) => fn());
}

export function subscribeTerms(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Always-current vocabulary, usable anywhere — render paths, event handlers,
 * toast text, thrown errors. Reads through to the live store on every access:
 *
 *   `Failed to load ${T.wave}`
 *
 * Components that must re-render when an admin changes the vocabulary mid-
 * session should use the useTerms() hook instead. Everything else can use this
 * and pick the change up on the next load, which is what actually happens —
 * terminology is an instance setting that changes approximately never.
 */
export const T = new Proxy({}, {
  get: (_t, key) => getTerms()[key],
  has: (_t, key) => key in getTerms(),
  ownKeys: () => Reflect.ownKeys(getTerms()),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});
