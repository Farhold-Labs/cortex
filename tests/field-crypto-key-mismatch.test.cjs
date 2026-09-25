'use strict';

// A wrong field-encryption key must be loud, not empty (v2.105.5).
//
// The three field-level caches all loaded the same way: if the encrypted table
// has rows, read from it; otherwise fall back to the plaintext table. The
// unexamined assumption is that rows EXISTING means rows being READABLE.
//
// Rotate WAVE_PARTICIPATION_KEY, or restore a database onto a host whose .env
// holds different keys, and every row fails to decrypt while the loader reports
// `✅ Loaded 0 encrypted waves`. That happened on a real node: 40 unreadable
// rows, an empty cache, nobody able to see their waves, and a hundred buried
// console.error lines as the only evidence.
//
// It is not a security hole — the cache denies rather than permits. It is a
// silent total outage, which is harder to diagnose than a loud one. These tests
// pin the three properties that matter: it is detected, the node stays usable,
// and the recommended repair actually repairs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');

/** Fresh module instances, so module-level key constants are re-read. */
let seq = 0;
const freshParticipation = () =>
  import(`../server/lib/wave-participation-crypto.js?k=${++seq}`);

function seedUsers(db, ids) {
  const now = new Date().toISOString();
  const insert = db.db.prepare(
    `INSERT INTO users (id, handle, display_name, avatar, password_hash, role, created_at, last_seen, preferences)
     VALUES (?, ?, ?, '?', '', 'user', ?, ?, '{}')`
  );
  db.db.transaction(() => { for (const id of ids) insert.run(id, id, id, now, now); })();
}

test('a participation key that does not fit is reported, not silently obeyed', { timeout: 60000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-keymismatch-'));
  const previousKey = process.env.WAVE_PARTICIPATION_KEY;
  const dbPath = path.join(temp, 'rotated.db');
  const keyA = crypto.randomBytes(32).toString('hex');
  const keyB = crypto.randomBytes(32).toString('hex');
  let waveId;

  try {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');

    // --- written under key A ---
    process.env.WAVE_PARTICIPATION_KEY = keyA;
    {
      const part = await freshParticipation();
      const db = new DatabaseSQLite({ dbPath });
      seedUsers(db, ['owner', 'member', 'other']);
      const wave = db.createWave({ title: 'Written under key A', createdBy: 'owner', participants: ['member', 'other'] });
      waveId = wave.id;
      await part.initializeCache(db);
      part.addParticipant(waveId, 'member');
      part.addParticipant(waveId, 'other');

      assert.ok(db.db.prepare('SELECT COUNT(*) c FROM wave_participants_encrypted').get().c > 0,
        'precondition: something was actually encrypted');
      assert.ok(db.db.prepare('SELECT COUNT(*) c FROM wave_participants').get().c > 0,
        'precondition: plaintext is maintained alongside it — that is what makes recovery safe');
      db.db.close();
    }

    // --- the rotation: same database, different key ---
    process.env.WAVE_PARTICIPATION_KEY = keyB;

    await t.test('the failure is detected and does not masquerade as an empty cache', async () => {
      const part = await freshParticipation();
      const db = new DatabaseSQLite({ dbPath });
      const errors = [];
      const realError = console.error;
      console.error = (...a) => errors.push(a.join(' '));
      let stats;
      try { stats = await part.initializeCache(db); } finally { console.error = realError; }

      const shouted = errors.join('\n');
      assert.match(shouted, /CANNOT DECRYPT WAVE PARTICIPATION/,
        'the operator has to be told; before this it was a hundred nondescript lines');
      assert.match(shouted, /WAVE_PARTICIPATION_KEY/,
        'and told which key to look at');

      assert.ok(stats.participantCount > 0,
        'reporting 0 mappings as success is the bug: it is indistinguishable from "no data"');
      db.db.close();
    });

    await t.test('and the node stays usable, because plaintext is current', async () => {
      const part = await freshParticipation();
      const db = new DatabaseSQLite({ dbPath });
      const realError = console.error;
      console.error = () => {};
      try { await part.initializeCache(db); } finally { console.error = realError; }

      assert.equal(part.isParticipant(waveId, 'member'), true,
        'the outage was that nobody could see their waves');
      assert.equal(part.isParticipant(waveId, 'other'), true);
      assert.equal(part.isParticipant(waveId, 'nobody'), false,
        'and the fallback must not invent participants either');
      db.db.close();
    });

    await t.test('the repair the warning recommends actually repairs', async () => {
      const part = await freshParticipation();
      const db = new DatabaseSQLite({ dbPath });
      const realError = console.error;
      console.error = () => {};
      try { await part.initializeCache(db); } finally { console.error = realError; }

      const result = part.migrateToEncrypted();
      assert.equal(result.success, true, JSON.stringify(result));
      db.db.close();

      // A clean load now reads from the encrypted store with no complaint.
      const after = await freshParticipation();
      const db2 = new DatabaseSQLite({ dbPath });
      const errors = [];
      const realError2 = console.error;
      console.error = (...a) => errors.push(a.join(' '));
      let stats;
      try { stats = await after.initializeCache(db2); } finally { console.error = realError2; }

      assert.doesNotMatch(errors.join('\n'), /CANNOT DECRYPT/,
        'after re-encrypting under the current key there is nothing left to warn about');
      assert.ok(stats.participantCount > 0);
      assert.equal(after.isParticipant(waveId, 'member'), true);
      db2.db.close();
    });

    await t.test('the right key is still silent — no warning on a healthy node', async () => {
      // The control. A fix that shouted on every boot would be worse than the
      // bug, because the next real warning would be ignored.
      process.env.WAVE_PARTICIPATION_KEY = keyA;
      const fresh = path.join(temp, 'healthy.db');
      const part = await freshParticipation();
      const db = new DatabaseSQLite({ dbPath: fresh });
      seedUsers(db, ['a', 'b']);
      const wave = db.createWave({ title: 'Healthy', createdBy: 'a', participants: ['b'] });
      await part.initializeCache(db);
      part.addParticipant(wave.id, 'b');
      db.db.close();

      const again = await freshParticipation();
      const db2 = new DatabaseSQLite({ dbPath: fresh });
      const errors = [];
      const realError = console.error;
      console.error = (...a) => errors.push(a.join(' '));
      try { await again.initializeCache(db2); } finally { console.error = realError; }

      assert.doesNotMatch(errors.join('\n'), /CANNOT DECRYPT|could not be decrypted/,
        'a warning that fires when nothing is wrong trains people to ignore it');
      assert.equal(again.isParticipant(wave.id, 'b'), true);
      db2.db.close();
    });
  } finally {
    if (previousKey === undefined) delete process.env.WAVE_PARTICIPATION_KEY;
    else process.env.WAVE_PARTICIPATION_KEY = previousKey;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
