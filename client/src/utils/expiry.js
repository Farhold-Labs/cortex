/**
 * Expiring pings (v2.122.0).
 *
 * The timers on offer match the server's list (PING_TTLS in server.js). A
 * wave's timer is a ceiling: everything sent there gets it, and a sender may
 * pick a shorter one but never a longer one or none.
 */

export const PING_TTLS = [
  { seconds: 300, short: '5m', long: '5 minutes' },
  { seconds: 3600, short: '1h', long: '1 hour' },
  { seconds: 28800, short: '8h', long: '8 hours' },
  { seconds: 86400, short: '1d', long: '1 day' },
  { seconds: 604800, short: '1w', long: '1 week' },
  { seconds: 2419200, short: '4w', long: '4 weeks' },
];

export function ttlLabel(seconds, form = 'long') {
  const preset = PING_TTLS.find(p => p.seconds === seconds);
  return preset ? preset[form] : null;
}

/** The timers a sender may choose in a wave whose own timer is `waveTtl`. */
export function ttlChoices(waveTtl) {
  return waveTtl ? PING_TTLS.filter(p => p.seconds <= waveTtl) : PING_TTLS;
}

/** What a ping sent now will actually get: the shorter of the two. */
export function effectiveTtl(chosen, waveTtl) {
  if (chosen && waveTtl) return Math.min(chosen, waveTtl);
  return chosen || waveTtl || null;
}

/** Time left, compactly: "45s", "12m", "3h", "2d". Null once it has passed. */
export function timeLeft(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt) - now;
  if (!(ms > 0)) return null;
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function hasExpired(ping, now = Date.now()) {
  return !!ping?.expired || (!!ping?.expiresAt && !ping?.deleted && Date.parse(ping.expiresAt) <= now);
}

/**
 * The same ping as the server will show it once erased. Used when a client's
 * own timer reaches the expiry before the server's sweep has said so.
 */
export function asExpired(ping) {
  return {
    ...ping,
    content: '', deleted: true, expired: true, reactions: {}, readBy: [],
    media_type: null, media_url: null, media_duration: null, event_id: null,
    pinned_at: null, pinned_by: null, is_unread: false,
  };
}

/** The soonest expiry still to come among loaded pings, as epoch ms, or null. */
export function nextExpiry(pings) {
  let next = Infinity;
  for (const p of pings || []) {
    if (p.expiresAt && !p.deleted) next = Math.min(next, Date.parse(p.expiresAt));
  }
  return Number.isFinite(next) ? next : null;
}

/**
 * Wave data with every ping whose time has come shown as expired — the flat
 * list and the reply tree both — or the same object if nothing was due.
 */
export function expireDue(waveData, now = Date.now()) {
  if (!waveData?.all_messages) return waveData;
  let changed = false;
  const fix = (p) => {
    if (!hasExpired(p, now) || p.expired) return p;
    changed = true;
    return asExpired(p);
  };
  const walk = (nodes) => (nodes || []).map(n => {
    const fixed = fix(n);
    return n.children ? { ...fixed, children: walk(n.children) } : fixed;
  });
  const all = waveData.all_messages.map(fix);
  if (!changed) return waveData;
  return { ...waveData, all_messages: all, messages: walk(waveData.messages) };
}
