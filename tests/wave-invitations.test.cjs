'use strict';

// v2.130.0 — wave invitations: being put into somebody else's conversation
// needs consent. Before this, creating a wave with people or adding someone
// later made them a participant at once, and blocks were never checked, so
// someone who had blocked you could be put into your wave. Inside a Community
// channel, joining the Community is the consent: members who can see the
// channel are added directly and anyone else is refused.
//
// The counterfactual removes the consent step from a copy of the server and
// checks the old behaviour comes back (a blocked person and an outsider put
// straight in), so the main test fails for the right reason.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'WaveInvites123!';

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
    // Consent removed: every add is a direct add again and nothing is refused,
    // which is how v2.129.0 behaved.
    const srvFile = path.join(serverDir, 'server.js');
    let s = fs.readFileSync(srvFile, 'utf8');
    const refusal = 'function waveJoinRefusal(wave, inviterId, inviteeId) {\n';
    const decide = 'function addOrInviteToWave(wave, inviterId, inviteeId) {\n';
    assert.ok(s.includes(refusal) && s.includes(decide), 'counterfactual: could not find the consent step');
    s = s.replace(refusal, refusal + '  if (participation.isParticipant(wave.id, inviteeId) || !db.findUserById(inviteeId)) return { status: 400, error: "x" };\n  return null;\n')
         .replace(decide, decide + '  if (!waveJoinRefusal(wave, inviterId, inviteeId)) { completeWaveJoin(wave, db.findUserById(inviteeId), inviterId); return { added: true }; }\n  return { refused: { status: 400, error: "x" } };\n');
    fs.writeFileSync(srvFile, s);
  }

  {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    seed.updateInstanceConfig({ features: { communities: true } });
    seed.db.close();
  }
  fs.appendFileSync(path.join(serverDir, 'server.js'),
    "\nserver.on('listening', () => console.log('INVITE_PORT=' + server.address().port));\n");

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-wave-invites-000000000',
      SEED_DEMO_DATA: 'false',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 25000;
  while (!/INVITE_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const port = output.match(/INVITE_PORT=(\d+)/)[1];
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
  const upload = async (user, waveId) => {
    const form = new FormData();
    form.append('file', new Blob(['channel file'], { type: 'text/plain' }), 'notes.txt');
    form.append('waveId', waveId);
    const res = await fetch(`${base}/api/uploads/file`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}` }, body: form });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    return data.url;
  };
  /** Collect every message an authenticated socket receives. */
  const listen = async (user) => {
    const { default: WebSocket } = await import(path.join(root, 'server/node_modules/ws/index.js'));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const seen = [];
    await new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: user.token })));
      ws.on('message', raw => {
        const m = JSON.parse(raw);
        seen.push(m);
        if (m.type === 'auth_success') resolve();
      });
    });
    return { seen, close: () => ws.close() };
  };

  return { child, base, api, makeUser, upload, listen };
}


async function scenario({ api, makeUser }) {
  await makeUser('nodeadmin');
  const mal = await makeUser('mal'), zoe = await makeUser('zoe'), wash = await makeUser('wash');
  const kaylee = await makeUser('kaylee'), jayne = await makeUser('jayne'), outsider = await makeUser('outsider');

  const read = async (u, id) => (await api('GET', `/api/waves/${id}`, { token: u.token })).status;
  const invitesOf = async (u) => (await api('GET', '/api/wave-invitations', { token: u.token })).body?.invitations || [];
  const wave = async (u, body) => {
    const r = await api('POST', '/api/waves', { token: u.token, body: { privacy: 'private', ...body } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };

  const r = {};
  // 1. Created with zoe: zoe is asked, not added.
  const w1 = await wave(mal, { title: 'Supper plans', participants: [zoe.id] });
  r.createdInvited = w1.invited;
  r.zoeBeforeAccept = await read(zoe, w1.id);
  const zinv = await invitesOf(zoe);
  r.zoeInvitation = zinv[0] && { title: zinv[0].waveTitle, by: zinv[0].invitedBy?.handle, members: zinv[0].members.map(m => m.handle), keys: Object.keys(zinv[0]).sort() };
  r.malSeesInvited = ((await api('GET', `/api/waves/${w1.id}`, { token: mal.token })).body?.invited || []).map(i => i.handle);
  r.accept = (await api('POST', `/api/wave-invitations/${zinv[0]?.id}/accept`, { token: zoe.token })).status;
  r.zoeAfterAccept = await read(zoe, w1.id);

  // 2. Added later: wash is asked; declining with a block stops the next ask.
  r.addWash = (await api('POST', `/api/waves/${w1.id}/participants`, { token: mal.token, body: { userId: wash.id } })).status;
  r.washBefore = await read(wash, w1.id);
  const winv = (await invitesOf(wash))[0];
  r.decline = (await api('POST', `/api/wave-invitations/${winv?.id}/decline`, { token: wash.token, body: { block: true } })).status;
  r.washAfterDecline = await read(wash, w1.id);
  const w2 = await wave(mal, { title: 'Second try', participants: [wash.id] });
  r.washRefusedAfterBlock = w2.refused.includes(wash.id) && (await invitesOf(wash)).length === 0;

  // 3. kaylee blocked mal first: never invited, never added.
  await api('POST', `/api/users/${mal.id}/block`, { token: kaylee.token });
  const w3 = await wave(mal, { title: 'Engine room', participants: [kaylee.id] });
  r.kayleeRefused = w3.refused.includes(kaylee.id);
  r.kayleeRead = await read(kaylee, w3.id);
  r.kayleeAddLater = (await api('POST', `/api/waves/${w3.id}/participants`, { token: mal.token, body: { userId: kaylee.id } })).status;

  // 4. Withdraw.
  await api('POST', `/api/waves/${w3.id}/participants`, { token: mal.token, body: { userId: jayne.id } });
  const jinv = (await invitesOf(jayne))[0];
  r.withdraw = (await api('DELETE', `/api/wave-invitations/${jinv?.id}`, { token: mal.token })).status;
  r.jayneAfterWithdraw = (await invitesOf(jayne)).length;

  // 5. Auto-accept from contacts, when turned on.
  await api('PUT', '/api/profile/preferences', { token: jayne.token, body: { autoAcceptContactInvites: true } });
  await api('POST', '/api/contacts', { token: jayne.token, body: { handle: 'mal' } });
  const w5 = await wave(mal, { title: 'Contacts only', participants: [jayne.id] });
  r.jayneAutoRead = await read(jayne, w5.id);
  r.jayneAutoInvited = w5.invited.includes(jayne.id);

  // 6. A Community channel: members in directly, outsiders refused.
  const community = (await api('POST', '/api/communities', { token: mal.token, body: { name: 'Serenity', slug: 'serenity', visibility: 'private' } })).body.community;
  await api('POST', `/api/communities/${community.id}/members`, { token: mal.token, body: { handle: 'zoe' } });
  const channel = (await api('POST', `/api/communities/${community.id}/channels`, { token: mal.token, body: { name: 'Crew', slug: 'crew' } })).body.channel;
  const w6 = await wave(mal, { title: 'Cargo', channelId: channel.id, participants: [zoe.id, outsider.id] });
  r.communityZoeRead = await read(zoe, w6.id);
  r.communityOutsiderRefused = w6.refused.includes(outsider.id);
  r.communityOutsiderRead = await read(outsider, w6.id);
  r.communityAddOutsider = (await api('POST', `/api/waves/${w6.id}/participants`, { token: mal.token, body: { userId: outsider.id } })).status;
  // Filing a wave that has an outsider in it into the channel is refused too.
  const loose = await wave(mal, { title: 'Loose ends', participants: [outsider.id] });
  for (const i of await invitesOf(outsider)) await api('POST', `/api/wave-invitations/${i.id}/accept`, { token: outsider.token });
  const filed = await api('PUT', `/api/communities/${community.id}/channels/${channel.id}/waves/${loose.id}`, { token: mal.token });
  r.fileWithOutsider = { status: filed.status, code: filed.body?.code, count: filed.body?.count };

  // 7. Staff appointment is not a way in.
  r.appointStranger = (await api('PUT', `/api/waves/${w1.id}/roles/${outsider.id}`, { token: mal.token, body: { role: 'moderator' } })).status;
  r.strangerRead = await read(outsider, w1.id);

  // 8. A crew admin's direct add becomes an invitation.
  const crew = (await api('POST', '/api/groups', { token: mal.token, body: { name: 'Bridge' } })).body;
  const crewId = crew.id || crew.group?.id;
  r.crewAdd = (await api('POST', `/api/groups/${crewId}/members`, { token: mal.token, body: { userId: outsider.id } })).status;
  const crewInvites = (await api('GET', '/api/groups/invitations', { token: outsider.token })).body || [];
  r.crewInvited = crewInvites.some(i => i.group_id === crewId);
  r.crewMember = ((await api('GET', `/api/groups/${crewId}`, { token: mal.token })).body?.members || []).some(m => m.id === outsider.id);
  return r;
}

test('wave invitations: people are asked, blocks hold, Communities take only their members', { timeout: 120000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-invite-'));
  let srv;
  try {
    srv = await startServer(temp);
    const r = await scenario(srv);

    await t.test('creating a wave with someone invites them; nothing is readable until they accept', () => {
      assert.equal(r.createdInvited.length, 1);
      assert.equal(r.zoeBeforeAccept, 403);
      assert.deepEqual({ title: r.zoeInvitation.title, by: r.zoeInvitation.by }, { title: 'Supper plans', by: 'mal' });
      assert.deepEqual(r.zoeInvitation.members, ['mal']);
      for (const k of r.zoeInvitation.keys) assert.doesNotMatch(k, /ping|message|content|preview/i, `invitation leaks ${k}`);
      assert.deepEqual(r.malSeesInvited, ['zoe'], 'the wave shows who is invited');
      assert.equal(r.accept, 200);
      assert.equal(r.zoeAfterAccept, 200);
    });

    await t.test('adding someone later invites them; decline-and-block stops the next one', () => {
      assert.equal(r.addWash, 202);
      assert.equal(r.washBefore, 403);
      assert.equal(r.decline, 200);
      assert.equal(r.washAfterDecline, 403);
      assert.equal(r.washRefusedAfterBlock, true);
    });

    await t.test('someone who blocked you is never invited or added', () => {
      assert.equal(r.kayleeRefused, true);
      assert.equal(r.kayleeRead, 403);
      assert.equal(r.kayleeAddLater, 403);
    });

    await t.test('the inviter can withdraw an invitation', () => {
      assert.equal(r.withdraw, 200);
      assert.equal(r.jayneAfterWithdraw, 0);
    });

    await t.test('auto-accept from contacts works only when turned on', () => {
      assert.equal(r.jayneAutoRead, 200);
      assert.equal(r.jayneAutoInvited, false);
    });

    await t.test('in a Community channel, members are added and outsiders refused', () => {
      assert.equal(r.communityZoeRead, 200);
      assert.equal(r.communityOutsiderRefused, true);
      assert.equal(r.communityOutsiderRead, 403);
      assert.equal(r.communityAddOutsider, 403);
      assert.deepEqual(r.fileWithOutsider, { status: 409, code: 'OUTSIDERS_IN_WAVE', count: 1 }, 'filing would put an outsider in');
    });

    await t.test('appointing wave staff does not put a stranger in', () => {
      assert.equal(r.appointStranger, 400);
      assert.equal(r.strangerRead, 403);
    });

    await t.test('a crew admin adding someone sends an invitation instead', () => {
      assert.equal(r.crewAdd, 202);
      assert.equal(r.crewInvited, true);
      assert.equal(r.crewMember, false);
    });
  } finally {
    srv?.child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('counterfactual: without the consent step, blocked people and outsiders go straight in', { timeout: 120000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-invite-cf-'));
  let srv;
  try {
    srv = await startServer(temp, { stripFix: true });
    const r = await scenario(srv);
    assert.equal(r.zoeBeforeAccept, 200, 'added without being asked');
    assert.equal(r.kayleeRead, 200, 'someone who blocked the creator was put in');
    assert.equal(r.communityOutsiderRefused, false, 'an outsider was put into a Community wave');
    // Since v2.134.0 the channel still keeps them out: a narrowed wave admits
    // nobody who cannot see its channel, whatever rows or names they hold.
    assert.equal(r.communityOutsiderRead, 403, 'and the channel rule still holds');
  } finally {
    srv?.child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
