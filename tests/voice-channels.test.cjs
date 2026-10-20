'use strict';

// Voice channels (v2.118.0): docs/communities/03-voice-channels.md.
//
// Disposable servers against a fake LiveKit. The tokens the server signs are
// decoded, because their grants ARE the access control — which room, and which
// sources may be published. Webhooks are signed with the real SDK and the
// test's API secret, exactly as LiveKit signs them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const KEY = 'APIvoicetestkey';
const SECRET = 'voicetestsecretvoicetestsecret12345';
const password = 'Voice123!';
const grants = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sdk = () => import(path.join(root, 'server/node_modules/livekit-server-sdk/dist/index.js'));

// ---------------------------------------------------------------- fake LiveKit

function fakeLiveKit() {
  // room → Map(identity → { identity, name, joinedAt, tracks: [{ sid, source, muted }] })
  const rooms = new Map();
  // room name → LiveKit's session id. A room keeps its id until it is deleted.
  const sids = new Map();
  // room + identity → when they were removed. LiveKit refuses ("invalid token:
  // revoked") any later token for them there that is dated before that.
  const removedAt = new Map();
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const m = /^\/twirp\/livekit\.RoomService\/(\w+)$/.exec(req.url);
      const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (!m) { res.writeHead(404); return res.end(); }
      const data = body ? JSON.parse(body) : {};
      calls.push({ method: m[1], data });
      const people = (room) => [...(rooms.get(room)?.values() || [])];
      switch (m[1]) {
        case 'ListRooms':
          return json({ rooms: [...rooms.keys()].map(name => ({ name, numParticipants: rooms.get(name).size })) });
        case 'ListParticipants':
          return json({ participants: people(data.room) });
        case 'GetParticipant': {
          const p = rooms.get(data.room)?.get(data.identity);
          if (!p) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ code: 'not_found', msg: 'participant not found' })); }
          return json(p);
        }
        case 'RemoveParticipant':
          // Fillers stand in for a crowd of members. They are not members, so
          // the access re-check rightly tries to remove them; refusing keeps
          // them in the roster so the room can be full.
          if (String(data.identity).startsWith('filler-')) { res.writeHead(500, { 'Content-Type': 'application/json' }); return res.end('{"code":"internal","msg":"no"}'); }
          rooms.get(data.room)?.delete(data.identity);
          removedAt.set(`${data.room}|${data.identity}`, Date.now());
          if (rooms.get(data.room)?.size === 0) rooms.delete(data.room);
          return json({});
        case 'MutePublishedTrack':
          return json({ track: { sid: data.trackSid, muted: data.muted } });
        case 'CreateRoom':
          if (!sids.has(data.name)) sids.set(data.name, `RM_${crypto.randomBytes(6).toString('hex')}`);
          return json({ name: data.name, sid: sids.get(data.name), maxParticipants: data.maxParticipants });
        case 'DeleteRoom':
          rooms.delete(data.room);
          sids.delete(data.room);
          return json({});
        case 'UpdateParticipant': {
          const p = rooms.get(data.room)?.get(data.identity);
          if (!p) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ code: 'not_found', msg: 'participant not found' })); }
          if (data.metadata !== undefined) p.metadata = data.metadata;
          if (data.permission) p.permission = data.permission;
          return json(p);
        }
        default:
          return json({});
      }
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({
    server, rooms, calls,
    url: `http://127.0.0.1:${server.address().port}`,
    put(room, identity, tracks = []) {
      if (!rooms.has(room)) rooms.set(room, new Map());
      rooms.get(room).set(identity, { identity, name: identity, joinedAt: String(Math.floor(Date.now() / 1000)), tracks });
    },
    removed(room, identity) {
      return calls.some(c => c.method === 'RemoveParticipant' && c.data.room === room && c.data.identity === identity);
    },
    /** The last publish permission LiveKit was given for someone, or undefined. */
    permission(room, identity) {
      const c = calls.filter(c => c.method === 'UpdateParticipant' && c.data.room === room && c.data.identity === identity && c.data.permission).pop();
      return c?.data.permission;
    },
    sids,
    /** Would LiveKit let this token join? Its signature, and LiveKit's revocation rule. */
    async accepts(token) {
      const { TokenVerifier } = await sdk();
      const claims = await new TokenVerifier(KEY, SECRET).verify(token);
      const removed = removedAt.get(`${claims.video.room}|${claims.sub}`);
      return !(removed && (Number(claims.nbf) || 0) * 1000 < removed);
    },
  })));
}

// ---------------------------------------------------------------- server

