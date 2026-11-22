'use strict';

// Direct calls (v2.145.0): docs/direct-calls/. One person rings another,
// outside waves. The server holds each call's state, and that state decides
// who gets a token for its LiveKit room. Disposable servers against a fake
// LiveKit (the harness from voice-channels.test.cjs); tokens are decoded,
// because their grants are the access control.
//
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-dcall-'));
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

const joined = (room, identity) => ({ event: 'participant_joined', room: { name: room }, participant: { identity, name: identity } });
// Short enough to test a missed call, long enough for a slow CI machine.
const RING_ENV = { DIRECT_CALL_RING_MS: '4000', DIRECT_CALL_SWEEP_MS: '300', DIRECT_CALL_EMPTY_MS: '800', RATE_LIMIT_CALL_MAX: '1000' };

/** Contacts both ways: what lets two people ring each other. */
async function befriend(s, a, b) {
  for (const [x, y] of [[a, b], [b, a]]) {
    const r = await s.api('POST', '/api/contacts', { token: x.token, body: { handle: y.handle } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
}
const ring = (s, from, to, kind = 'video') => s.api('POST', '/api/calls', { token: from.token, body: { to: to.id, kind } });
const waitFor = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return v;
    await sleep(50);
  }
};
const lastCall = (sock, id) => sock.messages.filter(m => m.type === 'direct_call' && m.call.id === id).pop()?.call;

test('only a contact who has you back can ring you; blocks refuse it the same way', { timeout: 90000 }, async () => {
  const lk = await fakeLiveKit();
  const s = await startServer(lk.url, { env: RING_ENV });
  try {
    const mal = await s.makeUser('mal'), zoe = await s.makeUser('zoe'), jayne = await s.makeUser('jayne');
    // Strangers.
    let r = await ring(s, jayne, zoe);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'NOT_CONTACTS');
    // One-sided: anyone can add anyone as a contact without asking.
    assert.equal((await s.api('POST', '/api/contacts', { token: jayne.token, body: { handle: 'zoe' } })).status, 201);
    r = await ring(s, jayne, zoe);
    assert.equal(r.status, 403, 'adding someone does not let you ring them');
    // Both ways.
    await befriend(s, mal, zoe);
    const contacts = (await s.api('GET', '/api/contacts', { token: mal.token })).body;
    assert.equal(contacts.find(c => c.id === zoe.id).mutual, true);
    const jc = (await s.api('GET', '/api/contacts', { token: jayne.token })).body;
    assert.equal(jc.find(c => c.id === zoe.id).mutual, false);
    // Bad requests.
    assert.equal((await s.api('POST', '/api/calls', { token: mal.token, body: { to: zoe.id, kind: 'fax' } })).status, 400);
    assert.equal((await s.api('POST', '/api/calls', { token: mal.token, body: { to: mal.id, kind: 'audio' } })).status, 400);
    // A block, either way, looks exactly like not being contacts.
    assert.equal((await s.api('POST', `/api/users/${mal.id}/block`, { token: zoe.token })).status, 200);
    r = await ring(s, mal, zoe);
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'NOT_CONTACTS');
    r = await ring(s, zoe, mal);
    assert.equal(r.status, 403);
    assert.equal((await s.api('DELETE', `/api/users/${mal.id}/block`, { token: zoe.token })).status, 200);
    r = await ring(s, mal, zoe);
    assert.equal(r.status, 201, JSON.stringify(r.body));
  } finally { s.stop(); lk.server.close(); }
});

