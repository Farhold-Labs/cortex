'use strict';

// Community powers (v2.140.0).
//
// - Only server moderators and admins open a wave to everyone on the server.
//   A public wave leaving its channel (moved out, channel deleted, Community
//   closed) becomes a conversation of its people, not the server's.
// - [SECURITY] Deleting a channel or closing a Community used to clear the
//   wave's two columns and nothing else: a members-only channel wave became
//   readable by every account, and a narrowed wave went back to its participant
//   rows: the people it was narrowed to lost it, and anyone with an old row
//   kept it. The counterfactual strips the fix.
// - `content.moderate` removes pings in channel waves you can read, by people
//   ranked below you; `event.manage` runs their events; `audit.view` reads the
//   log with names, never a title or channel the viewer could not see.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'CommunityPowers123!';

async function startServer(temp, { stripUnfile = false } = {}) {
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

  const srvFile = path.join(serverDir, 'server.js');
  if (stripUnfile) {
    // Before v2.140.0: deleting a channel or closing a Community cleared the
    // columns and left the waves as they were.
    let s = fs.readFileSync(srvFile, 'utf8');
    const n = (s.match(/const out = unfileChannelWaves\(/g) || []).length;
    assert.equal(n, 3, 'counterfactual: could not find the three unfileChannelWaves calls');
    s = s.replace(/const out = unfileChannelWaves\(/g, 'const out = [] || unfileChannelWaves(');
    fs.writeFileSync(srvFile, s);
  }

  {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    seed.updateInstanceConfig({ features: { communities: true } });
    seed.db.close();
  }
  fs.appendFileSync(srvFile, "\nserver.on('listening', () => console.log('POWERS_PORT=' + server.address().port));\n");

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-community-powers-00000',
      SEED_DEMO_DATA: 'false',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  if (process.env.DEBUG_SERVER) { child.stdout.pipe(process.stderr); child.stderr.pipe(process.stderr); }
  const deadline = Date.now() + 25000;
  while (!/POWERS_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const base = `http://127.0.0.1:${output.match(/POWERS_PORT=(\d+)/)[1]}`;

  const api = async (method, urlPath, { token, body, stepUp } = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(stepUp ? { 'X-Step-Up-Token': stepUp } : {}),
      },
      ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: json };
  };
  const dbPath = path.join(serverDir, 'data/farhold.db');
  const makeUser = async (handle, role = null) => {
    await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
    if (role) {
      const conn = new (require(path.join(root, 'server/node_modules/better-sqlite3')))(dbPath);
      conn.prepare('UPDATE users SET role = ? WHERE handle = ?').run(role, handle);
      conn.close();
    }
    const login = await api('POST', '/api/auth/login', { body: { handle, password } });
    assert.equal(login.status, 200, `login failed for ${handle}: ${JSON.stringify(login.body)}`);
    return { handle, token: login.body.token, id: login.body.user.id };
  };
  return { child, api, makeUser };
}

const idOf = (body) => body?.wave?.id || body?.ping?.id || body?.event?.id || body?.id;

async function scenario({ api, makeUser }, { full = true } = {}) {
  const r = {};
  const ok = (res, what) => assert.ok(res.status < 300, `${what}: ${res.status} ${JSON.stringify(res.body)}`);
  await makeUser('nodeadmin');
  const staff = await makeUser('staffmod', 'moderator');
  const owner = await makeUser('founder');
  const cadmin = await makeUser('cadmin');
  const cmod = await makeUser('cmod');
  const m1 = await makeUser('memberone');
  const m2 = await makeUser('membertwo');
  const outsider = await makeUser('outsider');
  const read = async (u, waveId) => (await api('GET', `/api/waves/${waveId}`, { token: u.token })).status;
  const stepUp = async (u) => (await api('POST', '/api/auth/step-up', { token: u.token, body: { password } })).body?.stepUpToken;

  const community = (await api('POST', '/api/communities', { token: owner.token, body: { name: 'Crew', slug: 'crew', visibility: 'private' } })).body.community;
  const cid = community.id;
  for (const u of [cadmin, cmod, m1, m2]) ok(await api('POST', `/api/communities/${cid}/members`, { token: owner.token, body: { handle: u.handle } }), `add ${u.handle}`);
  const roles = (await api('GET', `/api/communities/${cid}/roles`, { token: owner.token })).body.roles;
  const role = (name) => roles.find(x => x.name === name).id;
  ok(await api('PUT', `/api/communities/${cid}/members/${cadmin.id}/roles/${role('admin')}`, { token: owner.token }), 'admin');
  ok(await api('PUT', `/api/communities/${cid}/members/${cmod.id}/roles/${role('moderator')}`, { token: owner.token }), 'moderator');
  const channel = async (slug) => (await api('POST', `/api/communities/${cid}/channels`, { token: owner.token, body: { name: slug, slug } })).body.channel;
  const general = await channel('general');
  const newWave = (u, body) => api('POST', '/api/waves', { token: u.token, body });

  // ---- Deleting a channel (the security fix) ----
  const temp = await channel('temp');
  const membersOnly = idOf((await newWave(m1, { title: 'Members only', privacy: 'public', channelId: temp.id })).body);
  const narrowed = idOf((await newWave(owner, { title: 'Owner and one', privacy: 'public', channelId: temp.id })).body);
  ok(await api('PUT', `/api/waves/${narrowed}/audience`, { token: owner.token, body: { mode: 'only', userIds: [m1.id] } }), 'narrow');
  r.beforeDelete = { outsiderPublic: await read(outsider, membersOnly), adminLooksIn: await read(cadmin, narrowed) };
  // Whatever the admin did in it, they were not named, so they do not keep it.
  ok(await api('POST', '/api/pings', { token: cadmin.token, body: { wave_id: narrowed, content: 'checking in' } }), 'admin posts');
  ok(await api('DELETE', `/api/communities/${cid}/channels/${temp.id}`, { token: owner.token }), 'delete channel');
  r.afterDelete = {
    outsiderPublic: await read(outsider, membersOnly),
    creator: await read(m1, membersOnly),
    privacy: (await api('GET', `/api/waves/${membersOnly}`, { token: m1.token })).body?.privacy,
    adminWhoLookedIn: await read(cadmin, narrowed),
    named: await read(m1, narrowed),
  };

  // ---- Closing a Community ----
  const brief = (await api('POST', '/api/communities', { token: m1.token, body: { name: 'Brief', slug: 'brief', visibility: 'private' } })).body.community;
  const briefCh = (await api('POST', `/api/communities/${brief.id}/channels`, { token: m1.token, body: { name: 'talk', slug: 'talk' } })).body.channel;
  const briefWave = idOf((await newWave(m1, { title: 'Brief talk', privacy: 'public', channelId: briefCh.id })).body);
  ok(await api('DELETE', `/api/communities/${brief.id}`, { token: m1.token, stepUp: await stepUp(m1) }), 'close community');
  r.afterClose = { outsider: await read(outsider, briefWave), creator: await read(m1, briefWave) };

  if (!full) return r;

  // ---- Everyone on this server ----
  r.serverPublic = {
    member: (await newWave(m1, { title: 'Hello all', privacy: 'public' })).body?.code,
    staff: (await newWave(staff, { title: 'Notices', privacy: 'public' })).status,
    inChannel: (await newWave(m1, { title: 'Channel talk', privacy: 'public', channelId: general.id })).status,
  };
  const quiet = idOf((await newWave(m1, { title: 'Quiet', privacy: 'private' })).body);
  r.serverPublic.widen = (await api('PUT', `/api/waves/${quiet}`, { token: m1.token, body: { privacy: 'public' } })).body?.code;
  const staffQuiet = idOf((await newWave(staff, { title: 'Staff quiet', privacy: 'private' })).body);
  r.serverPublic.staffWidens = (await api('PUT', `/api/waves/${staffQuiet}`, { token: staff.token, body: { privacy: 'public' } })).status;

  // Moving a public wave out of its channel keeps it to its people.
  const leaving = idOf((await newWave(m1, { title: 'Leaving', privacy: 'public', channelId: general.id })).body);
  ok(await api('DELETE', `/api/communities/${cid}/channels/${general.id}/waves/${leaving}`, { token: m1.token }), 'unfile');
  r.unfiled = {
    privacy: (await api('GET', `/api/waves/${leaving}`, { token: m1.token })).body?.privacy,
    outsider: await read(outsider, leaving), member: await read(m2, leaving),
  };

  // ---- content.moderate ----
  const w = idOf((await newWave(m1, { title: 'Rehearsal', privacy: 'public', channelId: general.id })).body);
  const post = async (u, content) => {
    const res = await api('POST', '/api/pings', { token: u.token, body: { wave_id: w, content } });
    ok(res, `post by ${u.handle}`);
    return idOf(res.body);
  };
  const p1 = await post(m1, 'one');
  const p2 = await post(cadmin, 'two');
  const p4 = await post(m1, 'four');
  const flag = async (u) => (await api('GET', `/api/waves/${w}`, { token: u.token })).body?.can_remove_pings;
  r.flags = { cmod: await flag(cmod), m2: await flag(m2), m1: await flag(m1) };
  const del = async (u, p) => { const res = await api('DELETE', `/api/pings/${p}`, { token: u.token }); return res.body?.code || res.status; };
  r.remove = { member: await del(m2, p1), outranked: await del(cmod, p2), moderator: await del(cmod, p1) };

  // A custom role with the power, then a channel deny on it.
  const tidy = (await api('POST', `/api/communities/${cid}/roles`, { token: owner.token, body: { name: 'Tidy', priority: 150, permissions: ['content.moderate'] } })).body.role;
  ok(await api('PUT', `/api/communities/${cid}/members/${m2.id}/roles/${tidy.id}`, { token: owner.token }), 'give tidy');
  ok(await api('PUT', `/api/communities/${cid}/channels/${general.id}/roles/${tidy.id}`, { token: owner.token, body: { allow: [], deny: ['content.moderate'] } }), 'deny in channel');
  r.remove.denied = await del(m2, p4);
  ok(await api('DELETE', `/api/communities/${cid}/channels/${general.id}/roles/${tidy.id}`, { token: owner.token }), 'clear deny');
  r.remove.customRole = await del(m2, p4);

  // A narrowed wave the moderator cannot read.
  const inner = idOf((await newWave(owner, { title: 'Inner circle', privacy: 'public', channelId: general.id })).body);
  ok(await api('PUT', `/api/waves/${inner}/audience`, { token: owner.token, body: { mode: 'only', userIds: [m1.id] } }), 'narrow inner');
  const p5 = idOf((await api('POST', '/api/pings', { token: m1.token, body: { wave_id: inner, content: 'inside' } })).body);
  r.remove.cannotRead = await del(cmod, p5);
  r.remove.notInCommunity = await del(outsider, await post(m1, 'five'));

  // ---- event.manage ----
  const ev = await api('POST', '/api/events', { token: m1.token, body: { title: 'Read-through', eventDate: '2027-01-15', scope: 'wave', waveId: w } });
  ok(ev, 'event');
  const evId = idOf(ev.body);
  r.events = {
    moderator: (await api('PUT', `/api/events/${evId}`, { token: cmod.token, body: { title: 'Read-through (moved)' } })).status,
    tidyHasNoEventPower: (await api('PUT', `/api/events/${evId}`, { token: m2.token, body: { title: 'Nope' } })).status,
    outsider: (await api('PUT', `/api/events/${evId}`, { token: outsider.token, body: { title: 'Nope' } })).status,
  };

  // ---- the activity log ----
  const log = async (u) => (await api('GET', `/api/communities/${cid}/audit`, { token: u.token }));
  const ownerLog = (await log(owner)).body.entries;
  const modLog = (await log(cmod)).body.entries;
  const removal = ownerLog.find(e => e.action === 'ping.remove' && e.actor?.id === cmod.id);
  const narrowFor = (entries) => entries.find(e => e.action === 'wave.audience_narrow' && e.target?.id === inner);
  const grant = ownerLog.find(e => e.action === 'role.grant' && e.target?.id === m2.id);
  r.audit = {
    member: (await log(m1)).status,
    removal: removal && { actor: removal.actor.name, wave: removal.target.name, pingIdHidden: !('pingId' in (removal.details || {})) },
    narrowOwner: narrowFor(ownerLog)?.target?.name,
    narrowModerator: narrowFor(modLog)?.target?.name,
    grant: grant && { person: grant.target.name, role: grant.details?.role },
    deletedChannel: ownerLog.find(e => e.action === 'channel.delete')?.target?.gone,
  };
  return r;
}

async function run(opts, scenarioOpts) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-powers-'));
  const srv = await startServer(temp, opts);
  try { return await scenario(srv, scenarioOpts); }
  finally { srv.child.kill('SIGKILL'); fs.rmSync(temp, { recursive: true, force: true }); }
}

