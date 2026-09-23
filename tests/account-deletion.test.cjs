'use strict';

// Deleting an account has to actually delete the account (v2.105.1).
//
// `deleteUserAccount` ran with `PRAGMA foreign_keys = OFF` so that its manual
// cleanup could proceed in whatever order it liked. The price was that every
// `ON DELETE CASCADE` in the schema became advisory: the cleanup list had to
// name each table by hand, it was written once and never revisited, and by the
// time anyone looked it was missing most of them.
//
// What survived a deletion included the account's encrypted E2EE private key,
// its recovery blob, its known devices and its stored Plex credentials. Two
// such rows were found in production, belonging to someone who had deleted
// their account months earlier.
//
// Foreign keys are now enforced, so the database performs its own cascades and
// refuses the delete outright if anything is still pointing at the row. The
// test that matters is the last one: nothing, anywhere, still names them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');

/** A user with a row in as much of the schema as one account can reach. */
async function populated(temp) {
  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const db = new DatabaseSQLite({ dbPath: path.join(temp, `${Math.random().toString(36).slice(2)}.db`) });
  const now = new Date().toISOString();

  for (const id of ['victim', 'friend']) {
    db.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: 'x', displayName: id });
  }

  // Conversations: one they own, one they are merely in.
  const own = db.createWave({ title: 'Theirs', createdBy: 'victim', participants: ['friend'] });
  const shared = db.createWave({ title: 'Someone else\'s', createdBy: 'friend', participants: ['victim'] });
  const ping = db.createPing({ waveId: shared.id, authorId: 'victim', content: 'something they said' });

  // The material that must not survive them.
  db.createUserEncryptionKeys('victim', 'PUBLIC', 'ENCRYPTED-PRIVATE-KEY', 'salt');
  db.createRecoveryKey('victim', 'RECOVERY-BLOB', 'recovery-salt', 'hint');
  db.createPlexConnection({
    userId: 'victim', serverUrl: 'https://upstream.example', accessToken: 'ENCRYPTED-UPSTREAM-CREDENTIAL',
    plexUserId: 'up-1', serverName: 'Theirs', machineIdentifier: 'mach-1',
  });

  // Everything else that names them, seeded directly where there is no helper.
  const raw = [
    [`INSERT INTO known_devices (id, user_id, device_hash, first_seen, last_seen) VALUES ('kd','victim','hash',?,?)`, [now, now]],
    [`INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, created_at, expires_at) VALUES ('rt','victim','fam','hash',?,?)`, [now, now]],
    [`INSERT INTO wave_mutes (wave_id, user_id, muted_at) VALUES (?,'victim',?)`, [shared.id, now]],
    [`INSERT INTO calendar_feed_tokens (id, user_id, token_hash, created_at) VALUES ('cft','victim','FEED-BEARER-HASH',?)`, [now]],
    [`INSERT INTO wave_encryption_keys (wave_id, user_id, encrypted_wave_key, sender_public_key, key_version, created_at) VALUES (?,'victim','k','p',1,?)`, [own.id, now]],
    [`INSERT INTO wave_key_requests (id, wave_id, requester_id, requester_public_key, status, created_at, granted_by) VALUES ('kr',?, 'friend','pk','granted',?,'victim')`, [own.id, now]],
    [`INSERT INTO portal_waves (wave_id, added_by, display_order, added_at) VALUES (?,'victim',1,?)`, [own.id, now]],
    [`INSERT INTO events (id, wave_id, title, event_date, scope, created_by, created_at) VALUES ('ev',?,'An event','2026-10-01','wave','victim',?)`, [own.id, now]],
    [`INSERT INTO attachments (id, path, wave_id, uploaded_by, created_at) VALUES ('att','files/x.txt',?,'victim',?)`, [own.id, now]],
  ];
  const seeded = [];
  for (const [sql, params] of raw) {
    try { db.db.prepare(sql).run(...params); seeded.push(sql.match(/INTO (\w+)/)[1]); }
    catch (e) { /* a table this node's schema does not have */ }
  }

  // A Community they own alone, which has its own rule.
  const community = db.createCommunity({ slug: 'theirs', name: 'Theirs', createdBy: 'victim' });

  return { db, own, shared, ping, community, seeded };
}

/** Every column anywhere that points at users(id). */
function referencesTo(db, userId) {
  const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  const found = [];
  for (const t of tables) {
    for (const fk of db.db.pragma(`foreign_key_list("${t}")`)) {
      if (fk.table !== 'users') continue;
      const n = db.db.prepare(`SELECT COUNT(*) c FROM "${t}" WHERE "${fk.from}" = ?`).get(userId).c;
      if (n) found.push(`${t}.${fk.from} (${n})`);
    }
  }
  return found;
}

