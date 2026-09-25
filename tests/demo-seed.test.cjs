'use strict';

// The demo seed has to produce a usable node (v2.105.4).
//
// Two defects, both found by bringing up a fresh federation node and being
// unable to configure it:
//
//   * `getUserRole` reads `role` first and only falls back to the legacy
//     `is_admin` flag when role is empty — and `role` defaults to 'user', which
//     is not empty. The seed set `is_admin = 1` and never set `role`, so the
//     demo admin was refused by every admin route.
//   * `wave-3` referenced `crew_id: 'group-crew'`, a name left over from the
//     v2.0.0 group->crew rename that has never existed. The foreign key refused
//     it, the seed threw on that line, and every later wave, participant and
//     ping was skipped. The throw is caught upstream so the node still booted,
//     which is why nobody noticed.
//
// This is a fixture rather than a security control, so it is tested for the
// thing that actually matters: can you use the node it gives you.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('SEED_DEMO_DATA produces a usable node', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-seed-'));
  const previous = process.env.SEED_DEMO_DATA;
  try {
    process.env.SEED_DEMO_DATA = 'true';
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const db = new DatabaseSQLite({ dbPath: path.join(temp, 'seeded.db') });

    await t.test('it has an admin the role check will actually accept', async () => {
      const mal = db.findUserByHandle('mal');
      assert.ok(mal, 'the documented admin account must exist');
      assert.equal(mal.role, 'admin',
        'is_admin alone is not enough: getUserRole reads `role` first and it defaults to "user"');
    });

    await t.test('and everyone else is an ordinary user', async () => {
      for (const handle of ['zoe', 'wash', 'kaylee', 'jayne']) {
        const u = db.findUserByHandle(handle);
        assert.ok(u, `${handle} should be seeded`);
        assert.equal(u.role, 'user');
      }
    });

    await t.test('the seed runs to completion rather than throwing partway', async () => {
      // Before the fix this stopped at two waves with no participants and no
      // pings — the tail of the seed never ran.
      const count = (t) => db.db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
      assert.equal(count('users'), 5);
      assert.equal(count('crews'), 1);
      assert.equal(count('crew_members'), 5);
      assert.equal(count('waves'), 5, 'a seed that stops early leaves a half-built node');
      assert.ok(count('wave_participants') > 0, 'waves nobody is in are not a demo');
      assert.ok(count('pings') > 0, 'a chat application seeded with no messages is a poor first impression');
    });

    await t.test('the crew wave points at the crew that exists', async () => {
      const wave = db.db.prepare("SELECT crew_id, privacy FROM waves WHERE id = 'wave-3'").get();
      assert.ok(wave, 'wave-3 is the one that used to fail');
      assert.equal(wave.crew_id, 'crew-serenity');
      assert.ok(db.db.prepare('SELECT id FROM crews WHERE id = ?').get(wave.crew_id),
        'the referenced crew has to be a row that exists');
    });

    await t.test('the seeded node is referentially sound', async () => {
      assert.equal(db.db.pragma('foreign_key_check').length, 0);
    });

    db.db.close();
  } finally {
    if (previous === undefined) delete process.env.SEED_DEMO_DATA;
    else process.env.SEED_DEMO_DATA = previous;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
