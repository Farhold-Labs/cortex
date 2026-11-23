'use strict';

// Direct calls phase 2 (v2.146.0): the Android app rings natively, and the
// client versions report. The harness is direct-calls.test.cjs's. Firebase is
// replaced by a recorder in a copy of server.js, so the test sees exactly what
// would have gone to each phone.
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


// What the server would have sent through Firebase, printed instead.
const FAKE_FCM = (source) => source
  .replaceAll('getFirebaseApps().length', '1')
  .replaceAll('getFirebaseMessaging().send(', "(async (m) => { console.log('FCM_SENT ' + JSON.stringify(m)); })(");
const fcmSent = (s) => s.output().split('\n').filter(l => l.startsWith('FCM_SENT ')).map(l => JSON.parse(l.slice(9)));
const register = (s, user, token, extra = {}) =>
  s.api('POST', '/api/push/fcm/register', { token: user.token, body: { token, platform: 'android', deviceId: token, ...extra } });

async function ringScenario(mutate) {
  const lk = await fakeLiveKit();
  const s = await startServer(lk.url, { env: RING_ENV, mutate: (src) => (mutate ? mutate(FAKE_FCM(src)) : FAKE_FCM(src)) });
  const mal = await s.makeUser('mal'), zoe = await s.makeUser('zoe');
  await befriend(s, mal, zoe);
  assert.equal((await register(s, zoe, 'old-apk')).status, 200);
  assert.equal((await register(s, zoe, 'new-apk', { features: ['call-ring'], appVersion: '2.146.0' })).status, 200);
  return { lk, s, mal, zoe, done: () => { s.stop(); lk.server.close(); } };
}

test('an app that rings gets the call as a data message; an older app keeps its notification', { timeout: 90000 }, async () => {
  const { s, mal, zoe, done } = await ringScenario();
  try {
    const id = (await ring(s, mal, zoe)).body.call.id;
    const toOld = await waitFor(() => fcmSent(s).find(m => m.token === 'old-apk' && m.data?.callId === id));
    const toNew = await waitFor(() => fcmSent(s).find(m => m.token === 'new-apk' && m.data?.callId === id));
    assert.ok(toOld.notification, 'the older app is sent a notification it can show');
    assert.equal(toOld.data.type, 'incoming_call');
    assert.equal(toNew.notification, undefined, 'the ringing app is sent no notification: it rings itself');
    assert.equal(toNew.data.type, 'incoming_call');
    assert.equal(toNew.data.callerName, 'mal');
    assert.equal(toNew.data.kind, 'video');
    assert.match(toNew.data.declineToken, /^[0-9a-f]{64}$/);
    assert.ok(Number(toNew.data.expiresAt) > Date.now());
    assert.equal(toNew.android.priority, 'high');
    assert.ok(toNew.android.ttl > 0 && toNew.android.ttl <= 4000, 'it lives no longer than a ring');
    for (const v of Object.values(toNew.data)) assert.equal(typeof v, 'string', 'FCM data values are strings');

    // Answered: the ringing app is told to stop; the older app is told nothing.
    assert.equal((await s.api('POST', `/api/calls/${id}/answer`, { token: zoe.token })).status, 200);
    const stop = await waitFor(() => fcmSent(s).find(m => m.data?.type === 'call_ring_stop' && m.data.callId === id));
    assert.equal(stop.token, 'new-apk');
    assert.equal(stop.data.state, 'answered');
    assert.ok(!fcmSent(s).some(m => m.token === 'old-apk' && m.data?.type === 'call_ring_stop'));
    // An answered call is not a missed one: no stop for a call that never rang again.
    await s.api('POST', `/api/calls/${id}/end`, { token: mal.token });
    await sleep(200);
    assert.equal(fcmSent(s).filter(m => m.data?.type === 'call_ring_stop' && m.data.callId === id).length, 1);
  } finally { done(); }
});

