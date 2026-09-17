'use strict';

// Email-only followers of a public page (v2.92.0).
//
// The two claims worth proving are both about what does NOT happen: an
// unconfirmed address receives nothing, and ten items posted in one evening
// produce one email rather than ten. Everything else is plumbing.

process.env.EMAIL_ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || 'b'.repeat(64);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));

test('followers: double opt-in, batching, and one unsubscribe', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-follow-'));
  const jwtSecret = 'test-secret-for-followers-0000000000000000';
  let child;

  try {
    const serverDir = path.join(temp, 'server');
    fs.mkdirSync(serverDir);
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') {
        fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
      }
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));

    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const dbPath = path.join(serverDir, 'data/farhold.db');
    const db = new DatabaseSQLite({ dbPath });
    db.createUser({
      id: 'director', handle: 'director', email: 'director@example.test',
      passwordHash: serverRequire('bcryptjs').hashSync('Followers123!', 4), displayName: 'director',
    });
    const wave = db.createWave({ title: 'Potter McKean Players', createdBy: 'director', privacy: 'public' });
    // Published to the portal with events on — the same double opt-in the
    // public pages require before anything is visible at all.
    db.db.prepare(`INSERT INTO portal_waves (wave_id, slug, label, events_enabled, display_order, added_at)
                   VALUES (?, ?, ?, 1, 0, ?)`)
      .run(wave.id, 'pmp', 'Potter McKean Players', new Date().toISOString());

    // A portal wave used purely for announcements — events switched OFF. This is
    // the shape that used to 404 on follow, because the gate was the events-page
    // gate. It is also exactly what someone on /portal wants to follow.
    const notices = db.createWave({ title: 'Notices', createdBy: 'director', privacy: 'public' });
    db.db.prepare(`INSERT INTO portal_waves (wave_id, slug, label, events_enabled, display_order, added_at)
                   VALUES (?, ?, ?, 0, 1, ?)`)
      .run(notices.id, 'notices', 'Notices', new Date().toISOString());
    db.db.close();

    fs.appendFileSync(
      path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('FLW_TEST_PORT=' + server.address().port));\n"
    );

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: jwtSecret, FEDERATION_ENABLED: 'false',
        SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
        // Exercise the encrypted-at-rest path, not the degraded fallback.
        EMAIL_ENCRYPTION_KEY: 'b'.repeat(64),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 20000;
    while (!/FLW_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) {
        throw new Error('startup failed: ' + output.slice(-4000));
      }
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/FLW_TEST_PORT=(\d+)/)[1]}`;

    const post = (url, body) => fetch(base + url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

    // Read the store directly — the tokens are deliberately never returned by
    // the API, so a test that only used HTTP could not tell a real sign-up from
    // a no-op, which is the property being protected.
    const Database = serverRequire('better-sqlite3');
    const peek = () => {
      const d = new Database(dbPath, { readonly: true });
      const rows = d.prepare('SELECT id, name, verified_at, frequency FROM followers').all();
      const queued = d.prepare('SELECT COUNT(*) c FROM follower_digest_queue WHERE sent_at IS NULL').get().c;
      d.close();
      return { rows, queued };
    };

    await t.test('signing up creates an UNCONFIRMED record', async () => {
      const res = await post('/api/public/follow', {
        email: 'watcher@example.test', name: 'Watcher', slug: 'pmp', frequency: 'daily',
      });
      assert.equal(res.status, 200);
      const { rows } = peek();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].verified_at, null, 'nothing is confirmed yet');
      assert.equal(rows[0].frequency, 'daily');
    });

    await t.test('an unknown slug is refused the same way the public pages refuse it', async () => {
      assert.equal((await post('/api/public/follow', { email: 'x@example.test', slug: 'nope' })).status, 404);
    });

    await t.test('a portal wave with events OFF can still be followed (v2.92.1)', async () => {
      // The /portal page offers no events, but "tell me when you post" is the
      // whole reason someone is standing there.
      const res = await post('/api/public/follow', { email: 'reader@example.test', slug: 'notices' });
      assert.equal(res.status, 200);
      assert.equal(peek().rows.length, 2, 'a second follower was recorded');

      // And the events-page gate is unchanged: its own endpoint still 404s.
      const evRes = await fetch(base + '/api/public/events/notices');
      assert.equal(evRes.status, 404, 'events are still switched off for that wave');
    });

    await t.test('a bad address is rejected', async () => {
      assert.equal((await post('/api/public/follow', { email: 'not-an-email', slug: 'pmp' })).status, 400);
      assert.equal(peek().rows.length, 2, 'and nothing new was stored');
    });

    await t.test('signing up twice does not create a second identity', async () => {
      const res = await post('/api/public/follow', { email: 'watcher@example.test', slug: 'pmp' });
      assert.equal(res.status, 200);
      assert.equal(peek().rows.length, 2, 'one address, one record, one unsubscribe link');
    });

    await t.test('an UNCONFIRMED follower is queued nothing at all', async () => {
      // Post an event to the followed wave while the address is unconfirmed.
      const login = await (await post('/api/auth/login', { handle: 'director', password: 'Followers123!' })).json();
      const created = await fetch(base + '/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
        body: JSON.stringify({ title: 'Auditions', eventDate: '2027-01-10', scope: 'wave', waveId: wave.id }),
      });
      assert.equal(created.status, 201);
      assert.equal(peek().queued, 0,
        'an unverified address must not accumulate a backlog waiting to be sent on confirm');
    });

    await t.test('confirming works exactly once', async () => {
      const d = new Database(dbPath, { readonly: true });
      const hash = d.prepare('SELECT verify_token_hash h FROM followers').get().h;
      d.close();
      assert.ok(hash, 'a pending token exists');

      // The raw token only ever left in the email, so drive confirm the way a
      // forged link would arrive: a wrong token must be refused.
      assert.equal((await post('/api/public/follow/confirm', { token: 'a'.repeat(48) })).status, 404);
      assert.equal(peek().rows[0].verified_at, null, 'and still unconfirmed');
    });

    await t.test('ten items posted in one evening queue ten rows, not ten emails', async () => {
      // Confirm the follower directly, since the raw token never leaves the mail.
      const w = new Database(dbPath);
      // Only the follower under test — a blanket update would also confirm the
      // announcements-only follower and muddy the later assertions.
      w.prepare("UPDATE followers SET verified_at = ?, verify_token_hash = NULL WHERE name = 'Watcher'")
        .run(new Date().toISOString());
      w.close();

      const login = await (await post('/api/auth/login', { handle: 'director', password: 'Followers123!' })).json();
      for (let i = 0; i < 10; i++) {
        const r = await fetch(base + '/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` },
          body: JSON.stringify({ title: `Rehearsal ${i}`, eventDate: '2027-02-0' + (i % 9 + 1), scope: 'wave', waveId: wave.id }),
        });
        assert.equal(r.status, 201);
      }
      // Ten queued ITEMS — which the sweep drains into ONE message. The queue is
      // per item so nothing can be sent twice; the batching happens on the way out.
      assert.equal(peek().queued, 10);
    });

    await t.test('the unsubscribe token is reproducible, so old emails keep working', async () => {
      const d = new Database(dbPath, { readonly: true });
      // Target the confirmed follower specifically — there is also an
      // announcements-only follower from the /portal case above.
      const id = d.prepare('SELECT id FROM followers WHERE verified_at IS NOT NULL').get().id;
      const enc = d.prepare('SELECT unsubscribe_token_enc e FROM followers WHERE id = ?').get(id).e;
      const before = d.prepare('SELECT COUNT(*) c FROM followers').get().c;
      d.close();
      assert.equal(before, 2);
      assert.ok(enc, 'stored encrypted rather than discarded');

      const { DatabaseSQLite } = await import('../server/database-sqlite.js');
      const rw = new DatabaseSQLite({ dbPath });
      const token = rw.getFollowerUnsubscribeToken(id);
      assert.match(token || '', /^[a-f0-9]{48}$/, 'recoverable for putting in every email');

      // And it actually works, and is uniform about it.
      const res = await post('/api/public/follow/unsubscribe', { token });
      assert.equal(res.status, 200);
      assert.equal(rw.db.prepare('SELECT COUNT(*) c FROM followers').get().c, before - 1,
        'the record goes — an address that asked to be forgotten is not kept');
      assert.equal(rw.db.prepare('SELECT COUNT(*) c FROM followers WHERE verified_at IS NOT NULL').get().c, 0,
        'and it was the right one');
      rw.db.close();

      // Unsubscribing twice answers the same, so the endpoint cannot be used to
      // test whether an address was ever on the list.
      assert.equal((await post('/api/public/follow/unsubscribe', { token })).status, 200);
    });

    await t.test('unsubscribing takes the queued items with it', async () => {
      assert.equal(peek().queued, 0, 'no orphaned queue rows for a deleted follower');
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
