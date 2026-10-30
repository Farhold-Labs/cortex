'use strict';

// Who can see a wave in a Community channel (v2.134.0, wave-access phase 4).
//
// A wave in a channel is open to the channel, or narrowed by the Community's
// owners and admins to named people and Community roles. Owners and admins
// always see narrowed waves; roles are live; participant rows never count;
// everyone named must be able to see the channel. Waves that had people who
// cannot see their channel when this shipped wait for the owner's review,
// keeping their old access until then: Move it out, or Make it a role (with
// or without inviting the people outside into the Community).
//
// Counterfactuals: with participant rows counting again, someone who opened a
// wave while it was open keeps it after it is narrowed; and without the
// clean-up on moving a wave out, an admin who only looked in keeps it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'WaveAudience123!';

async function startServer(temp, { stripRule = false, stripUnfile = false } = {}) {
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

  if (stripRule) {
    // Before v2.134.0: the channel decided only for public waves, and a
    // private wave in a channel followed its participant rows.
    const dbFile = path.join(serverDir, 'database-sqlite.js');
    let d = fs.readFileSync(dbFile, 'utf8');
    const rule = "return { kind: isPublic ? 'public' : 'narrowed', channel };";
    assert.ok(d.includes(rule), 'counterfactual: could not find the narrowed rule');
    d = d.replace(rule, "return isPublic ? { kind: 'public', channel } : null;");
    fs.writeFileSync(dbFile, d);
  }
  if (stripUnfile) {
    const srvFile = path.join(serverDir, 'server.js');
    let s = fs.readFileSync(srvFile, 'utf8');
    const cleanup = 'if (!keep.has(uid)) participation.removeParticipant(wave.id, uid);';
    assert.ok(s.includes(cleanup), 'counterfactual: could not find the unfile clean-up');
    s = s.replace(cleanup, '');
    fs.writeFileSync(srvFile, s);
  }

  {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    seed.updateInstanceConfig({ features: { communities: true } });
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
async function asBeforeNarrowing(dbPath, raw = () => {}) {
  const Database = require(path.join(root, 'server/node_modules/better-sqlite3'));
  const conn = new Database(dbPath);
  raw(conn);
  conn.prepare('DELETE FROM wave_audience WHERE wave_id IN (SELECT id FROM waves WHERE channel_id IS NOT NULL)').run();
  conn.prepare('UPDATE waves SET review_state = NULL WHERE channel_id IS NOT NULL').run();
  conn.close();
  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const db = new DatabaseSQLite({ dbPath });
  const result = db.migrateChannelWaveAudiences();
  db.db.close();
  return result;
}

async function scenario({ api, makeUser, dbPath }) {
  await makeUser('nodeadmin');
  const mal = await makeUser('mal');          // Community owner
  const inara = await makeUser('inara');      // Community admin
  const zoe = await makeUser('zoe');          // member, named
  const wash = await makeUser('wash');        // member who opened the wave while it was open
  const kaylee = await makeUser('kaylee');    // member holding the named role
  const jayne = await makeUser('jayne');      // member, not named
  const outsider = await makeUser('outsider');
  const river = await makeUser('river');      // outside the Community, in old waves
  const r = {};
  const ok = (res, what) => assert.ok(res.status < 300, `${what}: ${res.status} ${JSON.stringify(res.body)}`);
  const read = async (u, waveId) => (await api('GET', `/api/waves/${waveId}`, { token: u.token })).status;
  const listed = async (u, waveId, q = '') => {
    const res = await api('GET', `/api/waves${q}`, { token: u.token });
    return (Array.isArray(res.body) ? res.body : res.body.waves || []).some(w => w.id === waveId);
  };
  const acceptWaveInvite = async (u, waveId) => {
    const inv = ((await api('GET', '/api/wave-invitations', { token: u.token })).body.invitations || []).find(i => i.waveId === waveId);
    assert.ok(inv, `${u.handle} was invited`);
    ok(await api('POST', `/api/wave-invitations/${inv.id}/accept`, { token: u.token }), 'accept');
  };

  const community = (await api('POST', '/api/communities', { token: mal.token, body: { name: 'Serenity', slug: 'serenity', visibility: 'private' } })).body.community;
  for (const h of ['inara', 'zoe', 'wash', 'kaylee', 'jayne']) {
    ok(await api('POST', `/api/communities/${community.id}/members`, { token: mal.token, body: { handle: h } }), `add ${h}`);
  }
  const roles = (await api('GET', `/api/communities/${community.id}/roles`, { token: mal.token })).body.roles;
  const adminRole = roles.find(x => x.name === 'admin');
  ok(await api('PUT', `/api/communities/${community.id}/members/${inara.id}/roles/${adminRole.id}`, { token: mal.token }), 'make inara admin');
  const pilots = (await api('POST', `/api/communities/${community.id}/roles`, { token: mal.token, body: { name: 'Pilots' } })).body.role;
  ok(await api('PUT', `/api/communities/${community.id}/members/${kaylee.id}/roles/${pilots.id}`, { token: mal.token }), 'grant pilots');
  const channel = (await api('POST', `/api/communities/${community.id}/channels`, { token: mal.token, body: { name: 'General', slug: 'general' } })).body.channel;

  // 1. Only owners and admins start a wave only some people see.
  r.memberNarrowStart = (await api('POST', '/api/waves', { token: jayne.token, body: { title: 'Mine', privacy: 'private', channelId: channel.id } })).status;

  // 2. An open wave, which wash opens and posts in (a participant row) before
  // it is narrowed.
  const plans = (await api('POST', '/api/waves', { token: mal.token, body: { title: 'Plans', privacy: 'public', channelId: channel.id } })).body;
  r.washOpenBefore = await read(wash, plans.id);
  await api('POST', `/api/waves/${plans.id}/read`, { token: wash.token });
  // Posting in an open wave makes the poster a participant.
  ok(await api('POST', '/api/pings', { token: wash.token, body: { wave_id: plans.id, content: 'count me in' } }), 'wash posts');

  // 3. Narrowing: refused to a member; refused for anyone who cannot see the
  // channel, with the same answer as for nobody at all.
  r.memberNarrow = (await api('PUT', `/api/waves/${plans.id}/audience`, { token: jayne.token, body: { mode: 'only', userIds: [jayne.id] } })).status;
  const named = (ids) => api('PUT', `/api/waves/${plans.id}/audience`, { token: mal.token, body: { mode: 'only', userIds: ids } });
  const nOutsider = await named([zoe.id, outsider.id]);
  const nNobody = await named([zoe.id, 'user-does-not-exist']);
  r.nameOutsider = nOutsider.status;
  r.sameRefusal = JSON.stringify(nOutsider.body) === JSON.stringify(nNobody.body);
  const narrowed = await api('PUT', `/api/waves/${plans.id}/audience`, { token: mal.token, body: { mode: 'only', userIds: [zoe.id], roleIds: [pilots.id] } });
  r.narrow = narrowed.status;
  r.narrowedView = narrowed.body;

  r.reads = {};
  for (const u of [mal, inara, zoe, wash, kaylee, jayne, outsider]) r.reads[u.handle] = await read(u, plans.id);
  r.lists = {
    inara: await listed(inara, plans.id),
    zoe: await listed(zoe, plans.id),
    zoeMinimal: await listed(zoe, plans.id, '?minimal=true'),
    kayleeMinimal: await listed(kaylee, plans.id, '?minimal=true'),
    wash: await listed(wash, plans.id),
    jayne: await listed(jayne, plans.id),
  };
  r.audienceView = (await api('GET', `/api/waves/${plans.id}/audience`, { token: zoe.token })).body;
  r.privacyViaSettings = (await api('PUT', `/api/waves/${plans.id}`, { token: mal.token, body: { privacy: 'public' } })).status;

  // 4. @everyone reaches the audience, nobody else.
  ok(await api('POST', '/api/pings', { token: mal.token, body: { wave_id: plans.id, content: 'AUDWORD @everyone' } }), 'post');
  await new Promise(res => setTimeout(res, 300));
  const heard = async (u) => JSON.stringify((await api('GET', '/api/notifications?limit=50', { token: u.token })).body || '').includes('AUDWORD');
  r.heard = { zoe: await heard(zoe), kaylee: await heard(kaylee), wash: await heard(wash), jayne: await heard(jayne) };

  // 5. Roles are live.
  ok(await api('DELETE', `/api/communities/${community.id}/members/${kaylee.id}/roles/${pilots.id}`, { token: mal.token }), 'revoke pilots');
  ok(await api('PUT', `/api/communities/${community.id}/members/${jayne.id}/roles/${pilots.id}`, { token: mal.token }), 'grant jayne');
  r.kayleeAfterRevoke = await read(kaylee, plans.id);
  r.jayneAfterGrant = await read(jayne, plans.id);

  // 6. Adding someone names them, and only owners and admins may.
  r.memberAdds = (await api('POST', `/api/waves/${plans.id}/participants`, { token: zoe.token, body: { userId: wash.id } })).status;
  r.adminAdds = (await api('POST', `/api/waves/${plans.id}/participants`, { token: inara.token, body: { userId: wash.id } })).status;
  r.washAfterAdd = await read(wash, plans.id);

  // 7. Leaving is losing your name in it.
  r.zoeLeaves = (await api('DELETE', `/api/waves/${plans.id}/participants/${zoe.id}`, { token: zoe.token })).status;
  r.zoeAfterLeave = await read(zoe, plans.id);

  // 8. Widening back to the channel.
  r.widen = (await api('PUT', `/api/waves/${plans.id}/audience`, { token: mal.token, body: { mode: 'channel' } })).status;
  r.zoeAfterWiden = await read(zoe, plans.id);
  r.kayleeAfterWiden = await read(kaylee, plans.id);

  // 9. Moving a narrowed wave out: its named people keep it; an admin who
  // only looked in does not.
  // Inara posted while it was open, so she has a participant row; then it
  // was narrowed to zoe.
  const quiet = (await api('POST', '/api/waves', { token: mal.token, body: { title: 'Quiet', privacy: 'public', channelId: channel.id, participants: [zoe.id] } })).body;
  ok(await api('POST', '/api/pings', { token: inara.token, body: { wave_id: quiet.id, content: 'hello' } }), 'inara posts');
  ok(await api('PUT', `/api/waves/${quiet.id}/audience`, { token: mal.token, body: { mode: 'only', userIds: [zoe.id] } }), 'narrow quiet');
  r.inaraQuietBefore = await read(inara, quiet.id);
  ok(await api('DELETE', `/api/communities/${community.id}/channels/${channel.id}/waves/${quiet.id}`, { token: mal.token }), 'unfile');
  r.quietAfterUnfile = { zoe: await read(zoe, quiet.id), inara: await read(inara, quiet.id), mal: await read(mal, quiet.id) };

  // 10. Waves from before v2.134.0 with people who cannot see the channel.
  const crew = (await api('POST', '/api/groups', { token: mal.token, body: { name: 'Deck crew' } })).body;
  const crewId = crew.id || crew.group?.id;
  for (const u of [zoe, river]) {
    await api('POST', `/api/groups/${crewId}/invite`, { token: mal.token, body: { userIds: [u.id] } });
    const inv = ((await api('GET', '/api/groups/invitations', { token: u.token })).body || []).find(i => i.group_id === crewId);
    ok(await api('POST', `/api/groups/invitations/${inv.id}/accept`, { token: u.token }), 'crew accept');
  }
  const deck = (await api('POST', '/api/waves', { token: mal.token, body: { title: 'Deck', privacy: 'group', groupId: crewId } })).body;
  const oldWays = (await api('POST', '/api/waves', { token: mal.token, body: { title: 'Old ways', privacy: 'private', participants: [zoe.id, river.id] } })).body;
  const leaving = (await api('POST', '/api/waves', { token: mal.token, body: { title: 'Leaving', privacy: 'private', participants: [river.id] } })).body;
  for (const w of [oldWays, leaving]) await acceptWaveInvite(river, w.id);
  await acceptWaveInvite(zoe, oldWays.id);
  r.migration = await asBeforeNarrowing(dbPath, (conn) => {
    for (const w of [deck, oldWays, leaving]) {
      conn.prepare('UPDATE waves SET channel_id = ?, community_id = ? WHERE id = ?').run(channel.id, community.id, w.id);
    }
  });
  r.reportBefore = (await api('GET', `/api/communities/${community.id}/wave-report`, { token: mal.token })).body?.totals;
  r.riverInReview = { deck: await read(river, deck.id), oldWays: await read(river, oldWays.id) };
  r.audienceInReview = (await api('PUT', `/api/waves/${deck.id}/audience`, { token: mal.token, body: { mode: 'channel' } })).status;
  const review = (u, w, body) => api('POST', `/api/communities/${community.id}/waves/${w.id}/review`, { token: u.token, body });
  r.memberReview = (await review(zoe, oldWays, { action: 'move_out' })).status;

  const oldWaysDone = await review(mal, oldWays, { action: 'make_role' });
  r.oldWaysDone = { status: oldWaysDone.status, inside: oldWaysDone.body?.inside, outside: oldWaysDone.body?.outside };
  r.afterOldWays = { river: await read(river, oldWays.id), zoe: await read(zoe, oldWays.id), jayne: await read(jayne, oldWays.id) };

  const leavingDone = await review(inara, leaving, { action: 'move_out' });
  r.leavingDone = leavingDone.status;
  r.afterLeaving = { river: await read(river, leaving.id), channelId: leavingDone.body?.wave?.channel_id ?? null };

  const deckDone = await review(mal, deck, { action: 'make_role', invite: true });
  r.deckDone = { status: deckDone.status, role: deckDone.body?.role?.name, invited: deckDone.body?.invited };
  r.afterDeck = { river: await read(river, deck.id), zoe: await read(zoe, deck.id) };
  const invitations = (await api('GET', '/api/community-invitations', { token: river.token })).body.invitations || [];
  r.riverInvited = invitations.some(i => i.communityId === community.id && i.communityName === 'Serenity');
  r.riverAccepts = (await api('POST', `/api/community-invitations/${community.id}/accept`, { token: river.token })).status;
  r.afterAccept = { deck: await read(river, deck.id), oldWays: await read(river, oldWays.id) };
  r.reportAfter = (await api('GET', `/api/communities/${community.id}/wave-report`, { token: mal.token })).body?.totals;
  r.again = (await review(mal, deck, { action: 'move_out' })).status;
  return r;
}

async function run(opts) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-audience-'));
  const srv = await startServer(temp, opts);
  try { return await scenario(srv); }
  finally { srv.child.kill(); fs.rmSync(temp, { recursive: true, force: true }); }
}

test('who can see a Community wave: narrowing, roles, review', { timeout: 180000 }, async (t) => {
  const r = await run();

  await t.test('only owners and admins narrow a wave', () => {
    assert.equal(r.memberNarrowStart, 403);
    assert.equal(r.memberNarrow, 403);
    assert.equal(r.narrow, 200, JSON.stringify(r.narrowedView));
  });

  await t.test('nobody who cannot see the channel can be named, and the refusal does not say who exists', () => {
    assert.equal(r.nameOutsider, 400);
    assert.equal(r.sameRefusal, true);
  });

  await t.test('a narrowed wave admits its audience and the Community admins, and nobody else', () => {
    assert.deepEqual(r.reads, { mal: 200, inara: 200, zoe: 200, wash: 403, kaylee: 200, jayne: 403, outsider: 403 });
    assert.equal(r.washOpenBefore, 200, 'wash could read it while it was open');
    assert.deepEqual(r.lists, { inara: true, zoe: true, zoeMinimal: true, kayleeMinimal: true, wash: false, jayne: false });
  });

  await t.test('the person narrowing it is named, and everyone sees who can', () => {
    const names = (r.narrowedView.users || []).map(u => u.handle).sort();
    assert.deepEqual(names, ['mal', 'zoe']);
    assert.deepEqual((r.narrowedView.roles || []).map(x => x.name), ['Pilots']);
    assert.equal(r.audienceView.mode, 'only');
    assert.equal(r.audienceView.canEdit, false, 'a named member cannot change it');
    assert.equal(r.privacyViaSettings, 409, 'the wave settings cannot widen it around the admins');
  });

  await t.test('@everyone reaches the audience only', () => {
    assert.deepEqual(r.heard, { zoe: true, kaylee: true, wash: false, jayne: false });
  });

  await t.test('roles are live', () => {
    assert.equal(r.kayleeAfterRevoke, 403);
    assert.equal(r.jayneAfterGrant, 200);
  });

  await t.test('adding someone names them; only owners and admins may', () => {
    assert.equal(r.memberAdds, 403);
    assert.equal(r.adminAdds, 200);
    assert.equal(r.washAfterAdd, 200);
  });

  await t.test('leaving a narrowed wave is losing your name in it', () => {
    assert.equal(r.zoeLeaves, 200);
    assert.equal(r.zoeAfterLeave, 403);
  });

  await t.test('widening gives it back to the channel', () => {
    assert.equal(r.widen, 200);
    assert.equal(r.zoeAfterWiden, 200);
    assert.equal(r.kayleeAfterWiden, 200);
  });

  await t.test('a narrowed wave moved out keeps its people, not the admins who looked in', () => {
    assert.equal(r.inaraQuietBefore, 200);
    assert.deepEqual(r.quietAfterUnfile, { zoe: 200, inara: 403, mal: 200 });
  });

  await t.test('old waves with outsiders wait for review and keep their access', () => {
    assert.deepEqual(r.migration, { narrowed: 0, review: 3 });
    assert.deepEqual(r.reportBefore, { waves: 3, outsiders: 1 });
    assert.deepEqual(r.riverInReview, { deck: 200, oldWays: 200 });
    assert.equal(r.audienceInReview, 409);
    assert.equal(r.memberReview, 403);
  });

  await t.test('make it a role (a hand-picked wave): narrowed to its people inside', () => {
    assert.deepEqual(r.oldWaysDone, { status: 200, inside: 2, outside: 1 });
    assert.deepEqual(r.afterOldWays, { river: 403, zoe: 200, jayne: 403 });
  });

  await t.test('move it out: nobody gains or loses', () => {
    assert.equal(r.leavingDone, 200);
    assert.deepEqual(r.afterLeaving, { river: 200, channelId: null });
  });

  await t.test('make it a role with invitations: the outsider keeps it by joining', () => {
    assert.deepEqual(r.deckDone, { status: 200, role: 'Deck crew', invited: 1 });
    assert.deepEqual(r.afterDeck, { river: 403, zoe: 200 });
    assert.equal(r.riverInvited, true);
    assert.equal(r.riverAccepts, 200);
    assert.deepEqual(r.afterAccept, { deck: 200, oldWays: 403 });
    assert.deepEqual(r.reportAfter, { waves: 0, outsiders: 0 });
    assert.equal(r.again, 409, 'a decided wave is not decided twice');
  });
});

test('counterfactual: with participant rows counting, a wave narrowed after someone opened it stays theirs', { timeout: 180000 }, async () => {
  const r = await run({ stripRule: true });
  assert.equal(r.reads.wash, 200, 'the reader of the open wave kept it');
  assert.equal(r.reads.kaylee, 403, 'and the role named in it meant nothing');
});

test('counterfactual: without the clean-up, an admin who looked into a narrowed wave keeps it after it is moved out', { timeout: 180000 }, async () => {
  const r = await run({ stripUnfile: true });
  assert.equal(r.quietAfterUnfile.inara, 200);
});