test('DECLINE from the ring needs that call\'s own token, and can only decline', { timeout: 90000 }, async () => {
  const { s, mal, zoe, done } = await ringScenario();
  try {
    const malSock = await s.socket(mal.token);
    const first = (await ring(s, mal, zoe)).body.call.id;
    const firstToken = (await waitFor(() => fcmSent(s).find(m => m.token === 'new-apk' && m.data?.callId === first))).data.declineToken;
    // The caller hangs up; a new call comes.
    await s.api('POST', `/api/calls/${first}/end`, { token: mal.token });
    const id = (await ring(s, mal, zoe)).body.call.id;
    const token = (await waitFor(() => fcmSent(s).find(m => m.token === 'new-apk' && m.data?.callId === id))).data.declineToken;
    assert.notEqual(token, firstToken);

    const decline = (callId, t) => s.api('POST', `/api/calls/${callId}/decline-from-ring`, { body: { token: t } });
    for (const bad of ['', 'x', '0'.repeat(64), firstToken, token.slice(0, 63), token.toUpperCase()]) {
      const r = await decline(id, bad);
      assert.equal(r.status, 404, `refused: ${JSON.stringify(bad)}`);
    }
    assert.equal((await decline('dcall-nope', token)).status, 404);
    assert.equal((await s.api('GET', `/api/calls/${id}`, { token: zoe.token })).body.call.state, 'ringing', 'still ringing after every bad token');
    // The token is not a session: it opens nothing else.
    for (const [method, p] of [['POST', `/api/calls/${id}/answer`], ['POST', `/api/calls/${id}/token`], ['GET', '/api/calls']]) {
      const r = await s.api(method, p, { token });
      assert.equal(r.status, 401, `${method} ${p}`);
    }

    const ok = await decline(id, token);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.state, 'declined');
    assert.equal((await waitFor(() => lastCall(malSock, id)?.state === 'declined' && lastCall(malSock, id))).state, 'declined', 'the caller hears it');
    assert.ok(await waitFor(() => fcmSent(s).some(m => m.data?.type === 'call_ring_stop' && m.data.callId === id && m.data.state === 'declined')));
    // Over is over: the token does nothing more.
    assert.equal((await decline(id, token)).body.state, 'declined');
    malSock.close();
  } finally { done(); }
});

test('counterfactual: without the token check, anyone could decline anyone\'s call', { timeout: 90000 }, async () => {
  const strip = (src) => {
    const check = "if (!call || !expected || given.length !== expected.length\n      || !crypto.timingSafeEqual(Buffer.from(given), expected)) {";
    assert.ok(src.includes(check), 'the check being removed is where the test expects it');
    return src.replace(check, 'if (!call) {');
  };
  const { s, mal, zoe, done } = await ringScenario(strip);
  try {
    const id = (await ring(s, mal, zoe)).body.call.id;
    const r = await s.api('POST', `/api/calls/${id}/decline-from-ring`, { body: { token: 'x' } });
    assert.equal(r.status, 200, 'the bug reappears');
    assert.equal(r.body.state, 'declined');
  } finally { done(); }
});

test('installs report their versions; admins see counts, with no account kept', { timeout: 90000 }, async () => {
  const lk = await fakeLiveKit();
  const s = await startServer(lk.url, { env: RING_ENV });
  try {
    const mal = await s.makeUser('mal'), zoe = await s.makeUser('zoe');   // the first account is the admin
    const report = (user, body) => s.api('POST', '/api/clients/report', { token: user.token, body });
    const phone = 'aaaaaaaa-1111-2222-3333-444444444444';
    assert.equal((await s.api('POST', '/api/clients/report', { body: { installId: phone, platform: 'android' } })).status, 401);
    assert.equal((await report(zoe, { installId: 'short', platform: 'android' })).status, 400);
    assert.equal((await report(zoe, { installId: phone, platform: 'toaster' })).status, 400);
    assert.equal((await report(zoe, { installId: phone, platform: 'android', webVersion: '2.146.0', appVersion: '2.113.3' })).status, 200);
    // Upgraded: the same install, a new app version. One row, not two.
    assert.equal((await report(zoe, { installId: phone, platform: 'android', webVersion: '2.146.0', appVersion: '2.146.0' })).status, 200);
    assert.equal((await report(mal, { installId: 'bbbbbbbb-1111-2222-3333-444444444444', platform: 'web', webVersion: '2.146.0', appVersion: '9.9.9' })).status, 200);
    // Junk versions are dropped, not stored.
    assert.equal((await report(mal, { installId: 'cccccccc-1111-2222-3333-444444444444', platform: 'android', webVersion: '<b>x</b>', appVersion: '2.146.0; drop' })).status, 200);

    assert.equal((await s.api('GET', '/api/admin/client-versions', { token: zoe.token })).status, 403);
    const r = await s.api('GET', '/api/admin/client-versions', { token: mal.token });
    assert.equal(r.status, 200);
    const rows = r.body.versions;
    const android = rows.filter(v => v.platform === 'android');
    assert.deepEqual(android.map(v => [v.appVersion, v.webVersion, v.installs]).sort(), [['2.146.0', '2.146.0', 1], [null, null, 1]].sort());
    const web = rows.find(v => v.platform === 'web');
    assert.equal(web.appVersion, null, 'a browser has no app version');
    assert.equal(r.body.days, 30);

    const Database = require(path.join(root, 'server/node_modules/better-sqlite3'));
    const db = new Database(s.dbPath, { readonly: true });
    const cols = db.prepare('PRAGMA table_info(client_versions)').all().map(c => c.name);
    db.close();
    assert.deepEqual(cols.sort(), ['app_version', 'first_seen', 'install_id', 'last_seen', 'platform', 'web_version'].sort(), 'no account in the table');
  } finally { s.stop(); lk.server.close(); }
});
