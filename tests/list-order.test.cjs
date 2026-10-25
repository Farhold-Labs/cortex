'use strict';

// Sidebar order (v2.121.0).
//
// The wave list was sorted by last activity, so a wave jumped to the top
// whenever someone posted in it. Now people arrange it themselves:
//
//   * their own order for their waves and their Communities, stored encrypted
//     (a plaintext list of someone's wave ids is the participation graph the
//     participation encryption exists to hide);
//   * a Community's channels, and the waves in each channel, arranged by
//     whoever may manage channels, and seen by every member.
//
// Arranging a channel must not become a way to learn about, or touch, waves
// the manager cannot read, so those parts get their own assertions.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const PARTICIPATION_KEY = 'a1'.repeat(32);

test('moving within a section of one ordered list', async () => {
  const { moveInGroup, moveInList, byPersonalOrder, byChannelOrder } = await import('../client/src/utils/listOrder.js');

  // The whole list is a b c d e; one section holds b and d.
  const all = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(moveInGroup(all, ['b', 'd'], 'd', -1), ['a', 'd', 'b', 'c', 'e'], 'd moves above b, its neighbour in the section');
  assert.deepEqual(moveInGroup(all, ['b', 'd'], 'b', 1), ['a', 'c', 'd', 'b', 'e'], 'b moves below d');
  assert.equal(moveInGroup(all, ['b', 'd'], 'b', -1), null, 'already first in its section');
  assert.equal(moveInGroup(all, ['b', 'd'], 'd', 1), null, 'already last in its section');
  assert.deepEqual(moveInList(['x', 'y', 'z'], 'z', -1), ['x', 'z', 'y']);

  // Placed first in their order, then the unplaced oldest first — so a new
  // wave arrives at the bottom.
  const waves = [
    { id: 'new', createdAt: '2026-10-25' },
    { id: 'second', position: 1, createdAt: '2026-01-01' },
    { id: 'old', createdAt: '2026-01-01' },
    { id: 'first', position: 0, createdAt: '2026-09-09' },
  ];
  assert.deepEqual([...waves].sort(byPersonalOrder).map(w => w.id), ['first', 'second', 'old', 'new']);
  assert.deepEqual([...waves].map(w => ({ ...w, channelPosition: w.position })).sort(byChannelOrder).map(w => w.id),
    ['first', 'second', 'old', 'new']);
});