async function startServer(livekitUrl, { env = {}, mutate } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-voice-'));
  const serverDir = path.join(temp, 'server');
  fs.mkdirSync(serverDir);
  for (const name of fs.readdirSync(path.join(root, 'server'))) {
    if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
  }
  fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
  fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(serverDir, 'data'));

  const { DatabaseSQLite } = await import(path.join(serverDir, 'database-sqlite.js'));
  const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
  seed.updateInstanceConfig({ features: { communities: true, voiceChannels: true } });
  seed.db.close();

  let source = fs.readFileSync(path.join(serverDir, 'server.js'), 'utf8');
  if (mutate) source = mutate(source);
  fs.writeFileSync(path.join(serverDir, 'server.js'), source + "\nserver.on('listening', () => console.log('VOICE_TEST_PORT=' + server.address().port));\n");

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-voice-channels-000000', SEED_DEMO_DATA: 'false',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      LIVEKIT_URL: livekitUrl, LIVEKIT_API_KEY: KEY, LIVEKIT_API_SECRET: SECRET,
      VOICE_TICK_MS: '60000', VOICE_ALONE_MINUTES: '0', VOICE_IDLE_MINUTES: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 25000;
  while (!/VOICE_TEST_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await sleep(50);
  }
  const base = `http://127.0.0.1:${output.match(/VOICE_TEST_PORT=(\d+)/)[1]}`;

  const api = async (method, urlPath, { token, body, headers = {}, raw } = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let json = null; try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json };
  };
  const makeUser = async (handle) => {
    await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
    const login = await api('POST', '/api/auth/login', { body: { handle, password } });
    assert.equal(login.status, 200, `login ${handle}: ${JSON.stringify(login.body)}`);
    return { token: login.body.token, id: login.body.user.id, handle };
  };
  const webhook = async (event, { secret = SECRET } = {}) => {
    const { AccessToken } = await sdk();
    const body = JSON.stringify({ id: crypto.randomUUID(), createdAt: String(Math.floor(Date.now() / 1000)), ...event });
    const at = new AccessToken(KEY, secret);
    at.sha256 = crypto.createHash('sha256').update(body).digest('base64');
    const jwt = await at.toJwt();
    return api('POST', '/api/livekit/webhook', { raw: body, headers: { 'Content-Type': 'application/webhook+json', Authorization: jwt } });
  };
  const socket = async (token) => {
    const WebSocket = require(path.join(root, 'server/node_modules/ws'));
    const ws = new WebSocket(base.replace('http://', 'ws://'));
    const messages = [];
    await new Promise((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token })));
      ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw); } catch { return; }
        messages.push(m);
        if (m.type === 'auth_success') resolve();
        if (m.type === 'auth_error') reject(new Error('ws auth failed'));
      });
      ws.on('error', reject);
    });
    return { ws, messages, close: () => ws.close() };
  };
  const stop = () => { child.kill('SIGKILL'); fs.rmSync(temp, { recursive: true, force: true }); };
  return { base, api, makeUser, webhook, socket, stop, output: () => output, dbPath: path.join(serverDir, 'data/farhold.db') };
}

/** Owner, member, moderator and outsider; a Community with a voice channel. */
async function setupCommunity(s) {
  const owner = await s.makeUser('owner1');
  const member = await s.makeUser('member1');
  const mod = await s.makeUser('mod1');
  const outsider = await s.makeUser('outsider1');
  const c = await s.api('POST', '/api/communities', { token: owner.token, body: { name: 'Lounge Club', slug: 'lounge-club', visibility: 'private' } });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const communityId = c.body.community.id;
  for (const u of [member, mod]) {
    const add = await s.api('POST', `/api/communities/${communityId}/members`, { token: owner.token, body: { userId: u.id } });
    assert.equal(add.status, 201, JSON.stringify(add.body));
  }
  const roles = (await s.api('GET', `/api/communities/${communityId}/roles`, { token: owner.token })).body.roles;
  const role = (name) => roles.find(r => r.name === name);
  const grant = await s.api('PUT', `/api/communities/${communityId}/members/${mod.id}/roles/${role('moderator').id}`, { token: owner.token });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));
  const ch = await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'Lounge', type: 'voice' } });
  assert.equal(ch.status, 201, JSON.stringify(ch.body));
  return { owner, member, mod, outsider, communityId, voice: ch.body.channel, role };
}

const joined = (room, identity) => ({ event: 'participant_joined', room: { name: room }, participant: { identity, name: identity } });

// ---------------------------------------------------------------- the database