test('a ring reaches every device; only the two people get into the room, and only when allowed', { timeout: 90000 }, async () => {
  const lk = await fakeLiveKit();
  const s = await startServer(lk.url, { env: RING_ENV });
  try {
    const mal = await s.makeUser('mal'), zoe = await s.makeUser('zoe'), wash = await s.makeUser('wash');
    await befriend(s, mal, zoe);
    const zoePhone = await s.socket(zoe.token), zoeDesk = await s.socket(zoe.token), malSock = await s.socket(mal.token);
    const r = await ring(s, mal, zoe);
    assert.equal(r.status, 201);
    const id = r.body.call.id;
    assert.equal(r.body.call.direction, 'outgoing');
    for (const sock of [zoePhone, zoeDesk]) {
      const seen = await waitFor(() => lastCall(sock, id));
      assert.equal(seen.state, 'ringing');
      assert.equal(seen.direction, 'incoming');
      assert.equal(seen.other.id, mal.id);
    }
    // While it rings: the caller may wait in the room, the callee may not yet.
    const callerTok = await s.api('POST', `/api/calls/${id}/token`, { token: mal.token });
    assert.equal(callerTok.status, 200);
    assert.equal(grants(callerTok.body.token).video.room, `call-${id}`);
    assert.equal(grants(callerTok.body.token).sub, mal.id);
    assert.equal((await s.api('POST', `/api/calls/${id}/token`, { token: zoe.token })).status, 409);
    // Nobody else learns the call exists.
    assert.equal((await s.api('POST', `/api/calls/${id}/token`, { token: wash.token })).status, 404);
    assert.equal((await s.api('GET', `/api/calls/${id}`, { token: wash.token })).status, 404);
    assert.equal((await s.api('POST', `/api/calls/${id}/answer`, { token: wash.token })).status, 404);
    // The caller can't answer their own call.
    assert.equal((await s.api('POST', `/api/calls/${id}/answer`, { token: mal.token })).status, 403);
    // A page opened from the push finds it.
    const live = (await s.api('GET', '/api/calls', { token: zoe.token })).body.live;
    assert.equal(live.id, id);
    assert.equal(live.state, 'ringing');
    // Two devices answer together: one wins.
    const [a, b] = await Promise.all([
      s.api('POST', `/api/calls/${id}/answer`, { token: zoe.token }),
      s.api('POST', `/api/calls/${id}/answer`, { token: zoe.token }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal((await waitFor(() => lastCall(malSock, id)?.state === 'answered' && lastCall(malSock, id))).state, 'answered');
    assert.equal((await waitFor(() => lastCall(zoeDesk, id)?.state === 'answered' && lastCall(zoeDesk, id))).state, 'answered', 'the other device stops ringing');
    const calleeTok = await s.api('POST', `/api/calls/${id}/token`, { token: zoe.token });
    assert.equal(calleeTok.status, 200);
    assert.equal(grants(calleeTok.body.token).video.room, `call-${id}`);
    // Declining an answered call does nothing.
    assert.equal((await s.api('POST', `/api/calls/${id}/decline`, { token: zoe.token })).body.call.state, 'answered');
    // Hanging up ends it for both, and the room is closed to both.
    const end = await s.api('POST', `/api/calls/${id}/end`, { token: mal.token });
    assert.equal(end.body.call.state, 'ended');
    assert.ok(end.body.call.durationSeconds >= 0);
    assert.equal((await waitFor(() => lastCall(zoePhone, id)?.state === 'ended' && lastCall(zoePhone, id))).state, 'ended');
    assert.equal((await s.api('POST', `/api/calls/${id}/token`, { token: mal.token })).status, 409);
    assert.equal((await s.api('POST', `/api/calls/${id}/token`, { token: zoe.token })).status, 409);
    assert.ok(lk.calls.some(c => c.method === 'DeleteRoom' && c.data.room === `call-${id}`), 'the room is closed');
    // Hanging up twice is fine.
    assert.equal((await s.api('POST', `/api/calls/${id}/end`, { token: zoe.token })).status, 200);
    for (const sock of [zoePhone, zoeDesk, malSock]) sock.close();
  } finally { s.stop(); lk.server.close(); }
});

test('declined, cancelled, unanswered and busy calls end the ring; the callee is told what they missed', { timeout: 90000 }, async () => {
  const lk = await fakeLiveKit();
  const s = await startServer(lk.url, { env: RING_ENV });
  try {
    const mal = await s.makeUser('mal'), zoe = await s.makeUser('zoe'), wash = await s.makeUser('wash');
    await befriend(s, mal, zoe);
    await befriend(s, wash, zoe);
    await befriend(s, wash, mal);
    const missed = async () => (await s.api('GET', '/api/notifications?type=missed_call', { token: zoe.token })).body.notifications;

    // Declined.
    let id = (await ring(s, mal, zoe)).body.call.id;
    assert.equal((await s.api('POST', `/api/calls/${id}/decline`, { token: zoe.token })).body.call.state, 'declined');
    assert.equal((await s.api('POST', `/api/calls/${id}/token`, { token: mal.token })).status, 409, 'the caller is out of the room');
    assert.equal((await missed()).length, 0, 'a call you declined is not a missed call');

    // Cancelled by the caller: a missed call for the callee.
    id = (await ring(s, mal, zoe, 'audio')).body.call.id;
    assert.equal((await s.api('POST', `/api/calls/${id}/end`, { token: mal.token })).body.call.state, 'cancelled');
    assert.equal((await s.api('POST', `/api/calls/${id}/answer`, { token: zoe.token })).status, 409, 'too late');
    assert.equal((await missed()).length, 1);
    assert.match((await missed())[0].title, /Missed call from mal/);

    // Nobody answers.
    id = (await ring(s, mal, zoe)).body.call.id;
    const gone = await waitFor(async () => {
      const c = (await s.api('GET', `/api/calls/${id}`, { token: mal.token })).body.call;
      return c.state === 'missed' && c;
    }, 12000);
    assert.equal(gone.state, 'missed');
    assert.equal((await missed()).length, 2);
    assert.match((await missed())[0].title, /Missed video call/);

    // Busy: Zoe is already ringing for Mal when Wash rings.
    id = (await ring(s, mal, zoe)).body.call.id;
    const busy = await ring(s, wash, zoe);
    assert.equal(busy.status, 409);
    assert.equal(busy.body.code, 'BUSY');
    assert.equal(busy.body.call.state, 'busy');
    // And Mal, already calling, can't ring someone else at the same time.
    const twice = await ring(s, mal, wash);
    assert.equal(twice.status, 409);
    assert.equal(twice.body.code, 'IN_CALL');
    await s.api('POST', `/api/calls/${id}/end`, { token: mal.token });

    // History: each person sees their own calls, from their side.
    const zh = (await s.api('GET', '/api/calls', { token: zoe.token })).body.calls;
    assert.equal(zh.length, 5);
    assert.ok(zh.every(c => c.direction === 'incoming'));
    const wh = (await s.api('GET', '/api/calls', { token: wash.token })).body.calls;
    assert.equal(wh.length, 1, 'Wash sees only his own call, not Mal and Zoe\'s');
    assert.equal(wh[0].state, 'busy');
    assert.equal(wh[0].direction, 'outgoing');
  } finally { s.stop(); lk.server.close(); }
});

test('an answered call ends when its room empties, or when both just closed the app', { timeout: 90000 }, async () => {
  const lk = await fakeLiveKit();
  // A slow machine took longer than 0.8 s between the answer and the joins,
  // and the sweep ended the call first (CI, v2.145.1). Room enough here.
  const s = await startServer(lk.url, { env: { ...RING_ENV, DIRECT_CALL_EMPTY_MS: '5000' } });
  try {
    const mal = await s.makeUser('mal'), zoe = await s.makeUser('zoe');
    await befriend(s, mal, zoe);
    // Both join, then both leave: the room empties and the call is over.
    let id = (await ring(s, mal, zoe)).body.call.id;
    await s.api('POST', `/api/calls/${id}/answer`, { token: zoe.token });
    const room = `call-${id}`;
    assert.equal((await s.webhook(joined(room, mal.id))).status, 200);
    assert.equal((await s.webhook(joined(room, zoe.id))).status, 200);
    assert.equal((await s.api('GET', `/api/calls/${id}`, { token: mal.token })).body.call.state, 'answered');
    await s.webhook({ event: 'participant_left', room: { name: room }, participant: { identity: zoe.id } });
    assert.equal((await s.api('GET', `/api/calls/${id}`, { token: mal.token })).body.call.state, 'answered', 'one left: not over yet');
    await s.webhook({ event: 'participant_left', room: { name: room }, participant: { identity: mal.id } });
    const ended = await waitFor(async () => {
      const c = (await s.api('GET', `/api/calls/${id}`, { token: mal.token })).body.call;
      return c.state === 'ended' && c;
    });
    assert.equal(ended.state, 'ended');

    // Answered, and nobody ever joined (both closed the app): the sweep ends it.
    id = (await ring(s, mal, zoe)).body.call.id;
    await s.api('POST', `/api/calls/${id}/answer`, { token: zoe.token });
    const swept = await waitFor(async () => {
      const c = (await s.api('GET', `/api/calls/${id}`, { token: zoe.token })).body.call;
      return c.state === 'ended' && c;
    }, 15000);
    assert.equal(swept.state, 'ended');
    // And they can ring each other again.
    assert.equal((await ring(s, zoe, mal)).status, 201);
  } finally { s.stop(); lk.server.close(); }
});

test('a call starting in a wave is announced to the wave, once', { timeout: 90000 }, async () => {
  const lk = await fakeLiveKit();
  const s = await startServer(lk.url, { env: RING_ENV });
  try {
    const mal = await s.makeUser('mal'), zoe = await s.makeUser('zoe'), wash = await s.makeUser('wash');
    const w = await s.api('POST', '/api/waves', { token: mal.token, body: { title: 'Serenity', privacy: 'private', participants: [zoe.id] } });
    assert.ok([200, 201].includes(w.status), JSON.stringify(w.body));
    const waveId = w.body.id || w.body.wave?.id;
    for (const inv of (await s.api('GET', '/api/wave-invitations', { token: zoe.token })).body.invitations || []) {
      await s.api('POST', `/api/wave-invitations/${inv.id}/accept`, { token: zoe.token });
    }
    const zoeSock = await s.socket(zoe.token), washSock = await s.socket(wash.token);
    assert.equal((await s.api('POST', `/api/waves/${waveId}/call/token`, { token: mal.token })).status, 200);
    await s.webhook(joined(waveId, mal.id));
    const started = await waitFor(() => zoeSock.messages.find(m => m.type === 'wave_call_started'));
    assert.equal(started?.waveId, waveId);
    assert.equal(started.startedBy, mal.id);
    assert.ok(!washSock.messages.some(m => m.type === 'wave_call_started'), 'not to people outside the wave');
    // Dropped and started again a minute later: not announced again.
    await s.webhook({ event: 'participant_left', room: { name: waveId }, participant: { identity: mal.id } });
    await s.api('POST', `/api/waves/${waveId}/call/token`, { token: mal.token });
    await s.webhook(joined(waveId, mal.id));
    await sleep(300);
    assert.equal(zoeSock.messages.filter(m => m.type === 'wave_call_started').length, 1);
    zoeSock.close(); washSock.close();
  } finally { s.stop(); lk.server.close(); }
});

test('counterfactual: without the contacts check, a stranger could ring anyone', { timeout: 90000 }, async () => {
  const lk = await fakeLiveKit();
  const s = await startServer(lk.url, {
    env: RING_ENV,
    mutate: (src) => {
      const gate = "!db.isMutualContact(callerId, calleeId) || ";
      assert.ok(src.includes(gate), 'the gate is where the test expects it');
      return src.replace(gate, '');
    },
  });
  try {
    const jayne = await s.makeUser('jayne'), zoe = await s.makeUser('zoe');
    const r = await ring(s, jayne, zoe);
    assert.equal(r.status, 201, 'with the check removed, the stranger gets through');
  } finally { s.stop(); lk.server.close(); }
});
