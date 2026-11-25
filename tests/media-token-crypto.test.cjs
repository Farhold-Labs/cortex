'use strict';

// Jellyfin and Plex access tokens at rest (v2.156.1): AES-256-GCM with a key
// derived from JWT_SECRET, replacing an XOR with JWT_SECRET's first 32
// characters.
//
// [SECURITY] Counterfactual: with the old XOR form, someone holding the
// database and one token they know (their own) recovers another person's
// token. With the new form the same attack recovers nothing.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const SECRET = 'a-jwt-secret-that-is-long-enough-for-the-test-0123456789';

const xor = (token, secret) => {
  const key = secret.slice(0, 32).padEnd(32, '0');
  let out = '';
  for (let i = 0; i < token.length; i++) out += String.fromCharCode(token.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return Buffer.from(out, 'binary').toString('base64');
};
// The attack: XOR a stored value with a token you know, get the keystream,
// XOR another person's stored value with it.
const recover = (knownToken, knownStored, otherStored) => {
  const ks = Buffer.from(knownStored, 'base64'), other = Buffer.from(otherStored, 'base64');
  let out = '';
  for (let i = 0; i < other.length; i++) out += String.fromCharCode(other[i] ^ ks[i % ks.length] ^ knownToken.charCodeAt(i % knownToken.length));
  return out;
};

test('tokens round-trip; each encryption differs; the stored form says nothing', async () => {
  const m = await import('../server/lib/media-token-crypto.js');
  const a = m.encryptMediaToken('plex-token-ABCDEFGHIJKLMNOPQRSTUV', SECRET);
  const b = m.encryptMediaToken('plex-token-ABCDEFGHIJKLMNOPQRSTUV', SECRET);
  assert.ok(m.isCurrent(a));
  assert.notEqual(a, b);
  assert.equal(m.decryptMediaToken(a, SECRET), 'plex-token-ABCDEFGHIJKLMNOPQRSTUV');
  assert.doesNotMatch(Buffer.from(a.slice(3), 'base64').toString('binary'), /plex-token/);
});

test('an unreadable token is refused: wrong secret, tampered, or still in the old form', async () => {
  const m = await import('../server/lib/media-token-crypto.js');
  const stored = m.encryptMediaToken('jellyfin-token-0123456789abcdef', SECRET);
  assert.equal(m.decryptMediaToken(stored, SECRET + 'x'), null);
  const raw = Buffer.from(stored.slice(3), 'base64'); raw[raw.length - 1] ^= 1;
  assert.equal(m.decryptMediaToken('v2:' + raw.toString('base64'), SECRET), null);
  assert.equal(m.decryptMediaToken(xor('jellyfin-token-0123456789abcdef', SECRET), SECRET), null);
  assert.equal(m.decryptMediaToken('v2:', SECRET), null);
});

test('old-form tokens are converted; current ones are kept; unreadable ones are counted, never rewritten', async () => {
  const m = await import('../server/lib/media-token-crypto.js');
  const current = m.encryptMediaToken('already-current-token', SECRET);
  const foreign = m.encryptMediaToken('written-under-another-secret', SECRET + 'other');
  const rows = [{ id: 'old', token: xor('legacy-token-value', SECRET) }, { id: 'cur', token: current }, { id: 'lost', token: foreign }, { id: 'none', token: null }];
  const saved = {};
  const r = m.convertLegacy(rows, SECRET, (id, value) => { saved[id] = value; });
  assert.deepEqual(r, { converted: 1, unreadable: 1 });
  assert.deepEqual(Object.keys(saved), ['old']);
  assert.equal(m.decryptMediaToken(saved.old, SECRET), 'legacy-token-value');
});

test('[SECURITY] counterfactual: the old form gives up another person\'s token; the new one does not', async () => {
  const m = await import('../server/lib/media-token-crypto.js');
  const mine = 'my-own-plex-token-0123456789abcdef', theirs = 'someone-elses-token-zyxwvutsrqpon';
  // Old form: my token, my stored value and theirs are enough.
  assert.equal(recover(mine, xor(mine, SECRET), xor(theirs, SECRET)), theirs);
  // New form: the same attack yields nothing like their token.
  const myStored = Buffer.from(m.encryptMediaToken(mine, SECRET).slice(3), 'base64').toString('base64');
  const theirStored = Buffer.from(m.encryptMediaToken(theirs, SECRET).slice(3), 'base64').toString('base64');
  assert.notEqual(recover(mine, myStored, theirStored), theirs);
  assert.ok(!recover(mine, myStored, theirStored).includes('someone-elses'));
});
