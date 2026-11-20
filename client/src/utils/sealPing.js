import { T } from '../config/terminology.js';

/**
 * The body fields for a ping sent or edited in a wave (v2.143.0).
 *
 * Every place that sends or edits a ping goes through this. The focus view
 * and the thread panel each had their own send and edit, and neither
 * encrypted, so replies made there were stored as plain text inside
 * encrypted waves. The server now refuses plain text in an encrypted wave
 * (ENCRYPTION_REQUIRED), so a new path that skips this fails loudly instead.
 *
 * @param {object} e2ee   the useE2EE() value
 * @param {object} wave   anything with { id, encrypted }
 * @param {string} text   the message as typed
 * @returns {Promise<{content: string, encrypted?: true, nonce?: string, keyVersion?: number}>}
 */
export async function sealPing(e2ee, wave, text) {
  if (!wave?.encrypted) return { content: text };
  if (!e2ee?.isUnlocked) {
    throw new Error(`This ${T.wave} is end-to-end encrypted. Unlock encryption to send.`);
  }
  const { ciphertext, nonce, keyVersion } = await e2ee.encryptPing(text, wave.id);
  return { content: ciphertext, encrypted: true, nonce, keyVersion };
}
