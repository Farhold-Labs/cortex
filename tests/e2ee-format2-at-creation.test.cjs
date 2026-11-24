'use strict';

// Format-2 keys from the first version (v2.153.1).
//
// Since v2.153.0 every wave key a device hands over is bound to the wave's id,
// its version and its holder (format 2), except the first: when a wave is
// created its id doesn't exist yet, so version 1 stayed format 1. Now the
// device asks for an id first (`POST /api/waves/reserve-id`), signed by the
// server for that person, and creates the wave under it with keys bound to it.
// Turning encryption on for an existing wave binds to the id it has.
//
// Checked here: the wave takes the reserved id; a reservation works once,
// only for the person it was made for and only for its own id; and keys sent
// at creation are stored only for the wave's people (a crew wave's whole crew)
// and those invited, never for someone refused.
//
// Counterfactuals: without the reservation check anyone can name a wave's id;
// without the holder check someone refused (here, who blocked the creator)
// is stored a key.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const loadReservation = () => import(path.join(root, 'server/lib/wave-id-reservation.js'));

function copyServer(temp, edit) {
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
  if (edit) edit(serverDir);
  return serverDir;
}

function editFile(dir, file, pairs) {
  const p = path.join(dir, file);
  let src = fs.readFileSync(p, 'utf8');
  for (const [from, to] of pairs) {
    assert.ok(src.includes(from), `could not find: ${from.slice(0, 80)}`);
    src = src.split(from).join(to);
  }
  fs.writeFileSync(p, src);
}

const noReservationCheck = (dir) => editFile(dir, 'server.js', [
  ['if (!checkWaveIdReservation(JWT_SECRET, req.body.waveId, req.user.userId, req.body.waveIdReservation)) {', 'if (false) {'],
]);
const noHolderCheck = (dir) => editFile(dir, 'server.js', [
  ['        if (!keyHolders.has(targetUserId)) continue;\n', ''],
]);

const b64 = (n) => crypto.randomBytes(n).toString('base64');

