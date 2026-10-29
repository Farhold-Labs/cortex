'use strict';

// v2.132.0 — groups that make themselves (docs/wave-access, phase 3). A wave
// started with two or more other people gets a group of its own, named after
// its people until someone renames it; accepting the invitation joins the
// group. A one-to-one conversation becomes a group when a third person is
// added. Adding to or removing from a group that several waves share asks
// "this wave only" (the wave splits off) or "the whole group".
//
// The counterfactual puts back what removal did before: only the participant
// row went, so the group still let the removed person in.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'SelfForming123!';

async function startServer(temp, { stripFix = false } = {}) {
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

  if (stripFix) {
    // Removing someone from a group wave only drops their participant row, as
    // crew waves did before v2.132.0: the group still lets them in.
    const srvFile = path.join(serverDir, 'server.js');
    let s = fs.readFileSync(srvFile, 'utf8');
    const marker = '  if (isGroupWave(wave) && db.isGroupMember(wave.groupId, userId)) {\n    const scope = groupScope(req, res, wave);';
    assert.ok(s.includes(marker), 'counterfactual: could not find the group removal');
    fs.writeFileSync(srvFile, s.replace(marker, '  if (false) {\n    const scope = groupScope(req, res, wave);'));
  }

  {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    seed.updateInstanceConfig({ features: { communities: true } });
    seed.db.close();
  }
  fs.appendFileSync(path.join(serverDir, 'server.js'),
    "\nserver.on('listening', () => console.log('GROUPS_PORT=' + server.address().port));\n");

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-self-forming-groups-00',
      SEED_DEMO_DATA: 'false',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 25000;
  while (!/GROUPS_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const port = output.match(/GROUPS_PORT=(\d+)/)[1];
  const base = `http://127.0.0.1:${port}`;

  const api = async (method, urlPath, { token, body } = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: json };
  };
  const makeUser = async (handle) => {
    await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
    const login = await api('POST', '/api/auth/login', { body: { handle, password } });
    assert.equal(login.status, 200, `login failed for ${handle}: ${JSON.stringify(login.body)}`);
    return { handle, token: login.body.token, id: login.body.user.id };
  };
  return { child, base, api, makeUser };
}



