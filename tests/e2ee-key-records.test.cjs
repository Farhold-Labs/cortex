'use strict';

// The device side of phase 0 (v2.143.0): keys seen, and sealing every ping.
//
// keyRecords.js decides when a key is new, the same, or changed, and how two
// devices' records merge. sealPing.js is the one way a ping's body is made;
// the focus view and thread panel sent plain text because each had its own.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const load = (rel) => import(path.join(root, 'client/src/utils', rel));

test('a key is new, the same, or changed; a change stays flagged until seen', async () => {
  const { emptyKeyRecords, noteKey, acknowledgeKeyChange, unacknowledgedChanges } = await load('keyRecords.js');
  let r = emptyKeyRecords();

  let out = noteKey(r, 'zoe', 'K1', '2026-11-20T10:00:00Z');
  assert.equal(out.status, 'new');
  r = out.records;
  assert.deepEqual(unacknowledgedChanges(r), [], 'a first sighting is not a change');

  out = noteKey(r, 'zoe', 'K1');
  assert.equal(out.status, 'same');
  assert.equal(out.records, r, 'nothing to save');

  out = noteKey(r, 'zoe', 'K2', '2026-11-21T10:00:00Z');
  assert.equal(out.status, 'changed');
  r = out.records;
  assert.equal(r.people.zoe.key, 'K2');
  assert.equal(r.people.zoe.previousKey, 'K1');
  assert.equal(r.people.zoe.seenAt, '2026-11-20T10:00:00Z', 'first seen is kept');
  assert.deepEqual(unacknowledgedChanges(r), [{ personId: 'zoe', changedAt: '2026-11-21T10:00:00Z' }]);

  r = acknowledgeKeyChange(r, 'zoe');
  assert.deepEqual(unacknowledgedChanges(r), []);
  assert.equal(noteKey(r, 'zoe', 'K2').status, 'same', 'the new key is now the one on record');
});

test('two devices saving at once keep both, and a dismissed flag stays dismissed', async () => {
  const { emptyKeyRecords, noteKey, acknowledgeKeyChange, mergeKeyRecords, unacknowledgedChanges } = await load('keyRecords.js');
  const start = noteKey(noteKey(emptyKeyRecords(), 'zoe', 'K1', 't1').records, 'wash', 'W1', 't1').records;
  const changed = noteKey(start, 'zoe', 'K2', 't2').records;

  // Phone dismissed the flag; laptop learned about kaylee meanwhile.
  const phone = acknowledgeKeyChange(changed, 'zoe');
  const laptop = noteKey(changed, 'kaylee', 'Y1', 't3').records;
  const merged = mergeKeyRecords(laptop, phone);
  assert.deepEqual(Object.keys(merged.people).sort(), ['kaylee', 'wash', 'zoe']);
  assert.equal(merged.people.zoe.key, 'K2');
  assert.deepEqual(unacknowledgedChanges(merged), [], 'dismissed on one device is dismissed');

  // Different keys: the later sighting wins and stays flagged.
  const older = noteKey(start, 'zoe', 'K1', 't1').records;
  const newer = noteKey(start, 'zoe', 'K3', 't4').records;
  assert.equal(mergeKeyRecords(older, newer).people.zoe.key, 'K3');
  assert.equal(mergeKeyRecords(newer, older).people.zoe.key, 'K3');
  assert.equal(mergeKeyRecords(newer, older).people.zoe.unacknowledged, true);
});

test('sealPing: plain only where the wave is not encrypted, never while locked', async () => {
  const { sealPing } = await load('sealPing.js');
  const calls = [];
  const unlocked = { isUnlocked: true, encryptPing: async (text, waveId) => { calls.push([text, waveId]); return { ciphertext: 'CT', nonce: 'N', keyVersion: 3 }; } };

  assert.deepEqual(await sealPing(unlocked, { id: 'w', encrypted: false }, 'hi'), { content: 'hi' });
  assert.deepEqual(await sealPing(unlocked, { id: 'w', encrypted: true }, 'hi'), { content: 'CT', encrypted: true, nonce: 'N', keyVersion: 3 });
  assert.deepEqual(calls, [['hi', 'w']]);
  await assert.rejects(sealPing({ isUnlocked: false }, { id: 'w', encrypted: true }, 'hi'), /Unlock encryption/);
});