test('the channels rebuild keeps every reference and grants voice to existing roles once', { timeout: 60000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-voice-mig-'));
  try {
    const serverDir = path.join(temp, 'server');
    fs.mkdirSync(serverDir);
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));
    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import(path.join(serverDir, 'database-sqlite.js'));

    // A node as it was before v2.118.0: build it, then put the old CHECK back
    // and take the voice capabilities out of the roles.
    let d = new DatabaseSQLite({ dbPath });
    d.createUser({ id: 'u1', handle: 'u1', email: 'u1@example.test', passwordHash: 'x', displayName: 'u1' });
    const community = d.createCommunity({ name: 'Old Club', slug: 'old-club', createdBy: 'u1' });
    const channel = d.createChannel({ communityId: community.id, name: 'general', slug: 'general', createdBy: 'u1' });
    const wave = d.createWave({ title: 'Filed', createdBy: 'u1', participants: [], privacy: 'private' });
    d.setWaveChannel(wave.id, channel.id);
    const memberRole = d.getCommunityRole(community.id, 'member');
    d.setChannelPermission(channel.id, memberRole.id, { allow: [], deny: ['channel.create_wave'] });
    const raw = d.db;
    raw.pragma('foreign_keys = OFF');
    const oldSql = raw.prepare(`SELECT sql FROM sqlite_master WHERE name='channels'`).get().sql.replace("'announcement','voice'", "'announcement'");
    // Swapped the way the migration swaps (new table, drop, rename), so the
    // other tables' references to "channels" are left exactly as they were.
    raw.exec(`${oldSql.replace(/CREATE TABLE (IF NOT EXISTS )?"?channels"?/, 'CREATE TABLE channels_old_shape')};
              INSERT INTO channels_old_shape SELECT * FROM channels; DROP TABLE channels;
              ALTER TABLE channels_old_shape RENAME TO channels;`);
    // An orphan elsewhere, as a long-lived node may have. It must not block the
    // migration — only references the rebuild itself breaks may.
    raw.prepare(`INSERT INTO channel_permissions (channel_id, role_id, allow, deny) VALUES ('no-such-channel', ?, '[]', '[]')`).run(memberRole.id);
    for (const r of raw.prepare('SELECT id, permissions FROM community_roles').all()) {
      raw.prepare('UPDATE community_roles SET permissions = ? WHERE id = ?')
        .run(JSON.stringify(JSON.parse(r.permissions).filter(c => !c.startsWith('voice.'))), r.id);
    }
    raw.pragma('foreign_keys = ON');
    assert.ok(!raw.prepare(`SELECT sql FROM sqlite_master WHERE name='channels'`).get().sql.includes("'voice'"), 'precondition: old schema');
    raw.close();

    d = new DatabaseSQLite({ dbPath });
    assert.ok(d.db.prepare(`SELECT sql FROM sqlite_master WHERE name='channels'`).get().sql.includes("'voice'"));
    assert.equal(d.getWave(wave.id).channelId, channel.id, 'a filed wave stays filed');
    assert.ok(d.getChannelPermission(channel.id, memberRole.id), 'channel overrides survive');
    assert.equal(d.db.pragma('foreign_key_check').length, 1, 'only the orphan that was already there');
    const perms = (name) => JSON.parse(d.db.prepare('SELECT permissions FROM community_roles WHERE community_id = ? AND name = ?').get(community.id, name).permissions);
    assert.ok(perms('member').includes('voice.screen'), 'members get screen sharing by default');
    assert.ok(!perms('member').includes('voice.moderate'));
    assert.ok(perms('moderator').includes('voice.moderate'));
    assert.ok(d.createChannel({ communityId: community.id, name: 'Voice', slug: 'voice', type: 'voice' }));

    // A Community takes screen sharing away. The grant must not come back.
    d.db.prepare('UPDATE community_roles SET permissions = ? WHERE community_id = ? AND name = ?')
      .run(JSON.stringify(perms('member').filter(c => c !== 'voice.screen')), community.id, 'member');
    d.db.close();
    d = new DatabaseSQLite({ dbPath });
    assert.ok(!perms('member').includes('voice.screen'), 'a capability taken away stays away on the next boot');
    d.db.close();
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- the routes

test('Voice channels', { timeout: 180000 }, async (t) => {
  const lk = await fakeLiveKit();
  const s = await startServer(lk.url);
  try {
    const { owner, member, mod, outsider, communityId, voice, role } = await setupCommunity(s);
    const room = `vc-${voice.id}`;
    const tokenFor = (u, channelId = voice.id) => s.api('POST', `/api/communities/${communityId}/channels/${channelId}/voice/token`, { token: u.token });

    await t.test('a member gets a token for the channel\'s own room, joining muted', async () => {
      const res = await tokenFor(member);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const g = grants(res.body.token);
      assert.equal(g.video.room, room);
      assert.equal(g.sub, member.id);
      assert.equal(g.video.canSubscribe, true);
      assert.equal(g.video.canPublish, true);
      assert.deepEqual(g.video.canPublishSources.sort(), ['camera', 'microphone', 'screen_share', 'screen_share_audio']);
      assert.ok(g.exp - g.nbf <= 600 || g.exp - Math.floor(Date.now() / 1000) <= 600, 'a short-lived token');
      assert.equal(res.body.startMuted, true);
      assert.deepEqual(res.body.can, { speak: true, video: true, screen: true, moderate: false });
      // Sent after the response, so give it a moment.
      const created = () => lk.calls.some(c => c.method === 'CreateRoom' && c.data.name === room && Number(c.data.maxParticipants) === 25);
      for (let i = 0; i < 40 && !created(); i++) await sleep(25);
      assert.ok(created(), JSON.stringify(lk.calls.filter(c => c.method === 'CreateRoom')));
    });

    await t.test('someone outside the Community cannot learn the channel exists', async () => {
      assert.equal((await tokenFor(outsider)).status, 404);
      assert.equal((await s.api('GET', `/api/communities/${communityId}/voice`, { token: outsider.token })).status, 404);
    });

    await t.test('a channel deny on screen sharing removes it from the token', async () => {
      const set = await s.api('PUT', `/api/communities/${communityId}/channels/${voice.id}/roles/${role('member').id}`,
        { token: owner.token, body: { allow: [], deny: ['voice.screen'] } });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      const g = grants((await tokenFor(member)).body.token);
      assert.deepEqual(g.video.canPublishSources.sort(), ['camera', 'microphone']);
    });

    await t.test('allowed to publish nothing means canPublish false — never an empty list, which LiveKit reads as "anything"', async () => {
      await s.api('PUT', `/api/communities/${communityId}/channels/${voice.id}/roles/${role('member').id}`,
        { token: owner.token, body: { allow: [], deny: ['voice.speak', 'voice.video', 'voice.screen'] } });
      const res = await tokenFor(member);
      assert.equal(res.status, 200);
      const g = grants(res.body.token);
      assert.equal(g.video.canPublish, false);
      assert.ok(!g.video.canPublishSources?.length, 'no list at all, never an empty one standing for "anything"');
      await s.api('DELETE', `/api/communities/${communityId}/channels/${voice.id}/roles/${role('member').id}`, { token: owner.token });
    });

    await t.test('without voice.connect there is no token', async () => {
      await s.api('PUT', `/api/communities/${communityId}/channels/${voice.id}/roles/${role('member').id}`,
        { token: owner.token, body: { allow: [], deny: ['voice.connect'] } });
      assert.equal((await tokenFor(member)).status, 403);
      await s.api('DELETE', `/api/communities/${communityId}/channels/${voice.id}/roles/${role('member').id}`, { token: owner.token });
      assert.equal((await tokenFor(member)).status, 200);
    });

    await t.test('a restricted voice channel is invisible to members not let in', async () => {
      const r = await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'Staff Room', type: 'voice', visibility: 'restricted' } });
      assert.equal(r.status, 201);
      assert.equal((await tokenFor(member, r.body.channel.id)).status, 404);
      const presence = (await s.api('GET', `/api/communities/${communityId}/voice`, { token: member.token })).body.channels;
      assert.ok(!(r.body.channel.id in presence), 'not even listed with an empty roster');
      assert.ok(voice.id in presence);
    });

    await t.test('voice channels hold no waves, and a channel cannot be converted to or from voice', async () => {
      const text = (await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'Chat' } })).body.channel;
      assert.equal(text.type, 'text');
      assert.equal((await tokenFor(member, text.id)).status, 400);
      assert.equal((await s.api('PATCH', `/api/communities/${communityId}/channels/${text.id}`, { token: owner.token, body: { type: 'voice' } })).status, 400);
      assert.equal((await s.api('PATCH', `/api/communities/${communityId}/channels/${voice.id}`, { token: owner.token, body: { type: 'text' } })).status, 400);
      const made = await s.api('POST', '/api/waves', { token: member.token, body: { title: 'Nope', privacy: 'private', participants: [], channelId: voice.id } });
      assert.equal(made.status, 409, JSON.stringify(made.body));
      const w = await s.api('POST', '/api/waves', { token: owner.token, body: { title: 'Mine', privacy: 'private', participants: [] } });
      const waveId = w.body.id || w.body.wave?.id;
      assert.equal((await s.api('PUT', `/api/communities/${communityId}/channels/${voice.id}/waves/${waveId}`, { token: owner.token })).status, 409);
      assert.equal((await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'Odd', type: 'video' } })).status, 400);
    });

    await t.test('an unsigned or wrongly signed webhook changes nothing', async () => {
      const forged = await s.webhook(joined(room, outsider.id), { secret: 'not-the-secret-not-the-secret-000000' });
      assert.equal(forged.status, 401);
      const unsigned = await s.api('POST', '/api/livekit/webhook', { raw: JSON.stringify(joined(room, outsider.id)), headers: { 'Content-Type': 'application/webhook+json' } });
      assert.equal(unsigned.status, 401);
      const presence = (await s.api('GET', `/api/communities/${communityId}/voice`, { token: member.token })).body.channels[voice.id];
      assert.deepEqual(presence, []);
    });

    await t.test('presence: a join is listed and pushed to members who can see the channel, and only to them', async () => {
      const watcher = await s.socket(owner.token);
      const stranger = await s.socket(outsider.token);
      try {
        lk.put(room, member.id, [{ sid: 'TR_mic1', source: 2, muted: true }]);
        assert.equal((await s.webhook(joined(room, member.id))).status, 200);
        await sleep(300);
        const presence = (await s.api('GET', `/api/communities/${communityId}/voice`, { token: owner.token })).body.channels[voice.id];
        assert.deepEqual(presence.map(p => p.userId), [member.id]);
        assert.equal(presence[0].handle, 'member1');
        const pushed = watcher.messages.filter(m => m.type === 'voice_presence' && m.channelId === voice.id);
        assert.ok(pushed.length, 'the owner was told');
        assert.deepEqual(pushed.at(-1).participants.map(p => p.userId), [member.id]);
        assert.ok(!stranger.messages.some(m => m.type === 'voice_presence'), 'someone outside the Community was not');
      } finally { watcher.close(); stranger.close(); }
    });

    await t.test('a moderator can mute a member\'s microphone; a member cannot; nobody can act on someone above them', async () => {
      lk.put(room, member.id, [{ sid: 'TR_mic1', source: 2, muted: false }]);
      lk.put(room, owner.id, []);
      await s.webhook(joined(room, owner.id));
      const muteUrl = (u) => `/api/communities/${communityId}/channels/${voice.id}/voice/participants/${u.id}/mute`;
      const res = await s.api('POST', muteUrl(member), { token: mod.token });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok(lk.calls.some(c => c.method === 'MutePublishedTrack' && c.data.identity === member.id && c.data.trackSid === 'TR_mic1' && c.data.muted === true));
      assert.equal((await s.api('POST', muteUrl(owner), { token: member.token })).status, 403, 'members do not moderate');
      assert.equal((await s.api('POST', muteUrl(owner), { token: mod.token })).status, 403, 'a moderator does not outrank the owner');
      assert.equal((await s.api('DELETE', `/api/communities/${communityId}/channels/${voice.id}/voice/participants/${owner.id}`, { token: mod.token })).status, 403);
    });

    await t.test('removing a member from the Community disconnects them from voice at once', async () => {
      assert.ok(!lk.removed(room, member.id), 'precondition');
      const out = await s.api('DELETE', `/api/communities/${communityId}/members/${member.id}`, { token: owner.token });
      assert.equal(out.status, 200, JSON.stringify(out.body));
      // No tick will run (60 s); only the hook on the Community route can do this.
      for (let i = 0; i < 40 && !lk.removed(room, member.id); i++) await sleep(50);
      assert.ok(lk.removed(room, member.id), 'the removed member was disconnected');
      assert.ok(!lk.removed(room, owner.id), 'and nobody else');
      assert.equal((await tokenFor(member)).status, 404);
    });

    await t.test('a token minted before a ban is useless: the join is refused on arrival', async () => {
      const banned = await s.makeUser('banned1');
      await s.api('POST', `/api/communities/${communityId}/members`, { token: owner.token, body: { userId: banned.id } });
      assert.equal((await tokenFor(banned)).status, 200);
      assert.equal((await s.api('POST', `/api/communities/${communityId}/bans`, { token: owner.token, body: { userId: banned.id } })).status, 201);
      // They connect with the token they already had.
      lk.put(room, banned.id, []);
      await s.webhook(joined(room, banned.id));
      for (let i = 0; i < 40 && !lk.removed(room, banned.id); i++) await sleep(50);
      assert.ok(lk.removed(room, banned.id));
    });

    await t.test('a full channel refuses new tokens', async () => {
      const fresh = await s.makeUser('late1');
      await s.api('POST', `/api/communities/${communityId}/members`, { token: owner.token, body: { userId: fresh.id } });
      // Fill it with people the roster believes are there.
      const before = (await s.api('GET', `/api/communities/${communityId}/voice`, { token: owner.token })).body.channels[voice.id].length;
      for (let i = before; i < 25; i++) await s.webhook(joined(room, `filler-${i}`));
      const res = await tokenFor(fresh);
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.limit, 25);
      for (let i = before; i < 25; i++) await s.webhook({ event: 'participant_left', room: { name: room }, participant: { identity: `filler-${i}` } });
      assert.equal((await tokenFor(fresh)).status, 200);
    });

    await t.test('deleting a voice channel closes its room', async () => {
      const doomed = (await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'Doomed', type: 'voice' } })).body.channel;
      const doomedRoom = `vc-${doomed.id}`;
      lk.put(doomedRoom, owner.id, []);
      await s.webhook(joined(doomedRoom, owner.id));
      assert.equal((await s.api('DELETE', `/api/communities/${communityId}/channels/${doomed.id}`, { token: owner.token })).status, 200);
      const closed = () => lk.calls.some(c => c.method === 'DeleteRoom' && c.data.room === doomedRoom);
      for (let i = 0; i < 40 && !closed(); i++) await sleep(25);
      assert.ok(closed(), 'the room was closed');
    });

    await t.test('wave calls: presence is pushed to the wave and served without asking LiveKit', async () => {
      const w = await s.api('POST', '/api/waves', { token: owner.token, body: { title: 'Call me', privacy: 'private', participants: [mod.id] } });
      const waveId = w.body.id || w.body.wave?.id;
      const listener = await s.socket(mod.token);
      try {
        const listRoomsBefore = lk.calls.filter(c => c.method === 'ListRooms').length;
        await s.webhook(joined(waveId, owner.id));
        await sleep(300);
        assert.ok(listener.messages.some(m => m.type === 'call_presence' && m.waveId === waveId && m.participantCount === 1));
        const calls = (await s.api('GET', '/api/waves/active-calls', { token: mod.token })).body.calls;
        assert.deepEqual(calls.find(c => c.waveId === waveId)?.participants, [owner.id]);
        assert.ok(!(await s.api('GET', '/api/waves/active-calls', { token: outsider.token })).body.calls.some(c => c.waveId === waveId));
        // /call/status, which every open wave polls every 5 s, also answers
        // from the roster now.
        const status = (await s.api('GET', `/api/waves/${waveId}/call/status`, { token: mod.token })).body;
        assert.deepEqual(status, { active: true, participantCount: 1, participants: [owner.id] });
        await s.webhook({ event: 'participant_left', room: { name: waveId }, participant: { identity: owner.id } });
        assert.equal((await s.api('GET', `/api/waves/${waveId}/call/status`, { token: mod.token })).body.active, false);
        // Someone asking for a token counts as the call starting, for 30 s.
        assert.equal((await s.api('POST', `/api/waves/${waveId}/call/token`, { token: owner.token })).status, 200);
        const starting = (await s.api('GET', `/api/waves/${waveId}/call/status`, { token: mod.token })).body;
        assert.equal(starting.active, true);
        assert.equal(starting.participantCount, 0);
        assert.equal((await s.api('GET', `/api/waves/${waveId}/call/status`, { token: outsider.token })).status, 403);
        assert.equal(lk.calls.filter(c => c.method === 'ListRooms').length, listRoomsBefore, 'no LiveKit call per request');
      } finally { listener.close(); }
    });

  } finally {
    s.stop();
    lk.server.close();
  }
});

