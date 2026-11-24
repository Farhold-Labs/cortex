// A wave id handed out before the wave exists (v2.153.1).
//
// An encrypted wave's keys are bound to its id (format 2), so the creator's
// device needs the id before it wraps them, and the wave and its keys are
// still made in one request. The server picks the id and signs it for the
// person who asked: a client can't choose an id (say, a deleted wave's, whose
// leftover rows would then belong to the new one) or use someone else's.
// Nothing is stored; using an id twice fails on the wave's primary key.

import crypto from 'node:crypto';

export const WAVE_ID_RESERVATION_TTL_MS = 10 * 60 * 1000;
const ID_PATTERN = /^wave-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function mac(secret, waveId, userId, expires) {
  return crypto.createHmac('sha256', secret)
    .update(`cortex-wave-id-v1\0${waveId}\0${userId}\0${expires}`)
    .digest('base64url');
}

/** A new id, and the reservation that lets `userId` create a wave under it. */
export function reserveWaveId(secret, userId, now = Date.now()) {
  const waveId = `wave-${crypto.randomUUID()}`;
  const expires = now + WAVE_ID_RESERVATION_TTL_MS;
  return { waveId, reservation: `${expires}.${mac(secret, waveId, userId, expires)}`, expiresAt: new Date(expires).toISOString() };
}

/** True only for an id this server reserved for `userId`, not yet expired. */
export function checkWaveIdReservation(secret, waveId, userId, reservation, now = Date.now()) {
  if (typeof waveId !== 'string' || !ID_PATTERN.test(waveId)) return false;
  if (typeof reservation !== 'string') return false;
  const [expiresText, given, extra] = reservation.split('.');
  if (extra !== undefined || !/^\d{1,16}$/.test(expiresText || '') || !given) return false;
  const expires = Number(expiresText);
  if (expires < now) return false;
  const want = Buffer.from(mac(secret, waveId, userId, expires));
  const got = Buffer.from(given);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