test('deleting an account leaves nothing behind that names them', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-delete-'));
  try {
    await t.test('the deletion succeeds with foreign keys enforced', async () => {
      const { db, seeded } = await populated(temp);
      assert.ok(seeded.length >= 7, `fixture is too thin to prove anything: ${seeded.join(', ')}`);

      const result = db.deleteUserAccount('victim');
      assert.equal(result.success, true, `deletion failed: ${result.error}`);
      assert.equal(db.db.pragma('foreign_key_check').length, 0);
      db.db.close();
    });

    await t.test('their key material and credentials are gone', async () => {
      const { db } = await populated(temp);
      db.deleteUserAccount('victim');

      // The specific rows found orphaned in production.
      for (const [table, column] of [
        ['user_encryption_keys', 'user_id'],
        ['user_recovery_keys', 'user_id'],
        ['plex_connections', 'user_id'],
        ['known_devices', 'user_id'],
        ['calendar_feed_tokens', 'user_id'],
        ['refresh_tokens', 'user_id'],
      ]) {
        let n;
        try { n = db.db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${column} = 'victim'`).get().c; }
        catch { continue; }
        assert.equal(n, 0, `${table} still holds rows for a deleted account`);
      }

      // And nothing was left containing the secret itself.
      const leaked = db.db.prepare(
        "SELECT COUNT(*) c FROM user_encryption_keys WHERE encrypted_private_key = 'ENCRYPTED-PRIVATE-KEY'"
      ).get().c;
      assert.equal(leaked, 0);
      db.db.close();
    });

    await t.test('NOTHING anywhere still names them', async () => {
      // The assertion the hand-written cleanup list could never make. It does
      // not enumerate tables, so it cannot fall behind the schema — a table
      // added next year is covered by it the day it is added.
      const { db } = await populated(temp);
      db.deleteUserAccount('victim');
      assert.deepEqual(referencesTo(db, 'victim'), [],
        'a reference to a user who no longer exists is residue, whatever table it is in');
      db.db.close();
    });

    await t.test('what should survive, survives', async () => {
      // The control. A deletion that took the conversations with it would pass
      // every assertion above and be a catastrophe.
      const { db, own, shared, ping, community } = await populated(temp);
      db.deleteUserAccount('victim');

      assert.ok(db.getWave(shared.id), 'someone else\'s wave must not vanish');
      const orphaned = db.db.prepare('SELECT author_id, content FROM pings WHERE id = ?').get(ping.id);
      assert.ok(orphaned, 'their messages stay so the conversation still reads');
      assert.notEqual(orphaned.author_id, 'victim');
      assert.equal(orphaned.content, 'something they said');

      const transferred = db.getWave(own.id);
      assert.ok(transferred, 'a wave they created but others are in survives them');

      // And the Community rule from v2.105.0 still applies.
      assert.equal(db.getCommunityById(community.id).status, 'suspended');
      db.db.close();
    });

    await t.test('residue from past deletions is cleared, and the repair is idempotent', async () => {
      const { db } = await populated(temp);

      // Delete the account the way it used to happen: enforcement off, so the
      // cascades never run.
      db.db.exec('PRAGMA foreign_keys = OFF');
      db.db.prepare("DELETE FROM users WHERE id = 'victim'").run();
      db.db.pragma('foreign_keys = ON');

      const before = referencesTo(db, 'victim');
      assert.ok(before.length > 3, `the fixture should leave real residue, saw ${before.join(', ')}`);
      assert.ok(before.some(r => r.startsWith('user_encryption_keys')),
        'including the key material this is all about');

      const dry = db.repairOrphanedUserReferences({ dryRun: true });
      assert.ok(dry.total > 0);
      assert.deepEqual(referencesTo(db, 'victim'), before, 'a dry run changes nothing');

      const done = db.repairOrphanedUserReferences();
      assert.ok(done.total > 0);
      assert.deepEqual(referencesTo(db, 'victim'), [], 'and the real run clears it');
      assert.equal(db.db.pragma('foreign_key_check').length, 0);

      const again = db.repairOrphanedUserReferences();
      assert.equal(again.total, 0, 'the second run has nothing left to do');
      db.db.close();
    });

    await t.test('a reference the cleanup misses now fails loudly instead of silently', async () => {
      // The point of enforcement. A future table that nobody adds to the
      // cleanup list must break the delete, not leave residue no one sees.
      const { db } = await populated(temp);
      db.db.exec(`CREATE TABLE forgotten_table (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id) ON DELETE NO ACTION
      )`);
      db.db.prepare("INSERT INTO forgotten_table (id, user_id) VALUES ('x','victim')").run();

      const result = db.deleteUserAccount('victim');
      assert.equal(result.success, false, 'silence is the failure mode this replaces');
      assert.match(result.error, /FOREIGN KEY/i);
      assert.ok(db.findUserById('victim'), 'and the account is still there to try again');
      db.db.close();
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