async function scenario({ api, makeUser }) {
  await makeUser('nodeadmin');
  const mal = await makeUser('mal'), zoe = await makeUser('zoe'), wash = await makeUser('wash');
  const kaylee = await makeUser('kaylee'), jayne = await makeUser('jayne'), river = await makeUser('river');
  const r = {};
  const read = async (u, id) => (await api('GET', `/api/waves/${id}`, { token: u.token })).status;
  const acceptAll = async (u) => {
    for (const i of (await api('GET', '/api/wave-invitations', { token: u.token })).body.invitations) {
      await api('POST', `/api/wave-invitations/${i.id}/accept`, { token: u.token });
    }
  };
  const wave = async (u, body) => {
    const res = await api('POST', '/api/waves', { token: u.token, body: { privacy: 'private', ...body } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  const add = (u, w, userId, scope) => api('POST', `/api/waves/${w}/participants`, { token: u.token, body: { userId, ...(scope ? { scope } : {}) } });

  // 1. Three people: a group, named after them, invitations still asked.
  const w1 = await wave(mal, { title: 'Supper', participants: [zoe.id, wash.id] });
  r.w1 = { privacy: w1.privacy, group: w1.group, invited: w1.invited.length };
  r.zoeBefore = await read(zoe, w1.id);
  r.zoeInvite = (await api('GET', '/api/wave-invitations', { token: zoe.token })).body.invitations[0];
  await acceptAll(zoe);
  r.zoeAfter = await read(zoe, w1.id);
  r.zoeGroups = (await api('GET', '/api/groups', { token: zoe.token })).body;
  const g1 = w1.group.id;

  // 2. A one-to-one stays direct; the third person makes it a group.
  const dm = await wave(mal, { title: 'Just us', participants: [kaylee.id] });
  r.dmPrivacy = dm.privacy;
  await acceptAll(kaylee);
  r.addThird = (await add(mal, dm.id, jayne.id)).status;
  const dmNow = (await api('GET', `/api/waves/${dm.id}`, { token: mal.token })).body;
  r.dmAfter = { privacy: dmNow.privacy, group: dmNow.group };
  r.kayleeStill = await read(kaylee, dm.id);
  r.kayleeInGroup = ((await api('GET', '/api/groups', { token: kaylee.token })).body || []).some(g => g.id === dmNow.group?.id);
  r.jayneBefore = await read(jayne, dm.id);

  // 3. New wave with these people: nobody asked again.
  r.groupOf = (await api('POST', `/api/waves/${w1.id}/group`, { token: zoe.token })).body;
  const w2 = await wave(zoe, { title: 'Second supper', privacy: 'group', groupId: g1 });
  r.malReadsW2 = await read(mal, w2.id);

  // 4. A shared group asks which.
  const ask = await add(mal, w1.id, river.id);
  r.ask = { status: ask.status, code: ask.body?.code, waveCount: ask.body?.waveCount };
  r.whole = (await add(mal, w1.id, river.id, 'group')).status;
  r.riverInvite = (await api('GET', '/api/wave-invitations', { token: river.token })).body.invitations[0]?.group;
  await acceptAll(river);
  r.riverReadsW2 = await read(river, w2.id);
  r.only = (await add(zoe, w2.id, kaylee.id, 'wave')).status;
  const w2Now = (await api('GET', `/api/waves/${w2.id}`, { token: zoe.token })).body;
  r.split = { moved: w2Now.group?.id !== g1, waveCount: w2Now.group?.waveCount };
  await acceptAll(kaylee);
  r.kayleeReadsW2 = await read(kaylee, w2.id);
  r.kayleeReadsW1 = await read(kaylee, w1.id);
  r.malStillW2 = await read(mal, w2.id);

  // 5. Removing someone from a group wave takes them out of the group.
  r.remove = (await api('DELETE', `/api/waves/${w1.id}/participants/${river.id}`, { token: mal.token })).status;
  r.riverAfterRemoval = await read(river, w1.id);

  // 6. Anyone in it may rename it; clearing the name hands it back.
  r.rename = (await api('PUT', `/api/groups/${g1}`, { token: wash.token, body: { name: 'Bridge' } })).status;
  await acceptAll(wash);
  const renamed = await api('PUT', `/api/groups/${g1}`, { token: wash.token, body: { name: 'Bridge' } });
  r.renamed = { status: renamed.status, name: renamed.body?.name, auto: renamed.body?.autoNamed };
  const back = await api('PUT', `/api/groups/${g1}`, { token: zoe.token, body: { autoNamed: true } });
  r.back = { status: back.status, name: back.body?.name, auto: back.body?.autoNamed };
  r.descByMember = (await api('PUT', `/api/groups/${g1}`, { token: zoe.token, body: { description: 'x' } })).status;
  return r;
}

test('groups that make themselves', { timeout: 120000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-groups-'));
  let srv;
  try {
    srv = await startServer(temp);
    const r = await scenario(srv);

    await t.test('a wave started with two others gets a group named after its people', () => {
      assert.equal(r.w1.privacy, 'group');
      assert.equal(r.w1.group.autoNamed, true);
      assert.equal(r.w1.group.name, 'mal, zoe & wash', 'pending invitees are part of the name');
      assert.equal(r.w1.invited, 2, 'they are still asked');
      assert.equal(r.zoeBefore, 403);
      assert.equal(r.zoeInvite.group.name, 'mal, zoe & wash');
      assert.equal(r.zoeAfter, 200);
      assert.ok(r.zoeGroups.some(g => g.name === 'mal, zoe & wash' && g.autoNamed), 'accepting joined the group');
    });

    await t.test('a one-to-one stays direct until a third person is added', () => {
      assert.equal(r.dmPrivacy, 'private');
      assert.equal(r.addThird, 202);
      assert.equal(r.dmAfter.privacy, 'group');
      assert.equal(r.dmAfter.group.name, 'mal, kaylee & jayne');
      assert.equal(r.kayleeStill, 200, 'kaylee was not asked again');
      assert.equal(r.kayleeInGroup, true);
      assert.equal(r.jayneBefore, 403, 'the third person is asked');
    });

    await t.test('a new wave with the same group asks nobody again', () => {
      assert.equal(r.groupOf.groupId, r.w1.group.id);
      assert.equal(r.malReadsW2, 200);
    });

    await t.test('a group shared by two waves asks: this wave only, or the whole group', () => {
      assert.deepEqual(r.ask, { status: 409, code: 'GROUP_SCOPE_REQUIRED', waveCount: 2 });
      assert.equal(r.whole, 202);
      assert.equal(r.riverInvite.waveCount, 2, 'the invitation says it is a group of two waves');
      assert.equal(r.riverReadsW2, 200, 'the whole group: every wave of it');
      assert.equal(r.only, 202);
      assert.deepEqual(r.split, { moved: true, waveCount: 1 });
      assert.equal(r.kayleeReadsW2, 200);
      assert.equal(r.kayleeReadsW1, 403, 'this wave only: not the others');
      assert.equal(r.malStillW2, 200, 'the split keeps everyone already in');
    });

    await t.test('removing someone from a group wave takes them out of the group', () => {
      assert.equal(r.remove, 200);
      assert.equal(r.riverAfterRemoval, 403);
    });

    await t.test('anyone in a group may rename it; clearing the name hands it back to its people', () => {
      assert.equal(r.rename, 403, 'not until they are in it');
      assert.deepEqual(r.renamed, { status: 200, name: 'Bridge', auto: false });
      assert.equal(r.back.status, 200);
      assert.equal(r.back.auto, true);
      assert.match(r.back.name, /^mal, zoe/);
      assert.equal(r.descByMember, 403, 'the description stays with its admins');
    });
  } finally {
    srv?.child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('counterfactual: removing only the participant row leaves the group letting them in', { timeout: 120000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-groups-cf-'));
  let srv;
  try {
    srv = await startServer(temp, { stripFix: true });
    const r = await scenario(srv);
    assert.equal(r.riverAfterRemoval, 200, 'the removed person can still open the wave');
  } finally {
    srv?.child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
