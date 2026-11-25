/**
 * Jellyfin and Plex access tokens at rest (v2.156.1).
 *
 * Until v2.156.1 these were XOR'd with the first 32 characters of JWT_SECRET.
 * That is not encryption: anyone holding the database and one token they
 * know (their own, from their own media server) recovers the key, and with it
 * every other person's token, and the first 32 characters of JWT_SECRET.
 *
 * Now: AES-256-GCM, with a key derived from JWT_SECRET by HKDF for this one
 * purpose, so the database alone reveals nothing and the derived key reveals
 * nothing about JWT_SECRET. No new environment variable: the tokens were
 * already tied to JWT_SECRET, and a new required key would stop a server
 * starting until someone added it.
 *
 * Stored form: "v2:" + base64(iv[12] | tag[16] | ciphertext).
 * Anything else is the old form, converted at boot (convertLegacy) and refused
 * at runtime: an unreadable token is never sent anywhere.
 */

import crypto from 'crypto';

const PREFIX = 'v2:';
const INFO = 'cortex-media-tokens-v1';

const keys = new Map();
function keyFor(secret) {
  if (typeof secret !== 'string' || !secret) throw new Error('JWT_SECRET is required for media tokens');
  if (!keys.has(secret)) {
    keys.set(secret, Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(INFO, 'utf8'), 32)));
  }
  return keys.get(secret);
}

export function isCurrent(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}

export function encryptMediaToken(token, secret) {
  if (!token) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

// The token, or null if it can't be read: old form, damaged, or written under
// another JWT_SECRET. Callers must not go on to use a null token.
export function decryptMediaToken(stored, secret) {
  if (!isCurrent(stored)) return null;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// The old XOR form, read only to convert it.
export function decryptLegacyToken(stored, secret) {
  if (!stored || isCurrent(stored)) return null;
  const key = String(secret).slice(0, 32).padEnd(32, '0');
  const bytes = Buffer.from(stored, 'base64').toString('binary');
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return out;
}

// Convert every old-form token in `rows` ([{ id, token }]) with `save(id, value)`.
// Returns { converted, unreadable }: a current-form token that won't decrypt
// (JWT_SECRET changed) is counted, never rewritten, and stays refused.
export function convertLegacy(rows, secret, save) {
  let converted = 0, unreadable = 0;
  for (const { id, token } of rows) {
    if (!token) continue;
    if (isCurrent(token)) {
      if (decryptMediaToken(token, secret) === null) unreadable++;
      continue;
    }
    const plain = decryptLegacyToken(token, secret);
    if (!plain) { unreadable++; continue; }
    save(id, encryptMediaToken(plain, secret));
    converted++;
  }
  return { converted, unreadable };
}
