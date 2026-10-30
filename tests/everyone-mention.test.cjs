'use strict';

// v2.133.0 — @everyone in a Community reaches the Community. It used to reach
// the wave's participant rows, and in a channel a member becomes a participant
// only by opening or posting in the wave, so @everyone missed every member who
// had not been in it yet. Now, in a public channel wave, it reaches every
// active member who can see the channel, and no one else: not a member kept
// out of a restricted channel (the notification carries a preview), not
// someone outside the Community, not someone who has blocked the author. Away
// from Communities it reaches everyone the wave admits, so a crew wave reaches
// its whole crew. The counterfactual puts the participant rows back and sees
// the members who had not opened the wave go unreached.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'Everyone123!';

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
    // @everyone back to the wave's participant rows, as before v2.133.0.
    const srvFile = path.join(serverDir, 'server.js');
    let s = fs.readFileSync(srvFile, 'utf8');
    const reach = 'for (const participantId of everyoneMentionIds(wave)) {';
    assert.ok(s.includes(reach), 'counterfactual: could not find the @everyone reach');
    s = s.replace(reach, 'for (const participantId of participants.map(p => p.id)) {');
    fs.writeFileSync(srvFile, s);
  }

  {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    seed.updateInstanceConfig({ features: { communities: true } });
    seed.db.close();
  }
  fs.appendFileSync(path.join(serverDir, 'server.js'),
    "\nserver.on('listening', () => console.log('EVERYONE_PORT=' + server.address().port));\n");

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-everyone-mention-00000',
      SEED_DEMO_DATA: 'false',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 25000;
  while (!/EVERYONE_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const port = output.match(/EVERYONE_PORT=(\d+)/)[1];
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
  const founder = await makeUser('founder');
  const reader = await makeUser('reader');       // member who has opened the wave
  const quiet = await makeUser('quiet');         // member who never has
  const blocker = await makeUser('blocker');     // member who blocked the founder
  const outsider = await makeUser('outsider');   // not in the Community
  const crewmate = await makeUser('crewmate');   // in founder's crew only

  const community = (await api('POST', '/api/communities', { token: founder.token, body: { name: 'Serenity', slug: 'serenity', visibility: 'private' } })).body.community;
  for (const h of ['reader', 'quiet', 'blocker']) {
    const r = await api('POST', `/api/communities/${community.id}/members`, { token: founder.token, body: { handle: h } });
    assert.ok(r.status < 300, `add ${h}: ${JSON.stringify(r.body)}`);
  }
  assert.ok((await api('POST', `/api/users/${founder.id}/block`, { token: blocker.token })).status < 300, 'block');
  const open = (await api('POST', `/api/communities/${community.id}/channels`, { token: founder.token, body: { name: 'General', slug: 'general' } })).body.channel;
  const staff = (await api('POST', `/api/communities/${community.id}/channels`, { token: founder.token, body: { name: 'Staff Room', slug: 'staff-room', visibility: 'restricted' } })).body.channel;
  assert.ok(open?.id && staff?.id, 'channels');

  const publicWave = async (channel, title) => {
    const r = await api('POST', '/api/waves', { token: founder.token, body: { title, privacy: 'public', channelId: channel.id } });
    assert.ok(r.status < 300, `wave: ${JSON.stringify(r.body)}`);
    return r.body.wave || r.body;
  };
  const general = await publicWave(open, 'Notices');
  const staffRoom = await publicWave(staff, 'Staff notices');
  assert.equal((await api('GET', `/api/waves/${general.id}`, { token: reader.token })).status, 200);
  await api('POST', `/api/waves/${general.id}/read`, { token: reader.token });

  // A crew wave away from Communities, which the crewmate has never opened.
  const crew = (await api('POST', '/api/groups', { token: founder.token, body: { name: 'Crew' } })).body;
  const crewId = crew.id || crew.group?.id;
  await api('POST', `/api/groups/${crewId}/invite`, { token: founder.token, body: { userIds: [crewmate.id] } });
  const inv = ((await api('GET', '/api/groups/invitations', { token: crewmate.token })).body || []).find(i => i.group_id === crewId);
  assert.ok(inv, 'crew invitation');
  assert.equal((await api('POST', `/api/groups/invitations/${inv.id}/accept`, { token: crewmate.token })).status, 200);
  const crewWave = (await api('POST', '/api/waves', { token: founder.token, body: { title: 'Crew wave', privacy: 'group', groupId: crewId } }));
  assert.ok(crewWave.status < 300, `crew wave: ${JSON.stringify(crewWave.body)}`);
  const crewWaveId = (crewWave.body.wave || crewWave.body).id;

  const post = async (waveId, word) => {
    const r = await api('POST', '/api/pings', { token: founder.token, body: { wave_id: waveId, content: `${word} @everyone` } });
    assert.ok(r.status < 300, `post: ${JSON.stringify(r.body)}`);
  };
  await post(general.id, 'GENERALWORD');
  await post(staffRoom.id, 'STAFFWORD');
  await post(crewWaveId, 'CREWWORD');
  await new Promise(r => setTimeout(r, 300));

  const heard = async (user, word) => JSON.stringify((await api('GET', '/api/notifications?limit=50', { token: user.token })).body || '').includes(word);
  const out = {};
  for (const u of [reader, quiet, blocker, outsider, crewmate]) {
    out[u.handle] = { general: await heard(u, 'GENERALWORD'), staff: await heard(u, 'STAFFWORD'), crew: await heard(u, 'CREWWORD') };
  }
  return out;
}

async function run(opts) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-everyone-'));
  const srv = await startServer(temp, opts);
  try { return await scenario(srv); }
  finally { srv.child.kill(); fs.rmSync(temp, { recursive: true, force: true }); }
}

test('@everyone in a Community channel reaches the members who can see it, and no one else', async () => {
  const r = await run();
  assert.equal(r.reader.general, true, 'a member who has opened the wave');
  assert.equal(r.quiet.general, true, 'a member who never has: the reported gap');
  assert.equal(r.blocker.general, false, 'not someone who blocked the author');
  assert.equal(r.outsider.general, false, 'not someone outside the Community');
  assert.equal(r.crewmate.general, false, 'not the rest of the node');
  for (const h of ['reader', 'quiet', 'blocker', 'outsider', 'crewmate']) {
    assert.equal(r[h].staff, false, `${h} cannot see the restricted channel and is not told about it`);
  }
  assert.equal(r.crewmate.crew, true, 'a crew wave reaches its whole crew');
  assert.equal(r.outsider.crew, false);
});

test('counterfactual: with participant rows only, members who never opened the wave are missed', async () => {
  const r = await run({ stripFix: true });
  assert.equal(r.reader.general, true);
  assert.equal(r.quiet.general, false, 'the gap comes back');
  assert.equal(r.crewmate.crew, false, 'and the crew member is missed');
});