test('voice access is re-checked against current rules (counterfactual: without the re-check a removed member stays connected)', { timeout: 120000 }, async () => {
  const lk = await fakeLiveKit();
  // The same scenario with recheckVoiceAccess() emptied out.
  const s = await startServer(lk.url, {
    mutate: (src) => {
      const marker = 'function recheckVoiceAccess() {';
      assert.ok(src.includes(marker), 'the function this counterfactual disables must exist');
      return src.replace(marker, marker + ' return;');
    },
  });
  try {
    const { owner, member, communityId, voice } = await setupCommunity(s);
    const room = `vc-${voice.id}`;
    lk.put(room, member.id, []);
    await s.webhook(joined(room, member.id));
    const out = await s.api('DELETE', `/api/communities/${communityId}/members/${member.id}`, { token: owner.token });
    assert.equal(out.status, 200);
    await sleep(1500);
    assert.ok(!lk.removed(room, member.id), 'without the re-check the removed member is still in the room — the bug the main test guards against');
  } finally {
    s.stop();
    lk.server.close();
  }
});

test('idle voice rooms empty themselves; a listener in a live room stays; wave calls are left alone', { timeout: 120000 }, async () => {
  const lk = await fakeLiveKit();
  // A 200 ms tick, so the sweep (every 4th tick) runs every 0.8 s. 0.01 min = 600 ms.
  const s = await startServer(lk.url, { env: { VOICE_TICK_MS: '200', VOICE_ALONE_MINUTES: '0.01', VOICE_IDLE_MINUTES: '0.03' } });
  try {
    const { owner, member, mod, communityId } = await setupCommunity(s);
    const second = await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'Second', type: 'voice' } });
    const lonely = `vc-${second.body.channel.id}`;
    const third = await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'Third', type: 'voice' } });
    const silentRoom = `vc-${third.body.channel.id}`;
    const busy = (await s.api('GET', `/api/communities/${communityId}/voice`, { token: owner.token })).body.channels;
    const busyRoom = `vc-${Object.keys(busy).find(id => id !== second.body.channel.id && id !== third.body.channel.id)}`;
    const listener = await s.makeUser('listener1');
    await s.api('POST', `/api/communities/${communityId}/members`, { token: owner.token, body: { userId: listener.id } });

    lk.put(lonely, owner.id, [{ sid: 'TR_a', source: 2, muted: false }]);
    // Someone talking and someone listening muted: a live room. Listening is
    // not idling (v2.119.0; it was per person, and the listener was removed).
    lk.put(busyRoom, member.id, [{ sid: 'TR_b', source: 2, muted: true }]);
    lk.put(busyRoom, mod.id, [{ sid: 'TR_c', source: 2, muted: false }]);
    // Two people, both muted: nobody is saying anything, so both go.
    lk.put(silentRoom, listener.id, [{ sid: 'TR_d', source: 2, muted: true }]);
    lk.put(silentRoom, member.id, []);
    // A wave call with one person in it, for far longer than the limits.
    lk.put('wave-not-a-voice-room', owner.id, []);
    // Another node's voice room on a shared LiveKit project (dev and farhold
    // share one). This node has no such channel and must not touch it.
    lk.put('vc-another-nodes-channel', 'someone-elsewhere', [{ sid: 'TR_x', source: 2, muted: true }]);

    // Generous: under the full suite's load the server ticks late.
    const done = () => lk.removed(lonely, owner.id) && lk.removed(silentRoom, listener.id) && lk.removed(silentRoom, member.id);
    for (let i = 0; i < 200 && !done(); i++) await sleep(100);
    assert.ok(lk.removed(lonely, owner.id), 'alone in a voice room past the limit');
    assert.ok(lk.removed(silentRoom, listener.id) && lk.removed(silentRoom, member.id), 'a room nobody speaks in empties');
    assert.match(s.output(), new RegExp(`removed ${listener.id} from ${silentRoom} \\(idle\\)`));
    assert.match(s.output(), new RegExp(`removed ${owner.id} from ${lonely} \\(alone\\)`));
    assert.ok(!lk.removed(busyRoom, member.id), 'a muted listener in a room where someone is talking stays');
    assert.ok(!lk.removed(busyRoom, mod.id), 'someone talking is not idle');
    assert.ok(!lk.removed('wave-not-a-voice-room', owner.id), 'wave calls keep their behaviour');
    assert.ok(!lk.removed('vc-another-nodes-channel', 'someone-elsewhere'), 'another node\'s room is left alone');
  } finally {
    s.stop();
    lk.server.close();
  }
});