test('list order through a real server', { timeout: 180000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-list-order-'));
  const password = 'ListOrder123!';
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
    const dbPath = path.join(serverDir, 'data/farhold.db');
    {
      const { DatabaseSQLite } = await import('../server/database-sqlite.js');
      const seedDb = new DatabaseSQLite({ dbPath });
      seedDb.updateInstanceConfig({ features: { communities: true } });
      seedDb.db.close();
    }

    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('ORDER_TEST_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-list-order-000000000000',
        WAVE_PARTICIPATION_KEY: PARTICIPATION_KEY,
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 25000;
    while (!/ORDER_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/ORDER_TEST_PORT=(\d+)/)[1]}`;

    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* empty body */ }
      return { status: res.status, body: json };
    };
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', {
        body: { handle, email: `${handle}@example.test`, password, displayName: handle },
      });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, `login failed for ${handle}: ${JSON.stringify(login.body)}`);
      return { handle, token: login.body.token, id: login.body.user.id };
    };
    const newWave = async (user, title, extra = {}) => {
      const res = await api('POST', '/api/waves', { token: user.token, body: { title, privacy: 'private', ...extra } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.id || res.body.wave?.id;
    };
    const myWaves = async (user) => {
      const res = await api('GET', '/api/waves', { token: user.token });
      assert.equal(res.status, 200);
      return new Map(res.body.map(w => [w.id, w]));
    };

    await makeUser('nodeadmin');
    const owner = await makeUser('founder');
    const member = await makeUser('memberuser');
    const other = await makeUser('otheruser');

    await t.test('someone arranges their own waves', async () => {
      const a = await newWave(member, 'A');
      const b = await newWave(member, 'B');
      const c = await newWave(member, 'C');
      const notMine = await newWave(other, 'Not yours');

      let waves = await myWaves(member);
      assert.equal(waves.get(a).position, null, 'nothing is placed until they arrange it');

      const res = await api('PUT', '/api/profile/list-order', {
        token: member.token, body: { waves: [c, a, notMine, 'wave-nonexistent', b, c] },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.waves, 3, 'a wave they cannot see, an unknown id and a repeat are dropped');

      waves = await myWaves(member);
      assert.deepEqual([c, a, b].map(id => waves.get(id).position), [0, 1, 2]);

      const d = await newWave(member, 'D, created later');
      waves = await myWaves(member);
      assert.equal(waves.get(d).position, null, 'a new wave is unplaced, so it lists after the arranged ones');

      // Their order is stored encrypted: the row holds no wave id in the clear.
      const Database = serverRequire('better-sqlite3');
      const raw = new Database(dbPath, { readonly: true });
      try {
        const row = raw.prepare('SELECT data, iv FROM user_list_order WHERE user_id = ?').get(member.id);
        assert.ok(row && row.iv, 'an encrypted row exists');
        for (const id of [a, b, c]) assert.ok(!row.data.includes(id), 'no wave id in plaintext');
      } finally { raw.close(); }
    });

    await t.test('the order is validated', async () => {
      for (const body of [{}, { waves: 'nope' }, { waves: [1, 2] }, { waves: Array(5001).fill('x') }, { communities: [''] }]) {
        const res = await api('PUT', '/api/profile/list-order', { token: member.token, body });
        assert.equal(res.status, 400, JSON.stringify(body));
      }
      assert.equal((await api('PUT', '/api/profile/list-order', { body: { waves: [] } })).status, 401);
    });

    let community, channels;

    await t.test('someone arranges their Communities', async () => {
      const zeta = (await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Zeta Players', slug: 'zeta-players', visibility: 'public' },
      })).body.community;
      const alpha = (await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Alpha Guild', slug: 'alpha-guild', visibility: 'public' },
      })).body.community;
      const elsewhere = (await api('POST', '/api/communities', {
        token: other.token, body: { name: 'Elsewhere', slug: 'elsewhere', visibility: 'public' },
      })).body.community;
      for (const c of [zeta, alpha]) {
        assert.equal((await api('POST', `/api/communities/${c.id}/join`, { token: member.token })).status, 200);
      }
      community = zeta;

      let mine = (await api('GET', '/api/communities/mine', { token: member.token })).body.communities;
      assert.deepEqual(mine.map(c => c.name), ['Alpha Guild', 'Zeta Players'], 'by name until arranged');

      const res = await api('PUT', '/api/profile/list-order', {
        token: member.token, body: { communities: [zeta.id, elsewhere.id, alpha.id] },
      });
      assert.equal(res.body.communities, 2, 'a Community they are not in is dropped');
      mine = (await api('GET', '/api/communities/mine', { token: member.token })).body.communities;
      assert.deepEqual(mine.map(c => c.name), ['Zeta Players', 'Alpha Guild']);

      // Saving one list keeps the other.
      const waves = await myWaves(member);
      assert.ok([...waves.values()].some(w => w.position === 0), 'the wave order survived');
    });

    await t.test('channels: new ones go last, and only a manager reorders them', async () => {
      // Named in reverse so that the old "sort_order 0, then name" order would
      // put them backwards.
      for (const name of ['zulu', 'yankee', 'xray']) {
        const res = await api('POST', `/api/communities/${community.id}/channels`, { token: owner.token, body: { name } });
        assert.equal(res.status, 201, JSON.stringify(res.body));
      }
      let list = (await api('GET', `/api/communities/${community.id}/channels`, { token: member.token })).body;
      channels = Object.fromEntries(list.channels.map(c => [c.name, c]));
      assert.deepEqual(list.channels.map(c => c.name).filter(n => ['zulu', 'yankee', 'xray'].includes(n)),
        ['zulu', 'yankee', 'xray'], 'in the order they were made');
      assert.equal(list.canManageChannels, false, 'a member is told they cannot arrange channels');
      assert.equal(list.channels.find(c => c.name === 'zulu').canManage, false);

      const ownerList = (await api('GET', `/api/communities/${community.id}/channels`, { token: owner.token })).body;
      assert.equal(ownerList.canManageChannels, true);
      assert.equal(ownerList.channels.find(c => c.name === 'zulu').canManage, true);

      const ids = (names) => names.map(n => channels[n].id);
      const refused = await api('PUT', `/api/communities/${community.id}/channel-order`, {
        token: member.token, body: { channelIds: ids(['xray', 'zulu']) },
      });
      assert.equal(refused.status, 403);

      const res = await api('PUT', `/api/communities/${community.id}/channel-order`, {
        token: owner.token, body: { channelIds: [...ids(['xray', 'zulu']), 'channel-elsewhere'] },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      list = (await api('GET', `/api/communities/${community.id}/channels`, { token: member.token })).body;
      assert.deepEqual(list.channels.map(c => c.name).filter(n => ['zulu', 'yankee', 'xray'].includes(n)),
        ['xray', 'zulu', 'yankee'], 'the listed ones first, the rest after in their old order');
    });

    await t.test('waves in a channel: one shared order, set by a manager', async () => {
      const channelId = channels.zulu.id;
      // The member's private wave: the owner manages the channel but is not in it.
      const hidden = await newWave(member, 'Members only', { channelId });
      const w2 = await newWave(owner, 'Two', { channelId, privacy: 'public' });
      const w3 = await newWave(owner, 'Three', { channelId, privacy: 'public' });

      const refused = await api('PUT', `/api/communities/${community.id}/channels/${channelId}/wave-order`, {
        token: member.token, body: { waveIds: [w3, w2] },
      });
      assert.equal(refused.status, 403, 'a member cannot arrange the channel');

      const res = await api('PUT', `/api/communities/${community.id}/channels/${channelId}/wave-order`, {
        token: owner.token, body: { waveIds: [w3, hidden, w2] },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.placed, 2, 'a wave the manager cannot read is not placed');

      const waves = await myWaves(member);
      assert.equal(waves.get(w3).channelPosition, 0);
      assert.equal(waves.get(w2).channelPosition, 1);
      assert.equal(waves.get(hidden).channelPosition, null, 'their private wave lists after the placed ones');

      // A wave from another channel cannot be placed in this one.
      const res2 = await api('PUT', `/api/communities/${community.id}/channels/${channels.yankee.id}/wave-order`, {
        token: owner.token, body: { waveIds: [w3] },
      });
      assert.equal(res2.body.placed, 0);
      assert.equal((await myWaves(member)).get(w3).channelPosition, 0, 'and its place in its own channel is untouched');

      // Moved to another channel, a wave starts again at the bottom there.
      const moved = await api('PUT', `/api/communities/${community.id}/channels/${channels.yankee.id}/waves/${w3}`, { token: owner.token });
      assert.ok(moved.status < 300, JSON.stringify(moved.body));
      assert.equal((await myWaves(member)).get(w3).channelPosition, null);
    });

    await t.test('the low-bandwidth list carries what the order needs', async () => {
      const res = await api('GET', '/api/waves?minimal=true', { token: member.token });
      assert.equal(res.status, 200);
      for (const w of res.body) {
        assert.ok(w.createdAt, 'createdAt, which places unarranged waves');
        assert.ok('position' in w && 'channelPosition' in w);
      }
      assert.ok(res.body.some(w => w.position === 0));
      // The same values as the full list. Its query names its columns, so a
      // field the mapper reads but the query never selects is silently null.
      const full = await myWaves(member);
      for (const w of res.body) {
        const f = full.get(w.id);
        assert.equal(w.channelPosition, f.channelPosition, `channelPosition of ${w.title}`);
        assert.equal(w.createdAt, f.createdAt);
        assert.equal(w.position, f.position);
      }
      assert.ok(res.body.some(w => w.channelPosition != null), 'a placed channel wave is placed here too');
    });

    await t.test('a wave list fetched by someone else carries their order, not mine', async () => {
      const waves = await myWaves(owner);
      assert.ok([...waves.values()].every(w => w.position === null), 'the owner never arranged theirs');
    });
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(r => child.once('exit', r));
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