async function scenario(edit) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-e2ee-f2c-'));
  const password = 'Format2Create1!';
  let child;
  try {
    const serverDir = copyServer(temp, edit);
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('F2C_PORT=' + server.address().port));\n");
    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-format2-create-000000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/F2C_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/F2C_PORT=(\d+)/)[1]}`;
    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, body: json };
    };
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      const user = { handle, token: login.body.token, id: login.body.user.id, publicKey: b64(120) };
      const reg = await api('POST', '/api/e2ee/keys/register', { token: user.token, body: { publicKey: user.publicKey, encryptedPrivateKey: b64(200), salt: b64(16) } });
      assert.ok(reg.status < 300, JSON.stringify(reg.body));
      return user;
    };
    const keyFor = (from, to) => ({ userId: to.id === from.id ? null : to.id, encryptedWaveKey: `${b64(48)}:${b64(12)}`, senderPublicKey: from.publicKey, format: 2 });
    const Database = serverRequire('better-sqlite3');
    const keyRows = (waveId) => {
      const d = new Database(path.join(serverDir, 'data/farhold.db'));
      try { return d.prepare('SELECT user_id u, key_version v, format f FROM wave_encryption_keys WHERE wave_id = ?').all(waveId); }
      finally { d.close(); }
    };

    await makeUser('nodeadmin');
    const owner = await makeUser('fowner');
    const friend = await makeUser('ffriend');
    const blocker = await makeUser('fblocker');
    const crewmate = await makeUser('fcrew');
    const other = await makeUser('fother');
    assert.ok((await api('POST', `/api/users/${owner.id}/block`, { token: blocker.token })).status < 300);

    const r = {};
    const reserve = async (u) => (await api('POST', '/api/waves/reserve-id', { token: u.token })).body;
    const create = (u, extra) => api('POST', '/api/waves', {
      token: u.token, body: { title: 'Bound', privacy: 'private', encrypted: true, ...extra },
    });

    // Created under a reserved id, with keys for a friend and someone who blocked the owner.
    const res1 = await reserve(owner);
    r.reserved = { id: /^wave-[0-9a-f-]{36}$/.test(res1.waveId || ''), hasReservation: typeof res1.reservation === 'string' };
    const made = await create(owner, {
      participants: [friend.id, blocker.id], waveId: res1.waveId, waveIdReservation: res1.reservation,
      keyDistribution: [owner, friend, blocker].map(p => keyFor(owner, p)),
    });
    r.made = { status: made.status, sameId: made.body?.id === res1.waveId };
    const rows = keyRows(res1.waveId);
    r.holders = {
      owner: rows.some(k => k.u === owner.id && k.v === 1 && k.f === 2),
      friend: rows.some(k => k.u === friend.id && k.f === 2),
      blocker: rows.some(k => k.u === blocker.id),
    };
    r.refused = made.body?.refused?.includes(blocker.id);

    // Used twice; by someone else; for another id; an id with no reservation.
    r.again = (await create(owner, { waveId: res1.waveId, waveIdReservation: res1.reservation, keyDistribution: [keyFor(owner, owner)] })).body?.code;
    const res2 = await reserve(owner);
    r.someoneElse = (await create(other, { waveId: res2.waveId, waveIdReservation: res2.reservation, keyDistribution: [keyFor(other, other)] })).body?.code;
    r.otherId = (await create(owner, { waveId: `wave-${crypto.randomUUID()}`, waveIdReservation: res2.reservation, keyDistribution: [keyFor(owner, owner)] })).body?.code;
    const chosen = `wave-${crypto.randomUUID()}`;
    const bare = await create(other, { waveId: chosen, keyDistribution: [keyFor(other, other)] });
    r.bare = { code: bare.body?.code, exists: bare.body?.id === chosen };

    // Without a reservation, as an older app creates: still a new id, as before.
    const legacy = await create(owner, { participants: [friend.id], keyDistribution: [owner, friend].map(p => ({ ...keyFor(owner, p), format: undefined })) });
    r.legacy = { status: legacy.status, keys: keyRows(legacy.body?.id).length };

    // A crew wave: the crew are its people, named or not.
    const crew = await api('POST', '/api/groups', { token: owner.token, body: { name: 'Format crew' } });
    const crewId = crew.body?.id || crew.body?.group?.id;
    const inv = await api('POST', `/api/groups/${crewId}/members`, { token: owner.token, body: { userId: crewmate.id } });
    await api('POST', `/api/groups/invitations/${inv.body?.invitation?.id}/accept`, { token: crewmate.token });
    const res3 = await reserve(owner);
    const crewWave = await create(owner, {
      privacy: 'group', groupId: crewId, participants: [], waveId: res3.waveId, waveIdReservation: res3.reservation,
      keyDistribution: [owner, crewmate, other].map(p => keyFor(owner, p)),
    });
    const crewRows = keyRows(res3.waveId);
    r.crew = { status: crewWave.status, crewmate: crewRows.some(k => k.u === crewmate.id), outsider: crewRows.some(k => k.u === other.id) };

    // Turning encryption on for an existing wave keeps its format-2 keys.
    const plain = await api('POST', '/api/waves', { token: owner.token, body: { title: 'Plain', privacy: 'private', participants: [] } });
    const enc = await api('POST', `/api/waves/${plain.body.id}/encrypt`, { token: owner.token, body: { keyDistribution: [keyFor(owner, owner)] } });
    r.encrypt = { status: enc.status, format: keyRows(plain.body.id).find(k => k.u === owner.id)?.f };
    return r;
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('a reservation is signed, for one person, one id, and expires', async () => {
  const { reserveWaveId, checkWaveIdReservation, WAVE_ID_RESERVATION_TTL_MS } = await loadReservation();
  const secret = 'unit-secret';
  const { waveId, reservation } = reserveWaveId(secret, 'u-a', 1000);
  assert.equal(checkWaveIdReservation(secret, waveId, 'u-a', reservation, 1000), true);
  assert.equal(checkWaveIdReservation(secret, waveId, 'u-b', reservation, 1000), false, 'someone else');
  assert.equal(checkWaveIdReservation(secret, `wave-${crypto.randomUUID()}`, 'u-a', reservation, 1000), false, 'another id');
  assert.equal(checkWaveIdReservation('other-secret', waveId, 'u-a', reservation, 1000), false, 'another server');
  assert.equal(checkWaveIdReservation(secret, waveId, 'u-a', reservation, 1000 + WAVE_ID_RESERVATION_TTL_MS + 1), false, 'expired');
  const [exp, mac] = reservation.split('.');
  assert.equal(checkWaveIdReservation(secret, waveId, 'u-a', `${Number(exp) + 1}.${mac}`, 1000), false, 'expiry changed');
  assert.equal(checkWaveIdReservation(secret, 'not-a-wave-id', 'u-a', reservation, 1000), false);
  assert.equal(checkWaveIdReservation(secret, waveId, 'u-a', undefined, 1000), false);
  assert.equal(checkWaveIdReservation(secret, waveId, 'u-a', `${reservation}.x`, 1000), false);
});

test('an encrypted wave is created under its reserved id, with keys only for its people', { timeout: 120000 }, async () => {
  const r = await scenario(null);
  assert.deepEqual(r.reserved, { id: true, hasReservation: true });
  assert.deepEqual(r.made, { status: 201, sameId: true }, 'the wave takes the id its keys are bound to');
  assert.deepEqual(r.holders, { owner: true, friend: true, blocker: false }, 'format-2 keys stored; none for someone refused');
  assert.equal(r.refused, true);
  assert.equal(r.again, 'WAVE_ID_USED', 'a reservation works once');
  assert.equal(r.someoneElse, 'INVALID_WAVE_RESERVATION', 'only for the person it was made for');
  assert.equal(r.otherId, 'INVALID_WAVE_RESERVATION', 'only for its own id');
  assert.deepEqual(r.bare, { code: 'INVALID_WAVE_RESERVATION', exists: false }, 'nobody names an id unreserved');
  assert.deepEqual(r.legacy, { status: 201, keys: 2 }, 'an older app still creates waves');
  assert.deepEqual(r.crew, { status: 201, crewmate: true, outsider: false }, 'a crew wave keys its whole crew, nobody else');
  assert.deepEqual(r.encrypt, { status: 200, format: 2 });
});

test('counterfactual: without the reservation check anyone names a wave id', { timeout: 120000 }, async () => {
  const r = await scenario(noReservationCheck);
  assert.equal(r.bare.exists, true);
  assert.equal(r.someoneElse, undefined, "someone else's reservation accepted");
});

test('counterfactual: without the holder check someone refused is stored a key', { timeout: 120000 }, async () => {
  const r = await scenario(noHolderCheck);
  assert.equal(r.holders.blocker, true);
  assert.equal(r.crew.outsider, true);
});
