// Dice rolls by id, for the roll cards in a wave (v2.158.0). Cards ask one at a
// time; requests within a few milliseconds go to the server together. What a
// card gets is what this reader may see, decided by the server.
//
// A table's GMs decide who sees what, so a change to the table empties that
// wave's cache and tells the cards to ask again.

const cache = new Map();      // `${waveId}:${id}` → Promise<roll|null>
const pending = new Map();    // waveId → { ids: Map(id → resolve), timer }
const listeners = new Set();

export function getRoll(fetchAPI, waveId, id) {
  const key = `${waveId}:${id}`;
  if (cache.has(key)) return cache.get(key);
  const promise = new Promise((resolve) => {
    let batch = pending.get(waveId);
    if (!batch) {
      batch = { ids: new Map(), timer: null };
      pending.set(waveId, batch);
      batch.timer = setTimeout(async () => {
        pending.delete(waveId);
        const ids = [...batch.ids.keys()];
        try {
          const data = await fetchAPI(`/waves/${encodeURIComponent(waveId)}/rolls?ids=${ids.map(encodeURIComponent).join(',')}`);
          const byId = new Map((data.rolls || []).map(r => [r.id, r]));
          for (const [rid, done] of batch.ids) done(byId.get(rid) || null);
        } catch {
          for (const [rid, done] of batch.ids) { cache.delete(`${waveId}:${rid}`); done(null); }
        }
      }, 15);
    }
    batch.ids.set(id, resolve);
  });
  cache.set(key, promise);
  return promise;
}

// A roll this device just made: no need to ask for it.
export function rememberRoll(roll) {
  if (roll?.id && roll?.waveId) cache.set(`${roll.waveId}:${roll.id}`, Promise.resolve(roll));
}

export function forgetWaveRolls(waveId) {
  for (const key of [...cache.keys()]) if (key.startsWith(`${waveId}:`)) cache.delete(key);
  for (const fn of listeners) fn(waveId);
}

export function onRollsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const VISIBILITY_LABELS = {
  public: 'Everyone',
  gm: 'GM and roller',
  gm_secret: 'GM secret',
};

export const SYSTEM_LABELS = {
  'dnd5e-2024': 'D&D 5e (2024 rules)',
  generic: 'Any system (generic)',
};