test('voice is opt-in: off, there are no voice channels and no tokens, and open apps are told', { timeout: 60000 }, async () => {
  const lk = await fakeLiveKit();
  const s = await startServer(lk.url);
  try {
    const { owner, member, communityId, voice } = await setupCommunity(s);
    // A member with the app open; it must hear that the switch changed
    // (v2.118.1), or the feature stays as it was until the app restarts.
    const open = await s.socket(member.token);
    const pushes = () => open.messages.filter(m => m.type === 'instance_config_changed').length;
    // Turn it off the way an operator would, through the admin route.
    const admin = (await s.api('POST', '/api/auth/login', { body: { handle: owner.handle, password } })).body;
    const stepUp = (await s.api('POST', '/api/auth/step-up', { token: admin.token, body: { password } })).body.stepUpToken;
    const refused = await s.api('PUT', '/api/admin/instance-config', { token: member.token, headers: { 'X-Step-Up-Token': stepUp }, body: { features: { voiceChannels: false } } });
    assert.notEqual(refused.status, 200);
    const off = await s.api('PUT', '/api/admin/instance-config', { token: admin.token, headers: { 'X-Step-Up-Token': stepUp }, body: { features: { voiceChannels: false } } });
    assert.equal(off.status, 200, `the first user is the node admin: ${JSON.stringify(off.body)}`);
    for (let i = 0; i < 40 && pushes() === 0; i++) await sleep(50);
    assert.equal(pushes(), 1, 'open apps are told once, and only for the save that happened');
    const pushed = open.messages.find(m => m.type === 'instance_config_changed');
    assert.deepEqual(Object.keys(pushed), ['type'], 'the push carries no config; apps re-read the public view');
    open.close();
    const publicView = await s.api('GET', '/api/instance-config');
    assert.equal(publicView.body.features.voiceChannels, false);
    const token = await s.api('POST', `/api/communities/${communityId}/channels/${voice.id}/voice/token`, { token: member.token });
    assert.equal(token.status, 403);
    assert.equal(token.body.feature, 'voiceChannels');
    const create = await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'More', type: 'voice' } });
    assert.equal(create.status, 403);
  } finally {
    s.stop();
    lk.server.close();
  }
});

