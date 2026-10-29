'use strict';

// v2.131.0 — the Community wave report (docs/wave-access, phase 2). Read-only:
// in a Community, which filed waves include people who cannot see their
// channel, so the owner knows what they will be asked to decide. Owners and
// admins see their own Community, with titles only for waves they can open;
// node admins see numbers for every Community. Nobody is shown who the people
// outside are.
//
// Also two ways round v2.130.0's rule that a Community wave takes only people
// who can see its channel: a crew wave whose crew included an outsider could
// be filed (only participant rows were counted), and joining a crew whose
// wave was already filed reached that wave. The counterfactual puts both back
// and sees the filing, the report and the crew join go wrong.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'WaveReport123!';

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
    // A crew wave's people counted as its participant rows only, as in
    // v2.130.0: the crew's other members could open it, but were not counted.
    const srvFile = path.join(serverDir, 'server.js');
    let s = fs.readFileSync(srvFile, 'utf8');
    const crewPart = "  if ((wave.privacy === 'group' || wave.privacy === 'crew') && wave.groupId) {\n    for (const m of db.getGroupMembers(wave.groupId)) ids.add(m.id);\n  }\n";
    assert.ok(s.includes(crewPart), 'counterfactual: could not find the crew members');
    s = s.replace(crewPart, '');
    // And joining a crew no longer checks the channels its waves are filed in.
    const gate = 'function crewChannelRefusal(groupId, userId) {\n';
    assert.ok(s.includes(gate), 'counterfactual: could not find the crew gate');
    s = s.replace(gate, gate + '  return false;\n');
    fs.writeFileSync(srvFile, s);
  }

  {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    seed.updateInstanceConfig({ features: { communities: true } });
    seed.db.close();
  }
  fs.appendFileSync(path.join(serverDir, 'server.js'),
    "\nserver.on('listening', () => console.log('REPORT_PORT=' + server.address().port));\n");

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-wave-report-0000000000',
      SEED_DEMO_DATA: 'false',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 25000;
  while (!/REPORT_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const port = output.match(/REPORT_PORT=(\d+)/)[1];
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
  const nodeadmin = await makeUser('nodeadmin');
  const mal = await makeUser('mal'), zoe = await makeUser('zoe'), wash = await makeUser('wash');
  const kaylee = await makeUser('kaylee'), stranger = await makeUser('stranger');
  const r = { ids: { wash: wash.id, kaylee: kaylee.id } };

  const wave = async (u, body) => {
    const res = await api('POST', '/api/waves', { token: u.token, body: { privacy: 'private', ...body } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  const crewOf = async (owner, name, members) => {
    const c = (await api('POST', '/api/groups', { token: owner.token, body: { name } })).body;
    const id = c.id || c.group?.id;
    for (const m of members) {
      await api('POST', `/api/groups/${id}/invite`, { token: owner.token, body: { userIds: [m.id] } });
      const inv = ((await api('GET', '/api/groups/invitations', { token: m.token })).body || []).find(i => i.group_id === id);
      assert.ok(inv, `no crew invitation for ${m.handle}`);
      assert.equal((await api('POST', `/api/groups/invitations/${inv.id}/accept`, { token: m.token })).status, 200);
    }
    return id;
  };

  const community = (await api('POST', '/api/communities', { token: mal.token, body: { name: 'Serenity', slug: 'serenity', visibility: 'private' } })).body.community;
  for (const h of ['zoe', 'wash']) await api('POST', `/api/communities/${community.id}/members`, { token: mal.token, body: { handle: h } });
  const channel = (await api('POST', `/api/communities/${community.id}/channels`, { token: mal.token, body: { name: 'Bridge', slug: 'bridge' } })).body.channel;
  const file = (w) => api('PUT', `/api/communities/${community.id}/channels/${channel.id}/waves/${w}`, { token: mal.token });

  // A: mal's channel wave with zoe and wash, while wash is a member.
  const a = await wave(mal, { title: 'Cargo manifest', channelId: channel.id, participants: [zoe.id, wash.id] });
  // D: zoe's channel wave with wash, which mal is not in.
  const d = await wave(zoe, { title: 'Zoe and Wash only', channelId: channel.id, participants: [wash.id] });
  // C: members only; never affected.
  await wave(mal, { title: 'All hands', channelId: channel.id, participants: [zoe.id] });
  // Wash leaves the Community: now an outsider in A and D, the way such waves exist today.
  assert.equal((await api('DELETE', `/api/communities/${community.id}/members/${wash.id}`, { token: mal.token })).status, 200);

  // A crew with an outsider in it: its wave cannot be filed (the fix).
  const outerCrew = await crewOf(mal, 'Outer crew', [kaylee]);
  const outer = await wave(mal, { title: 'Outer crew wave', privacy: 'group', groupId: outerCrew });
  const outerFiled = await file(outer.id);
  r.fileCrewWithOutsider = { status: outerFiled.status, code: outerFiled.body?.code, count: outerFiled.body?.count };

  // B: a crew of members, filed; then kaylee leaves the Community, the way
  // such waves come to exist.
  await api('POST', `/api/communities/${community.id}/members`, { token: mal.token, body: { handle: 'kaylee' } });
  const bridgeCrew = await crewOf(mal, 'Bridge crew', [zoe, kaylee]);
  const b = await wave(mal, { title: 'Bridge crew wave', privacy: 'group', groupId: bridgeCrew });
  // The stranger is invited before the wave is filed and answers after.
  await api('POST', `/api/groups/${bridgeCrew}/invite`, { token: mal.token, body: { userIds: [stranger.id] } });
  r.fileCrewOfMembers = (await file(b.id)).status;
  assert.equal((await api('DELETE', `/api/communities/${community.id}/members/${kaylee.id}`, { token: mal.token })).status, 200);

  // Joining a crew whose wave is filed in a channel needs the channel too.
  const late = ((await api('GET', '/api/groups/invitations', { token: stranger.token })).body || []).find(i => i.group_id === bridgeCrew);
  r.lateAccept = (await api('POST', `/api/groups/invitations/${late.id}/accept`, { token: stranger.token })).status;
  const outsiderInvite = await api('POST', `/api/groups/${bridgeCrew}/invite`, { token: mal.token, body: { userIds: [wash.id] } });
  r.crewInviteOutsider = { status: outsiderInvite.status, sent: (outsiderInvite.body?.invitations || []).length };
  r.crewAddOutsider = (await api('POST', `/api/groups/${bridgeCrew}/members`, { token: mal.token, body: { userId: wash.id } })).status;
  r.strangerReadsB = (await api('GET', `/api/waves/${b.id}`, { token: stranger.token })).status;

  const owner = await api('GET', `/api/communities/${community.id}/wave-report`, { token: mal.token });
  r.owner = owner;
  r.byTitle = Object.fromEntries((owner.body?.waves || []).map(w => [w.title ?? `hidden:${w.id}`, w]));
  r.ids.a = a.id; r.ids.b = b.id; r.ids.d = d.id;
  r.memberStatus = (await api('GET', `/api/communities/${community.id}/wave-report`, { token: zoe.token })).status;
  r.strangerStatus = (await api('GET', `/api/communities/${community.id}/wave-report`, { token: stranger.token })).status;
  r.admin = await api('GET', '/api/admin/communities/wave-report', { token: nodeadmin.token });
  r.adminAsUser = (await api('GET', '/api/admin/communities/wave-report', { token: mal.token })).status;
  return r;
}

test('Community wave report: owners see their waves, admins see numbers, nobody sees who', { timeout: 120000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-report-'));
  let srv;
  try {
    srv = await startServer(temp);
    const r = await scenario(srv);

    await t.test('a crew wave whose crew includes an outsider cannot be filed', () => {
      assert.deepEqual(r.fileCrewWithOutsider, { status: 409, code: 'OUTSIDERS_IN_WAVE', count: 1 });
      assert.equal(r.fileCrewOfMembers, 200);
    });

    await t.test('joining a crew whose wave is in a channel needs the channel', () => {
      assert.equal(r.lateAccept, 403, 'an invitation answered after the filing is refused');
      assert.equal(r.strangerReadsB, 403);
      assert.deepEqual(r.crewInviteOutsider, { status: 201, sent: 0 });
      assert.equal(r.crewAddOutsider, 403);
    });

    await t.test('the owner sees each affected wave, with counts', () => {
      assert.equal(r.owner.status, 200, JSON.stringify(r.owner.body));
      assert.equal(r.owner.body.scanned, 4, 'A, B, C and D are in the channel');
      assert.deepEqual(r.owner.body.totals, { waves: 3, outsiders: 2 });
      const a = r.byTitle['Cargo manifest'];
      assert.deepEqual({ kind: a.kind, people: a.people, outsiders: a.outsiders, canOpen: a.canOpen }, { kind: 'private', people: 3, outsiders: 1, canOpen: true });
      const b = r.byTitle['Bridge crew wave'];
      assert.deepEqual({ kind: b.kind, crew: b.crewName, outsiders: b.outsiders }, { kind: 'crew', crew: 'Bridge crew', outsiders: 1 });
      assert.equal(r.byTitle['All hands'], undefined, 'a members-only wave is not listed');
    });

    await t.test("a wave the owner is not in is counted, but its title is not shown", () => {
      const hidden = r.byTitle[`hidden:${r.ids.d}`];
      assert.ok(hidden, 'the wave mal is not in is listed');
      assert.deepEqual({ title: hidden.title, canOpen: hidden.canOpen, people: hidden.people, outsiders: hidden.outsiders }, { title: null, canOpen: false, people: 2, outsiders: 1 });
      assert.doesNotMatch(JSON.stringify(r.owner.body), /Zoe and Wash only/);
    });

    await t.test('nobody is told who the people outside are', () => {
      for (const body of [r.owner.body, r.admin.body]) {
        const text = JSON.stringify(body);
        assert.ok(!text.includes(r.ids.wash) && !text.includes(r.ids.kaylee), 'an outsider id leaked');
        assert.doesNotMatch(text, /"(handle|userId|members|outsiderIds)"/);
      }
    });

    await t.test('only the owner and admins may read it; a stranger cannot learn the Community exists', () => {
      assert.equal(r.memberStatus, 403);
      assert.equal(r.strangerStatus, 404);
    });

    await t.test('node admins get numbers only', () => {
      assert.equal(r.adminAsUser, 403);
      assert.equal(r.admin.status, 200);
      const c = r.admin.body.communities.find(x => x.name === 'Serenity');
      assert.deepEqual({ waves: c.affectedWaves, crew: c.crewWaves, outsiders: c.outsiders, inChannels: c.channelWaves }, { waves: 3, crew: 1, outsiders: 2, inChannels: 4 });
      assert.deepEqual(r.admin.body.totals, { communities: 1, waves: 3, outsiders: 2 });
      assert.doesNotMatch(JSON.stringify(r.admin.body), /Cargo manifest|Bridge crew|"title"/);
    });
  } finally {
    srv?.child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('counterfactual: without the crew checks, a crew wave with an outsider is filed and unreported, and joining the crew reaches the channel', { timeout: 120000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-report-cf-'));
  let srv;
  try {
    srv = await startServer(temp, { stripFix: true });
    const r = await scenario(srv);
    assert.equal(r.fileCrewWithOutsider.status, 200, 'the crew wave with an outsider was filed');
    assert.equal(r.byTitle['Bridge crew wave'], undefined, 'the crew wave with an outsider went unreported');
    assert.equal(r.lateAccept, 200, 'joining the crew reached the channel wave');
    assert.equal(r.strangerReadsB, 200);
  } finally {
    srv?.child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
