/**
 * Crawl Provider Secret Encryption (v2.80.0)
 *
 * The crawl bar's third-party API keys (weather, stocks, news) moved out of
 * `.env` and into the database so an admin can configure them without shell
 * access. They are secrets, so they are encrypted at rest with AES-256-GCM —
 * the same posture as emails, wave participation and push subscriptions. A
 * leaked database backup must not leak the operator's billable API keys.
 *
 * Key management:
 * - CRAWL_SECRET_KEY environment variable (32-byte hex)
 * - Without it, keys are NOT written to the database at all; the instance keeps
 *   reading them from the environment. Storing secrets in plaintext would be a
 *   silent downgrade of the very property this module exists to provide, so it
 *   refuses rather than degrading.
 */

import crypto from 'crypto';

const SECRET_KEY = process.env.CRAWL_SECRET_KEY || null;

export function isEnabled() {
  return !!SECRET_KEY;
}

/** Why storage is unavailable, for surfacing in the admin UI. */
export function unavailableReason() {
  return SECRET_KEY
    ? null
    : 'CRAWL_SECRET_KEY is not set on this server, so API keys cannot be stored securely. Generate one with `openssl rand -hex 32` and add it to server/.env.';
}

/**
 * Encrypt the provider-key map.
 * @param {Object} keys - { finnhub: '...', openweathermap: '...' }
 * @returns {{blob: string, iv: string}|null}
 */
export function encryptSecrets(keys) {
  if (!SECRET_KEY) return null;
  try {
    const key = Buffer.from(SECRET_KEY, 'hex');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(JSON.stringify(keys), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();
    const combined = Buffer.concat([Buffer.from(encrypted, 'base64'), authTag]).toString('base64');
    return { blob: combined, iv: iv.toString('base64') };
  } catch (err) {
    console.error('Crawl secret encryption error:', err.message);
    return null;
  }
}

/**
 * @returns {Object|null} the provider-key map, or null if unreadable
 */
export function decryptSecrets(blob, iv) {
  if (!SECRET_KEY || !blob || !iv) return null;
  try {
    const key = Buffer.from(SECRET_KEY, 'hex');
    const combined = Buffer.from(blob, 'base64');
    const authTag = combined.slice(-16);
    const ciphertext = combined.slice(0, -16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (err) {
    // A changed or lost CRAWL_SECRET_KEY lands here. Say so loudly: the symptom
    // otherwise is a crawl bar that quietly stops showing weather.
    console.error('⚠️  Crawl secret decryption failed — CRAWL_SECRET_KEY may have changed:', err.message);
    return null;
  }
}

/** Never send a secret to a browser. Enough to recognise a key, not to use it. */
export function maskSecret(value) {
  if (!value) return null;
  const s = String(value);
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}