test('Community powers (v2.140.0)', { timeout: 180000 }, async (t) => {
  const r = await run({});

  await t.test('[SECURITY] deleting a channel keeps its waves to the people they were for', () => {
    assert.deepEqual(r.beforeDelete, { outsiderPublic: 403, adminLooksIn: 200 });
    assert.deepEqual(r.afterDelete, { outsiderPublic: 403, creator: 200, privacy: 'private', adminWhoLookedIn: 403, named: 200 });
  });

  await t.test('[SECURITY] closing a Community does too', () => {
    assert.deepEqual(r.afterClose, { outsider: 403, creator: 200 });
  });

  await t.test('only server moderators and admins open a wave to everyone on the server', () => {
    assert.deepEqual(r.serverPublic, {
      member: 'SERVER_PUBLIC_STAFF_ONLY', staff: 201, inChannel: 201,
      widen: 'SERVER_PUBLIC_STAFF_ONLY', staffWidens: 200,
    });
  });

  await t.test('a public wave moved out of its channel is kept to its people', () => {
    assert.deepEqual(r.unfiled, { privacy: 'private', outsider: 403, member: 403 });
  });

  await t.test('content.moderate removes pings by people ranked below, in waves you can read', () => {
    assert.deepEqual(r.flags, { cmod: true, m2: false, m1: true }); // m1 started it: wave staff
    assert.deepEqual(r.remove, {
      member: 403, outranked: 'OUTRANKED', moderator: 200,
      denied: 403, customRole: 200, cannotRead: 403, notInCommunity: 403,
    });
  });

  await t.test('event.manage runs the events in channel waves', () => {
    assert.deepEqual(r.events, { moderator: 200, tidyHasNoEventPower: 403, outsider: 403 });
  });

  await t.test('the activity log names people, and only what the reader could see', () => {
    assert.deepEqual(r.audit, {
      member: 403,
      removal: { actor: 'cmod', wave: 'Rehearsal', pingIdHidden: true },
      narrowOwner: 'Inner circle',
      narrowModerator: null,
      grant: { person: 'membertwo', role: 'Tidy' },
      deletedChannel: true,
    });
  });
});

test('counterfactual: without unfiling, a deleted channel opens its waves to the server', { timeout: 120000 }, async () => {
  const r = await run({ stripUnfile: true }, { full: false });
  if (process.env.DEBUG_POWERS) console.log(JSON.stringify(r));
  assert.equal(r.beforeDelete.outsiderPublic, 403);
  assert.equal(r.afterDelete.outsiderPublic, 200, 'the members-only wave became readable by every account');
  assert.equal(r.afterDelete.named, 403, 'and the person a narrowed wave was kept for, with no participant row, lost it');
  assert.equal(r.afterClose.outsider, 200, 'closing the Community did the same');
});
