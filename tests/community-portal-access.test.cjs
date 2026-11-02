'use strict';

// Portal waves in Communities, and limiting who can see a channel (v2.136.0).
//
// The public portal shows a wave to anyone on the internet, whatever its own
// privacy. So a portal wave may sit in a public Community's open channel, but
// may not be narrowed, filed into a private Community or a restricted channel,
// nor its channel restricted or its Community made private under it; and the
// portal refuses a wave that a Community says only some people can see.
//
// Restricted channels (server since v2.103.3, settable in the app now): only
// roles let in, plus owners and admins, see the channel and its waves.
//
// Counterfactual: without the portal check, a portal wave files straight into
// a private Community, whose people are told only members can see it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'PortalAccess123!';

async function startServer(temp, { stripPortal = false } = {}) {
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

  if (stripPortal) {
    // Before v2.136.0: nothing compared the portal with where a wave was filed.
    const srvFile = path.join(serverDir, 'server.js');
    let s = fs.readFileSync(srvFile, 'utf8');
    assert.ok(s.includes('portalPlaceConflict({'), 'counterfactual: could not find the portal check');
    s = s.replace(/(?<!function )portalPlaceConflict\(\{/g, 'false && portalPlaceConflict({');
    fs.writeFileSync(srvFile, s);
  }

  {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    seed.updateInstanceConfig({ features: { communities: true, publicPortal: true } });
    seed.db.close();
  }
  fs.appendFileSync(path.join(serverDir, 'server.js'),
    "\nserver.on('listening', () => console.log('AUDIENCE_PORT=' + server.address().port));\n");

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-wave-audience-000000000',
      SEED_DEMO_DATA: 'false',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 25000;
  while (!/AUDIENCE_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const base = `http://127.0.0.1:${output.match(/AUDIENCE_PORT=(\d+)/)[1]}`;

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
  return { child, api, makeUser, dbPath: path.join(serverDir, 'data/farhold.db'), output: () => output };
}

// Puts channel waves back as they were before v2.134.0 (no audience, no
// review state), after `raw` has shaped the old data, and runs the real
// migration on them.
async function scenario({ api, makeUser }) {
  const admin = await makeUser('nodeadmin');   // first account: node admin
  const mal = await makeUser('mal');            // owns both Communities
  const zoe = await makeUser('zoe');            // member
  const kaylee = await makeUser('kaylee');      // member with the Pilots role
  const r = {};
  const ok = (res, what) => assert.ok(res.status < 300, `${what}: ${res.status} ${JSON.stringify(res.body)}`);
  const read = async (u, waveId) => (await api('GET', `/api/waves/${waveId}`, { token: u.token })).status;

  const open = (await api('POST', '/api/communities', { token: mal.token, body: { name: 'Open', slug: 'open', visibility: 'public' } })).body.community;
  const closed = (await api('POST', '/api/communities', { token: mal.token, body: { name: 'Closed', slug: 'closed', visibility: 'private' } })).body.community;
  for (const c of [open, closed]) for (const h of ['zoe', 'kaylee']) {
    ok(await api('POST', `/api/communities/${c.id}/members`, { token: mal.token, body: { handle: h } }), `add ${h}`);
  }
  const news = (await api('POST', `/api/communities/${open.id}/channels`, { token: mal.token, body: { name: 'News', slug: 'news' } })).body.channel;
  const general = (await api('POST', `/api/communities/${closed.id}/channels`, { token: mal.token, body: { name: 'General', slug: 'general' } })).body.channel;

  // 1. A public wave on the portal.
  const notice = (await api('POST', '/api/waves', { token: mal.token, body: { title: 'Notice', privacy: 'public' } })).body;
  ok(await api('POST', '/api/admin/portal', { token: admin.token, body: { waveId: notice.id } }), 'publish');
  const file = (c, ch, w) => api('PUT', `/api/communities/${c.id}/channels/${ch.id}/waves/${w.id}`, { token: mal.token });
  const intoClosed = await file(closed, general, notice);
  r.intoClosed = { status: intoClosed.status, code: intoClosed.body?.code };
  r.intoOpen = (await file(open, news, notice)).status;
  const view = (await api('GET', `/api/waves/${notice.id}/audience`, { token: mal.token })).body;
  r.view = { mode: view?.mode, portal: view?.portal === true };
  const zoeView = (await api('GET', `/api/waves/${notice.id}/audience`, { token: zoe.token })).body;
  r.zoeSeesPortal = zoeView?.portal === true;
  const narrow = await api('PUT', `/api/waves/${notice.id}/audience`, { token: mal.token, body: { mode: 'only', userIds: [zoe.id] } });
  r.narrow = { status: narrow.status, code: narrow.body?.code };
  const restrict = await api('PATCH', `/api/communities/${open.id}/channels/${news.id}`, { token: mal.token, body: { visibility: 'restricted' } });
  r.restrictNews = { status: restrict.status, code: restrict.body?.code };
  const hide = await api('PATCH', `/api/communities/${open.id}`, { token: mal.token, body: { visibility: 'private' } });
  r.hideOpen = { status: hide.status, code: hide.body?.code };

  // 2. A wave in a private Community is not published.
  const inside = (await api('POST', '/api/waves', { token: mal.token, body: { title: 'Inside', privacy: 'public', channelId: general.id } })).body;
  const publish = await api('POST', '/api/admin/portal', { token: admin.token, body: { waveId: inside.id } });
  r.publishInside = { status: publish.status, code: publish.body?.code };

  // 3. Limiting a channel to a role.
  const pilots = (await api('POST', `/api/communities/${closed.id}/roles`, { token: mal.token, body: { name: 'Pilots' } })).body.role;
  ok(await api('PUT', `/api/communities/${closed.id}/members/${kaylee.id}/roles/${pilots.id}`, { token: mal.token }), 'grant pilots');
  const bridge = (await api('POST', `/api/communities/${closed.id}/channels`, { token: mal.token, body: { name: 'Bridge', slug: 'bridge' } })).body.channel;
  const talk = (await api('POST', '/api/waves', { token: mal.token, body: { title: 'Bridge talk', privacy: 'public', channelId: bridge.id } })).body;
  r.beforeLimit = { zoe: await read(zoe, talk.id), kaylee: await read(kaylee, talk.id) };
  r.memberCannotLimit = (await api('PATCH', `/api/communities/${closed.id}/channels/${bridge.id}`, { token: zoe.token, body: { visibility: 'restricted' } })).status;
  ok(await api('PUT', `/api/communities/${closed.id}/channels/${bridge.id}/roles/${pilots.id}`, { token: mal.token, body: { allow: ['channel.view'], deny: [] } }), 'let pilots in');
  ok(await api('PATCH', `/api/communities/${closed.id}/channels/${bridge.id}`, { token: mal.token, body: { visibility: 'restricted' } }), 'restrict');
  const channelsFor = async (u) => ((await api('GET', `/api/communities/${closed.id}/channels`, { token: u.token })).body.channels || []).map(c => c.name).sort();
  r.limited = { zoe: await read(zoe, talk.id), kaylee: await read(kaylee, talk.id), mal: await read(mal, talk.id),
    zoeChannels: await channelsFor(zoe), kayleeChannels: await channelsFor(kaylee) };
  ok(await api('PATCH', `/api/communities/${closed.id}/channels/${bridge.id}`, { token: mal.token, body: { visibility: 'members' } }), 'open again');
  r.reopened = await read(zoe, talk.id);
  return r;
}

async function run(opts) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-portal-access-'));
  const srv = await startServer(temp, opts);
  try { return await scenario(srv); }
  finally { srv.child.kill(); fs.rmSync(temp, { recursive: true, force: true }); }
}

test('portal waves in Communities, and limiting a channel', { timeout: 120000 }, async (t) => {
  const r = await run();

  await t.test('a portal wave may sit in a public Community, and says it is on the portal', () => {
    assert.equal(r.intoOpen, 200);
    assert.deepEqual(r.view, { mode: 'channel', portal: true });
    assert.equal(r.zoeSeesPortal, true, 'members are told too');
  });

  await t.test('nothing may say a portal wave is less than public', () => {
    assert.deepEqual(r.intoClosed, { status: 409, code: 'ON_PORTAL' });
    assert.deepEqual(r.narrow, { status: 409, code: 'ON_PORTAL' });
    assert.deepEqual(r.restrictNews, { status: 409, code: 'ON_PORTAL' });
    assert.deepEqual(r.hideOpen, { status: 409, code: 'ON_PORTAL' });
  });

  await t.test('the portal refuses a wave a Community keeps to its members', () => {
    assert.deepEqual(r.publishInside, { status: 409, code: 'NOT_PUBLIC_IN_COMMUNITY' });
  });

  await t.test('a limited channel admits its roles and the owner, and nobody else', () => {
    assert.deepEqual(r.beforeLimit, { zoe: 200, kaylee: 200 });
    assert.equal(r.memberCannotLimit, 403);
    assert.equal(r.limited.kaylee, 200);
    assert.equal(r.limited.mal, 200);
    assert.notEqual(r.limited.zoe, 200);
    assert.deepEqual(r.limited.zoeChannels, ['General']);
    assert.deepEqual(r.limited.kayleeChannels, ['Bridge', 'General']);
    assert.equal(r.reopened, 200);
  });
});

test('counterfactual: without the portal check, a portal wave files into a private Community', { timeout: 120000 }, async () => {
  const r = await run({ stripPortal: true });
  assert.equal(r.intoClosed.status, 200);
});