// ---------------------------------------------------------------- Phase 3 (v2.119.0)

const published = (room, identity, source) => ({ event: 'track_published', room: { name: room }, participant: { identity, name: identity }, track: { sid: `TR_${identity}_${source}`, source, muted: false } });
const unpublished = (room, identity, source) => ({ event: 'track_unpublished', room: { name: room }, participant: { identity, name: identity }, track: { sid: `TR_${identity}_${source}`, source } });
// LiveKit's JSON names sources in capitals; the JWT in lower case.
const sourcesOf = (permission) => (permission?.canPublish ? (permission.canPublishSources || []).map(x => String(x).toLowerCase()) : []);
const waitFor = async (cond, ms = 5000) => { for (let i = 0; i < ms / 50 && !cond(); i++) await sleep(50); return cond(); };

test('Voice channels, phase 3', { timeout: 240000 }, async (t) => {
  const lk = await fakeLiveKit();
  const s = await startServer(lk.url, { env: { VOICE_MOVE_GRACE_MS: '1500' } });
  try {
    const { owner, member, mod, communityId, voice, role } = await setupCommunity(s);
    const room = `vc-${voice.id}`;
    const tokenFor = (u, channelId = voice.id) => s.api('POST', `/api/communities/${communityId}/channels/${channelId}/voice/token`, { token: u.token });

    await t.test('media is encrypted with a key LiveKit never sees, one per room session', async () => {
      const a = (await tokenFor(member)).body;
      const b = (await tokenFor(mod)).body;
      assert.ok(a.e2ee?.key && a.e2ee.roomSid, 'the token response carries the media key');
      assert.equal(a.e2ee.key, b.e2ee.key, 'everyone in the same room session gets the same key');
      assert.equal(Buffer.from(a.e2ee.key, 'base64').length, 32);
      assert.ok(!JSON.stringify(lk.calls).includes(a.e2ee.key), 'nothing sent to LiveKit contains the key');
      assert.ok(!a.token.includes(a.e2ee.key) && !JSON.stringify(grants(a.token)).includes(a.e2ee.key), 'nor does the LiveKit token');
      // The room empties and closes; the next session has a new key.
      lk.sids.delete(room);
      const c = (await tokenFor(member)).body;
      assert.notEqual(c.e2ee.roomSid, a.e2ee.roomSid);
      assert.notEqual(c.e2ee.key, a.e2ee.key);
    });

    await t.test('camera limit: the seventh camera is refused by LiveKit, and returns when one goes off', async () => {
      const crowd = [member, mod, owner];
      for (let i = 0; i < 5; i++) {
        const u = await s.makeUser(`cam${i}`);
        await s.api('POST', `/api/communities/${communityId}/members`, { token: owner.token, body: { userId: u.id } });
        crowd.push(u);
      }
      const late = crowd[7];
      const lateSocket = await s.socket(late.token);
      for (const u of crowd) {
        await tokenFor(u);
        lk.put(room, u.id, []);
        await s.webhook(joined(room, u.id));
      }
      for (const u of crowd.slice(0, 6)) await s.webhook(published(room, u.id, 1));
      // Six cameras: someone without one may not start a seventh.
      assert.ok(await waitFor(() => lk.permission(room, late.id) && !sourcesOf(lk.permission(room, late.id)).includes('camera')),
        'with six cameras on, the others lose camera permission');
      assert.ok(sourcesOf(lk.permission(room, late.id)).includes('microphone'), 'and keep everything else');
      assert.ok(!lk.permission(room, crowd[0].id), 'the six with cameras are not touched');

      // A seventh anyway (published in the instant before the update landed):
      // the latest camera is the one that goes.
      await s.webhook(published(room, late.id, 1));
      assert.ok(await waitFor(() => lateSocket.messages.some(m => m.type === 'voice_notice' && m.notice === 'video_full')),
        'the person whose camera was refused is told why');
      assert.ok(!lk.permission(room, crowd[0].id), 'the earlier cameras keep their place');

      // One camera goes off: there is room again.
      await s.webhook(unpublished(room, crowd[0].id, 1));
      await s.webhook(unpublished(room, late.id, 1));
      assert.ok(await waitFor(() => sourcesOf(lk.permission(room, late.id)).includes('camera')), 'camera permission comes back');
      lateSocket.close();
      for (const u of crowd) { lk.rooms.get(room)?.delete(u.id); await s.webhook({ event: 'participant_left', room: { name: room }, participant: { identity: u.id } }); }
    });

    await t.test('stage: hosts speak, the audience listens, raises hands and is brought up', async () => {
      const created = await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'Town Hall', type: 'voice', stage: true } });
      assert.equal(created.status, 201);
      assert.equal(created.body.channel.stage, 1);
      const stage = created.body.channel;
      const stageRoom = `vc-${stage.id}`;

      const listen = (await tokenFor(member, stage.id)).body;
      assert.equal(listen.stage, true);
      assert.equal(listen.onStage, false);
      assert.equal(grants(listen.token).video.canPublish, false, 'the audience cannot publish anything');
      assert.equal(listen.rights.speak, true, 'though their roles would let them speak once brought up');
      const host = (await tokenFor(mod, stage.id)).body;
      assert.equal(host.onStage, true);
      assert.ok(grants(host.token).video.canPublishSources.includes('microphone'), 'a host (voice.moderate) speaks');

      const memberSocket = await s.socket(member.token);
      const watcher = await s.socket(owner.token);
      for (const u of [member, mod]) { lk.put(stageRoom, u.id, []); await s.webhook(joined(stageRoom, u.id)); }

      const hand = await s.api('POST', `/api/communities/${communityId}/channels/${stage.id}/voice/hand`, { token: member.token, body: { raised: true } });
      assert.equal(hand.status, 200);
      assert.deepEqual(JSON.parse(lk.rooms.get(stageRoom).get(member.id).metadata), { speaker: false, hand: true },
        'kept in LiveKit metadata, which only the server can write');
      assert.ok(await waitFor(() => watcher.messages.some(m => m.type === 'voice_presence' && m.stage === true &&
        m.participants.some(p => p.userId === member.id && p.hand === true))), 'hosts see the hand');

      const self = await s.api('POST', `/api/communities/${communityId}/channels/${stage.id}/voice/participants/${member.id}/speaker`, { token: member.token, body: { speaker: true } });
      assert.equal(self.status, 403, 'nobody brings themselves up');

      const up = await s.api('POST', `/api/communities/${communityId}/channels/${stage.id}/voice/participants/${member.id}/speaker`, { token: mod.token, body: { speaker: true } });
      assert.equal(up.status, 200);
      assert.ok(await waitFor(() => sourcesOf(lk.permission(stageRoom, member.id)).includes('microphone')), 'brought up: may publish');
      assert.deepEqual(JSON.parse(lk.rooms.get(stageRoom).get(member.id).metadata), { speaker: true, hand: false }, 'and the hand comes down');
      assert.ok(memberSocket.messages.some(m => m.type === 'voice_notice' && m.notice === 'speaker'));

      const down = await s.api('POST', `/api/communities/${communityId}/channels/${stage.id}/voice/participants/${member.id}/speaker`, { token: mod.token, body: { speaker: false } });
      assert.equal(down.status, 200);
      assert.ok(await waitFor(() => sourcesOf(lk.permission(stageRoom, member.id)).length === 0), 'back in the audience: nothing to publish');

      // Turning the stage off lets the audience speak; it is a channel setting.
      const off = await s.api('PATCH', `/api/communities/${communityId}/channels/${stage.id}`, { token: owner.token, body: { stage: false } });
      assert.equal(off.status, 200);
      assert.ok(await waitFor(() => sourcesOf(lk.permission(stageRoom, member.id)).includes('microphone')));
      const textStage = await s.api('PATCH', `/api/communities/${communityId}/channels/${voice.id}`, { token: owner.token, body: { stage: 'yes' } });
      assert.equal(textStage.status, 400);
      const hands = await s.api('POST', `/api/communities/${communityId}/channels/${voice.id}/voice/hand`, { token: member.token, body: { raised: true } });
      assert.equal(hands.status, 400, 'hands are for stages');
      memberSocket.close(); watcher.close();
      for (const u of [member, mod]) { lk.rooms.get(stageRoom)?.delete(u.id); await s.webhook({ event: 'participant_left', room: { name: stageRoom }, participant: { identity: u.id } }); }
    });

    await t.test('move: a moderator sends someone to another channel they may join; the app follows or they are removed', async () => {
      const other = (await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'Side Room', type: 'voice' } })).body.channel;
      const locked = (await s.api('POST', `/api/communities/${communityId}/channels`, { token: owner.token, body: { name: 'Staff Voice', type: 'voice' } })).body.channel;
      await s.api('PUT', `/api/communities/${communityId}/channels/${locked.id}/roles/${role('member').id}`, { token: owner.token, body: { allow: [], deny: ['voice.connect'] } });

      const memberSocket = await s.socket(member.token);
      lk.put(room, member.id, []);
      await s.webhook(joined(room, member.id));
      const move = (by, to) => s.api('POST', `/api/communities/${communityId}/channels/${voice.id}/voice/participants/${member.id}/move`, { token: by.token, body: { channelId: to } });

      assert.equal((await move(member, other.id)).status, 403, 'a member cannot move people');
      assert.equal((await move(mod, locked.id)).status, 409, 'not into a channel they could not join');
      assert.equal((await move(mod, 'no-such-channel')).status, 404);
      assert.equal((await move(mod, voice.id)).status, 400);

      const ok = await move(mod, other.id);
      assert.equal(ok.status, 200);
      const told = memberSocket.messages.find(m => m.type === 'voice_move');
      assert.ok(told, 'their app is told where to go');
      assert.equal(told.channelId, other.id);
      assert.equal(told.fromChannelId, voice.id);
      // Their app never followed: after the grace period they are out anyway.
      assert.ok(await waitFor(() => lk.removed(room, member.id), 6000), 'a move is never weaker than a disconnect');
      memberSocket.close();
    });

    await t.test('idle limits are admin settings, checked on the way in', async () => {
      const stepUp = (await s.api('POST', '/api/auth/step-up', { token: owner.token, body: { password } })).body.stepUpToken;
      const put = (voiceBody) => s.api('PUT', '/api/admin/instance-config', { token: owner.token, headers: { 'X-Step-Up-Token': stepUp }, body: { voice: voiceBody } });
      assert.equal((await put({ aloneMinutes: 3, idleMinutes: 0 })).status, 200);
      const got = (await s.api('GET', '/api/admin/instance-config', { token: owner.token })).body;
      assert.deepEqual(got.voice, { aloneMinutes: 3, idleMinutes: 0 });
      assert.ok(got.voiceDefaults && 'idleMinutes' in got.voiceDefaults);
      assert.equal((await put({ aloneMinutes: -1 })).status, 400);
      assert.equal((await put({ idleMinutes: 2.5 })).status, 400);
      assert.equal((await put({ idleMinutes: 100000 })).status, 400);
      assert.equal((await put({ aloneMinutes: null })).status, 200);
      assert.deepEqual((await s.api('GET', '/api/admin/instance-config', { token: owner.token })).body.voice, { idleMinutes: 0 });
    });
  } finally {
    s.stop();
    lk.server.close();
  }
});

