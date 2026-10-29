'use strict';

// v2.131.0 — accepting a crew invitation reaches the crew's encrypted
// membership. It used to write crew_members only, so the encrypted membership
// and its in-memory cache (which the crew's own routes check) did not know the
// new member until the server restarted: they could see the crew's waves, but
// were refused inviting others. The counterfactual drops the cache update and
// sees that refusal come back.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'CrewCache123!';

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
    // Accepting writes crew_members only, as before v2.131.0.
    const srvFile = path.join(serverDir, 'server.js');
    let s = fs.readFileSync(srvFile, 'utf8');
    const line = "  crewMembership.addMember(result.invitation.group_id, req.user.userId, 'member');\n";
    assert.ok(s.includes(line), 'counterfactual: could not find the cache update');
    fs.writeFileSync(srvFile, s.replace(line, ''));
  }

  {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    seed.updateInstanceConfig({ features: { communities: true } });
    seed.db.close();
  }
  fs.appendFileSync(path.join(serverDir, 'server.js'),
    "\nserver.on('listening', () => console.log('CREW_PORT=' + server.address().port));\n");

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-crew-cache-00000000000',
      SEED_DEMO_DATA: 'false',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 25000;
  while (!/CREW_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const port = output.match(/CREW_PORT=(\d+)/)[1];
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
  const mal = await makeUser('mal'), kaylee = await makeUser('kaylee'), jayne = await makeUser('jayne');
  const c = (await api('POST', '/api/groups', { token: mal.token, body: { name: 'Engine room' } })).body;
  const crewId = c.id || c.group?.id;
  await api('POST', `/api/groups/${crewId}/invite`, { token: mal.token, body: { userIds: [kaylee.id] } });
  const inv = ((await api('GET', '/api/groups/invitations', { token: kaylee.token })).body || []).find(i => i.group_id === crewId);
  const r = {};
  r.accept = (await api('POST', `/api/groups/invitations/${inv.id}/accept`, { token: kaylee.token })).status;
  const invite = await api('POST', `/api/groups/${crewId}/invite`, { token: kaylee.token, body: { userIds: [jayne.id] } });
  r.newMemberInvites = { status: invite.status, sent: (invite.body?.invitations || []).length };
  r.sentList = (await api('GET', `/api/groups/${crewId}/invitations/sent`, { token: kaylee.token })).status;
  r.crewWave = (await api('POST', '/api/waves', { token: kaylee.token, body: { title: 'Engine notes', privacy: 'group', groupId: crewId } })).status;
  return r;
}

test('a crew invitation, once accepted, makes a full member without a restart', { timeout: 60000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-crew-'));
  let srv;
  try {
    srv = await startServer(temp);
    const r = await scenario(srv);
    assert.equal(r.accept, 200);
    assert.deepEqual(r.newMemberInvites, { status: 201, sent: 1 }, 'the new member can invite');
    assert.equal(r.sentList, 200);
    assert.equal(r.crewWave, 201, 'the new member can start a crew wave');
  } finally {
    srv?.child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('counterfactual: without the cache update the new member is refused', { timeout: 60000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-crew-cf-'));
  let srv;
  try {
    srv = await startServer(temp, { stripFix: true });
    const r = await scenario(srv);
    assert.equal(r.accept, 200);
    assert.equal(r.newMemberInvites.status, 403);
  } finally {
    srv?.child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
