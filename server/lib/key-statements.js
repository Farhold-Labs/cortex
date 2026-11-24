// Key statements (v2.150.0, docs/federated-e2ee/02-identity-keys.md).
//
// A person's identity key signs a statement naming their current encryption
// and signing keys. The server checks every statement before storing it, so a
// broken or hostile client can't leave a bad one for others to trip over; the
// devices that read it check it again, because the server is the party the
// signature protects them from.
//
// The bytes must match client/crypto.js keyStatementBytes() exactly:
//   "cortex-keys-v1" ‖ user id ‖ seq ‖ encryption key ‖ signing key ‖ issuedAt
// with ‖ one 0x00 byte, and keys as base64 SPKI.

import crypto from 'crypto';

export const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function sealContext(label, ...fields) {
  for (const f of [label, ...fields]) {
    if (f === null || f === undefined || String(f).includes('\u0000')) throw new Error('Invalid seal context');
  }
  return Buffer.from([label, ...fields.map(String)].join('\u0000'), 'utf8');
}

export function statementBytes({ userId, seq, encryptionKey, signingKey, issuedAt }) {
  if (!Number.isInteger(seq) || seq < 1) throw new Error('Invalid seal context');
  return sealContext('cortex-keys-v1', userId, seq, encryptionKey, signingKey, issuedAt);
}

/** The proof that whoever asks to rewrap an identity holds it. */
export function rewrapBytes({ userId, wrappedIdentity, identitySalt }) {
  return sealContext('cortex-identity-rewrap-v1', userId, wrappedIdentity, identitySalt);
}

/** A base64 SPKI P-384 public key as a KeyObject, or null. (ECDH and ECDSA keys share one SPKI form.) */
export function p384Key(spkiBase64) {
  if (typeof spkiBase64 !== 'string' || spkiBase64.length > 400 || !BASE64.test(spkiBase64)) return null;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'secp384r1') return null;
    return key;
  } catch {
    return null;
  }
}

/** ECDSA P-384 / SHA-384 over `bytes`, signature as WebCrypto gives it (r‖s, 96 bytes). */
export function verifySignature(spkiBase64, bytes, signatureBase64) {
  const key = p384Key(spkiBase64);
  if (!key || typeof signatureBase64 !== 'string' || !BASE64.test(signatureBase64)) return false;
  const sig = Buffer.from(signatureBase64, 'base64');
  if (sig.length !== 96) return false;
  try {
    return crypto.verify('sha384', bytes, { key, dsaEncoding: 'ieee-p1363' }, sig);
  } catch {
    return false;
  }
}

export function verifyStatement(identityKey, fields, signature) {
  let bytes;
  try { bytes = statementBytes(fields); } catch { return false; }
  return verifySignature(identityKey, bytes, signature);
}

export function isIsoTime(s) {
  return typeof s === 'string' && s.length <= 40 && Number.isFinite(Date.parse(s));
}