test('someone removed from a voice channel can come back with a new token (counterfactual: an undated token is refused as revoked)', { timeout: 120000 }, async () => {
  // The bug (v2.118.0–v2.118.1): the SDK signs tokens with nbf 0, LiveKit
  // refuses a token dated before a removal, so after any removal — moderator,
  // idle sweep, access re-check — that person could never rejoin the channel.
  const scenario = async (mutate) => {
    const lk = await fakeLiveKit();
    const s = await startServer(lk.url, { mutate });
    try {
      const { member, mod, communityId, voice } = await setupCommunity(s);
      const room = `vc-${voice.id}`;
      const tokenFor = () => s.api('POST', `/api/communities/${communityId}/channels/${voice.id}/voice/token`, { token: member.token });
      const first = await tokenFor();
      assert.ok(await lk.accepts(first.body.token), 'a first token works either way');
      lk.put(room, member.id, []);
      await s.webhook(joined(room, member.id));
      const out = await s.api('DELETE', `/api/communities/${communityId}/channels/${voice.id}/voice/participants/${member.id}`, { token: mod.token });
      assert.equal(out.status, 200);
      await sleep(1100); // a later second than the removal
      const again = await tokenFor();
      assert.equal(again.status, 200);
      return await lk.accepts(again.body.token);
    } finally {
      s.stop();
      lk.server.close();
    }
  };
  assert.equal(await scenario(), true, 'a token issued after the removal lets them back in');
  const undated = (src) => {
    const marker = 'const token = await livekitJwt(at);\n    voiceAppliedSources.set(';
    assert.ok(src.includes(marker), 'the call this counterfactual reverts must exist');
    return src.replace(marker, 'const token = await at.toJwt();\n    voiceAppliedSources.set(');
  };
  assert.equal(await scenario(undated), false, 'signed the SDK way, the same token is refused: the bug');
});
