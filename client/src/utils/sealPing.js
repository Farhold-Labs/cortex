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
 * @returns {Promise<{content: string, encrypted?: true, nonce?: string, keyVersion?: number, format?: 2}>}
 */
export async function sealPing(e2ee, wave, text) {
  if (!wave?.encrypted) return { content: text };
  if (!e2ee?.isUnlocked) {
    throw new Error(`This ${T.wave} is end-to-end encrypted. Unlock encryption to send.`);
  }
  const { ciphertext, nonce, keyVersion, format } = await e2ee.encryptPing(text, wave.id);
  // v2.151.0: format 2 when the device signed it.
  return { content: ciphertext, encrypted: true, nonce, keyVersion, ...(format ? { format } : {}) };
}

/**
 * What decryptPing needs to know about a ping besides its key (v2.149.0):
 * its format, and for format 2 its author, which the seal is bound to, and
 * its id, under which what's known about its signature is kept (v2.151.0).
 */
export function pingSeal(ping) {
  return { format: ping?.format || 1, authorId: ping?.authorId || ping?.author_id || null, pingId: ping?.id || null };
}
