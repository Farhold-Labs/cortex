'use strict';

// The wave response carries each ping once (v2.117.2).
//
// GET /api/waves/:id used to return the same page of pings six times: the
// tree and the flat list under each of the pings, droplets and messages
// names. On farhold a 50-ping page of an encrypted private wave went out as
// 377 KB for 34 KB of content, uncompressed, to a phone. The client and
// docs/API.md use `messages` (the tree) and `all_messages` (the flat list);
// these tests pin that shape so the copies don't creep back.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const password = 'Review123!';
const PINGS = 60;

async function withServer(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-wave-payload-'));
  const serverDir = path.join(temp, 'server');
  let child;
  try {
    fs.mkdirSync(serverDir, { recursive: true });
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') {
        fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
      }
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));

    const { DatabaseSQLite } = await import(path.join(serverDir, 'database-sqlite.js'));
    const db = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    const hash = serverRequire('bcryptjs').hashSync(password, 4);
    for (const id of ['owner', 'member']) {
      db.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: hash, displayName: id });
    }
    const wave = db.createWave({ title: 'Long chat', createdBy: 'owner', participants: ['member'], privacy: 'private' });
    // One second apart: pages are cut by created_at, and pings made in a tight
    // loop can share a millisecond, which made the paging test flaky.
    const start = Date.parse('2026-01-01T00:00:00Z');
    for (let i = 0; i < PINGS; i++) {
      const ping = db.createPing({ waveId: wave.id, authorId: i % 2 ? 'member' : 'owner', content: `marker-${String(i).padStart(3, '0')}` });
      db.db.prepare('UPDATE pings SET created_at = ? WHERE id = ?').run(new Date(start + i * 1000).toISOString(), ping.id);
    }
    db.db.close();

    const source = fs.readFileSync(path.join(serverDir, 'server.js'), 'utf8')
      + "\nserver.on('listening', () => console.log('PAYLOAD_TEST_PORT=' + server.address().port));\n";
    fs.writeFileSync(path.join(serverDir, 'server.js'), source);

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-wave-payload-test-key', FEDERATION_ENABLED: 'false',
        SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 20000;
    while (!/PAYLOAD_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/PAYLOAD_TEST_PORT=(\d+)/)[1]}`;
    const login = await (await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'member', password }),
    })).json();
    const get = async (p) => {
      const res = await fetch(base + p, { headers: { Authorization: `Bearer ${login.token}` } });
      assert.equal(res.status, 200);
      return res.text();
    };
    const live = new (serverRequire('better-sqlite3'))(path.join(serverDir, 'data/farhold.db'));
    try { await fn({ wave, get, db: live }); } finally { live.close(); }
  } finally {
    child?.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const collect = (nodes, out = []) => { for (const n of nodes || []) { out.push(n.id); collect(n.children, out); } return out; };

test('a wave page carries each ping once, as a tree and a flat list', { timeout: 60000 }, async () => {
  await withServer(async ({ wave, get }) => {
    const body = await get(`/api/waves/${wave.id}`);
    const data = JSON.parse(body);

    for (const gone of ['pings', 'all_pings', 'droplets', 'all_droplets']) {
      assert.equal(data[gone], undefined, `${gone} is a duplicate copy of the page and must not be sent`);
    }
    assert.equal(data.all_messages.length, 50, 'the first page is the newest 50');
    assert.equal(data.total_messages, PINGS);
    assert.equal(data.hasMoreMessages, true);
    assert.equal(data.all_messages.at(-1).content, `marker-0${PINGS - 1}`, 'the page ends at the newest ping');

    const flatIds = data.all_messages.map(p => p.id);
    assert.equal(new Set(flatIds).size, flatIds.length, 'no ping repeats in the flat list');
    assert.deepEqual(collect(data.messages).sort(), [...flatIds].sort(), 'the tree holds exactly the flat list\'s pings');

    // One ping's text appears twice in the whole body (tree + flat), not six times.
    assert.equal(body.split(`marker-0${PINGS - 1}`).length - 1, 2);
  });
});

test('low-bandwidth mode sends no ping arrays beyond the documented empty ones', { timeout: 60000 }, async () => {
  await withServer(async ({ wave, get }) => {
    const data = JSON.parse(await get(`/api/waves/${wave.id}?minimal=true`));
    for (const gone of ['pings', 'all_pings', 'droplets', 'all_droplets']) assert.equal(data[gone], undefined);
    assert.deepEqual(data.messages, []);
    assert.deepEqual(data.all_messages, []);
    assert.equal(data.total_messages, PINGS);
  });
});

test('older pings still load from /messages after the first page', { timeout: 60000 }, async () => {
  await withServer(async ({ wave, get }) => {
    const first = JSON.parse(await get(`/api/waves/${wave.id}`));
    const older = JSON.parse(await get(`/api/waves/${wave.id}/messages?limit=50&before=${first.all_messages[0].id}`));
    assert.equal(older.messages.length, PINGS - 50);
    assert.equal(older.hasMore, false);
    assert.equal(older.messages[0].content, 'marker-000');
  });
});

test('pings sharing a millisecond at the page boundary are not skipped', { timeout: 60000 }, async () => {
  await withServer(async ({ wave, get, db }) => {
    // Every ping in one instant: the worst case for a cut by created_at.
    db.prepare('UPDATE pings SET created_at = ? WHERE wave_id = ?').run('2026-01-01T00:00:00.000Z', wave.id);
    const first = JSON.parse(await get(`/api/waves/${wave.id}`));
    const older = JSON.parse(await get(`/api/waves/${wave.id}/messages?limit=50&before=${first.all_messages[0].id}`));
    const seen = new Set([...first.all_messages, ...older.messages].map(p => p.content));
    assert.equal(seen.size, PINGS, 'every ping is on one page or the other');
  });
});
