'use strict';

// Key requests relayed to every server in an encrypted wave (v2.154.0).
//
// Until v2.154.0 only members on the wave's own server could hand a newcomer
// the key; with all of them offline the newcomer waited. Now the wave's
// server passes each request to the other servers in the wave, and a member
// there answers through it. Each server in the wave is also told which
// servers are in it, so allied servers answer each other's key lookups.
//
// One real server (host.example) and fake allies: peer.example and
// third.example are in the wave; far.example is allied and in no wave.
//
// host holds the wave:
//   - accepting is answered with the wave's servers, and the others are told;
//   - a request from third is passed to peer, not back to third;
//   - peer's member's grant reaches third, wrapped by them, and settles it
//     everywhere; one from far (not in the wave) goes nowhere;
//   - a newcomer here is offered to peer too, and peer's grant is stored for
//     them with who wrapped it, never over a key they have.
// host holds a copy of peer's wave:
//   - accepting stores the wave's servers, and third (in it) may now look up
//     people here; far (not in it) still may not;
//   - a request passed on by peer is offered to members here; one passed on
//     by far, or for someone on a server we are not allied with, is not;
//   - a member's grant goes back to peer, only versions they hold;
//   - peer saying it was settled stops the offer.
//
// [SECURITY] Counterfactuals:
//   - without the in-the-wave check, far.example's grant is passed to third;
//   - finding the copy by wave id alone, far.example's relayed request is offered here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'KeyRelay-1!';
const IN_WAVE_CHECK = "        if (!db.getWaveFederationNodes(ours.id).some(n => n.nodeName === sourceNode.nodeName)) break;\n        if (typeof gId !== 'string'";
const RELAY_COPY = "        const copy = typeof rWave === 'string' && db.getWaveByOrigin(sourceNode.nodeName, rWave);\n";

function signedRequest({ method, pathname, host, body, privateKey, nodeName }) {
  const bodyString = JSON.stringify(body);
  const digest = `SHA-256=${crypto.createHash('sha256').update(bodyString).digest('base64')}`;
  const date = new Date().toUTCString();
  const signingString = [`(request-target): ${method.toLowerCase()} ${pathname}`, `host: ${host}`, `date: ${date}`, `digest: ${digest}`].join('\n');
  const signature = crypto.createSign('RSA-SHA256').update(signingString).sign(privateKey, 'base64');
  return {
    headers: {
      'Content-Type': 'application/json', Date: date, Digest: digest,
      Signature: `keyId="https://${nodeName}/api/federation/identity#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`,
    },
    bodyString,
  };
}
const rsa = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const p384 = () => crypto.generateKeyPairSync('ec', { namedCurve: 'secp384r1' }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const b64 = (n) => crypto.randomBytes(n).toString('base64');
const wrapped = () => `${b64(48)}:${b64(12)}`;

async function fakeServer(answer) {
  const peer = { got: [], answer };
  peer.srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(body || '{}'); } catch { /* ignore */ }
      peer.got.push({ path: req.url, body: json });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/federation/wave-invitations/answer') return res.end(JSON.stringify(peer.answer || {}));
      if (req.url === '/api/federation/wave-backfill') return res.end(JSON.stringify({ pings: [], hasMore: false }));
      if (req.url === '/api/federation/e2ee-keys') return res.end(JSON.stringify({ sealNodeName: null, people: [] }));
      res.end('{"success":true}');
    });
  });
  await new Promise(r => peer.srv.listen(0, '127.0.0.1', r));
  peer.base = `http://127.0.0.1:${peer.srv.address().port}`;
  peer.of = (type) => peer.got.filter(m => m.body?.type === type).map(m => m.body.payload);
  return peer;
}

async function run({ noInWaveCheck = false, relayCopyByIdAlone = false } = {}) {
  const c = await import(path.join(root, 'client/crypto.js'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-relay-'));
  const peer = await fakeServer({ ok: true, accepted: true, wave: { title: 'Their wave', audience: 'people', encrypted: true, keyVersion: 1, servers: ['peer.example', 'third.example', 'host.example'] } });
  const third = await fakeServer();
  const far = await fakeServer();
  const fakes = { 'peer.example': peer, 'third.example': third, 'far.example': far };
  let child, output = '';
  try {
    const serverDir = path.join(temp, 'server');
    fs.mkdirSync(serverDir);
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));
    const f = path.join(serverDir, 'server.js');
    let src = fs.readFileSync(f, 'utf8');
    if (noInWaveCheck) {
      assert.ok(src.includes(IN_WAVE_CHECK), 'counterfactual: in-the-wave check not found');
      src = src.split(IN_WAVE_CHECK).join("        if (typeof gId !== 'string'");
    }
    if (relayCopyByIdAlone) {
      assert.ok(src.includes(RELAY_COPY), 'counterfactual: relay copy lookup not found');
      src = src.split(RELAY_COPY).join("        const anyCopy = typeof rWave === 'string' && db.db.prepare('SELECT id FROM waves WHERE origin_wave_id = ?').get(rWave);\n        const copy = anyCopy && db.getWave(anyCopy.id);\n");
    }
    fs.writeFileSync(f, src + "\nserver.on('listening', () => console.log('RELAY_PORT=' + server.address().port));\n");

    const keys = { 'peer.example': rsa(), 'third.example': rsa(), 'far.example': rsa() };
    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const setup = new DatabaseSQLite({ dbPath });
    const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync(password, 4);
    for (const [id, handle] of [['u-admin', 'xadmin'], ['u-alice', 'alice'], ['u-bob', 'bob'], ['u-cy', 'cy']]) {
      setup.createUser({ id, handle, email: `${handle}@example.test`, passwordHash: hash, displayName: handle });
    }
    setup.db.prepare("UPDATE users SET role = 'user' WHERE id != 'u-admin'").run();
    const ours = rsa();
    setup.setServerIdentity({ nodeName: 'host.example', publicKey: ours.publicKey, privateKey: ours.privateKey });
    const now = new Date().toISOString();
    for (const node of Object.keys(fakes)) {
      setup.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at, protocol_version)
                        VALUES (?, ?, ?, ?, 'active', ?, 3)`).run(`fed-${node}`, node, fakes[node].base, keys[node].publicKey, now);
    }
    setup.db.close();

    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-e2ee-relay-key-00000000000',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'host.example', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/RELAY_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }
    const host = `127.0.0.1:${output.match(/RELAY_PORT=(\d+)/)[1]}`;
    const base = `http://${host}`;
    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      let json = null;
      try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, body: json };
    };
    const signed = async (from, pathname, body) => {
      const { headers, bodyString } = signedRequest({ method: 'POST', pathname, host, body, privateKey: keys[from].privateKey, nodeName: from });
      const res = await fetch(base + pathname, { method: 'POST', headers, body: bodyString });
      assert.notEqual(res.status, 401, 'signature rejected — the fixture is wrong');
      let json = null;
      try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, body: json };
    };
    const inbox = (from, type, payload) => signed(from, '/api/federation/inbox', { id: `env-${crypto.randomUUID()}`, type, payload, protocolVersion: 3 });
    const settle = () => new Promise(r => setTimeout(r, 700));
    const clear = () => { for (const p of Object.values(fakes)) p.got.length = 0; };
    const raw = (sql, ...args) => {
      const d = new (require(path.join(root, 'server/node_modules/better-sqlite3')))(dbPath);
      try { return d.prepare(sql)[/^\s*select/i.test(sql) ? 'all' : 'run'](...args); } finally { d.close(); }
    };
    const login = async (handle) => (await api('POST', '/api/auth/login', { body: { handle, password } })).body.token;
    const alice = await login('alice'), bob = await login('bob'), cy = await login('cy');
    const enc = {};
    for (const [n, t] of [['alice', alice], ['bob', bob], ['cy', cy]]) {
      enc[n] = await c.setupUserE2EE(password);
      await api('POST', '/api/e2ee/keys/register', { token: t, body: { publicKey: enc[n].publicKey, encryptedPrivateKey: enc[n].encryptedPrivateKey, salt: enc[n].salt } });
    }
    const r = {};

    // ===== host holds the wave =====
    const w = await api('POST', '/api/waves', { token: alice, body: {
      title: 'Relayed', privacy: 'private', participants: ['@zed@peer.example', '@yan@third.example'], encrypted: true,
      keyDistribution: [{ userId: null, encryptedWaveKey: wrapped(), senderPublicKey: enc.alice.publicKey, format: 2 }],
    } });
    const waveId = w.body.id;
    await settle();
    const ansPeer = await signed('peer.example', '/api/federation/wave-invitations/answer', { originWaveId: waveId, handle: 'zed', accepted: true, user: { id: 'u-zed' } });
    clear();
    const ansThird = await signed('third.example', '/api/federation/wave-invitations/answer', { originWaveId: waveId, handle: 'yan', accepted: true, user: { id: 'u-yan' } });
    await settle();
    r.servers = {
      inAnswer: (ansThird.body?.wave?.servers || []).slice().sort(),
      toPeer: (peer.of('wave_servers').pop()?.servers || []).slice().sort(),
      peerAnswered: ansPeer.status,
    };

    // yan (third) asks: passed to peer, not back to third
    clear();
    await inbox('third.example', 'wave_key_request', { originWaveId: waveId, user: { id: 'u-yan', handle: 'yan' }, versions: [1] });
    await settle();
    const relayed = peer.of('wave_key_request_relay')[0];
    r.relay = { toPeer: relayed && { user: relayed.user?.id, node: relayed.user?.nodeName, versions: relayed.versions, servers: (relayed.servers || []).length },
      toThird: third.of('wave_key_request_relay').length, toFar: far.of('wave_key_request_relay').length };

    // far (allied, not in the wave) answers it: goes nowhere
    clear();
    await inbox('far.example', 'wave_key_grant_relay', { originWaveId: waveId, requestId: relayed?.requestId, keys: [{ keyVersion: 1, encryptedWaveKey: wrapped(), format: 2 }], senderPublicKey: p384(), sender: { userId: 'u-fay' } });
    await settle();
    r.fromFar = third.of('wave_key_grant').length;

    // zed (peer) answers it: third gets the key, wrapped by zed@peer; settled everywhere
    clear();
    const zedKey = p384();
    await inbox('peer.example', 'wave_key_grant_relay', { originWaveId: waveId, requestId: relayed?.requestId, keys: [{ keyVersion: 1, encryptedWaveKey: wrapped(), format: 2 }, { keyVersion: 7, encryptedWaveKey: wrapped(), format: 2 }], senderPublicKey: zedKey, sender: { userId: 'u-zed', nodeName: 'host.example' } });
    await settle();
    const g = third.of('wave_key_grant')[0];
    r.grant = g && { to: g.userId, versions: g.keys.map(k => k.keyVersion), sender: `${g.sender?.userId}@${g.sender?.nodeName}`, key: g.senderPublicKey === zedKey };
    r.settled = { peer: peer.of('wave_key_request_settled').length, third: third.of('wave_key_request_settled').length,
      offered: (await api('GET', '/api/e2ee/key-requests', { token: alice })).body.requests.filter(q => q.remote?.userId === 'u-yan').length };

    // a newcomer here: offered to peer and third too, and stored from peer's grant
    await api('POST', `/api/waves/${waveId}/participants`, { token: alice, body: { userId: 'u-bob' } });
    for (const i of ((await api('GET', '/api/wave-invitations', { token: bob })).body?.invitations || [])) await api('POST', `/api/wave-invitations/${i.id}/accept`, { token: bob });
    clear();
    const ask = await api('POST', `/api/waves/${waveId}/key-request`, { token: bob });
    await settle();
    const local = peer.of('wave_key_request_relay')[0];
    r.localRelay = { status: ask.status, node: local?.user?.nodeName, user: local?.user?.id, third: third.of('wave_key_request_relay').length };
    await inbox('peer.example', 'wave_key_grant_relay', { originWaveId: waveId, requestId: local?.requestId, keys: [{ keyVersion: 1, encryptedWaveKey: wrapped(), format: 2 }], senderPublicKey: zedKey, sender: { userId: 'u-zed' } });
    const bobRows = () => raw('SELECT key_version v, format f, sender_user_id s, sender_node n, encrypted_wave_key k FROM wave_encryption_keys WHERE wave_id = ? AND user_id = ?', waveId, 'u-bob');
    const first = bobRows();
    r.localStored = first.map(x => `${x.v}:${x.f}:${x.s}@${x.n}`);
    await inbox('peer.example', 'wave_key_grant_relay', { originWaveId: waveId, requestId: local?.requestId, keys: [{ keyVersion: 1, encryptedWaveKey: wrapped(), format: 2 }], senderPublicKey: zedKey, sender: { userId: 'u-zed' } });
    r.localNotOverwritten = bobRows()[0]?.k === first[0]?.k;

    // ===== host holds a copy of peer's wave =====
    await inbox('peer.example', 'wave_invite', { wave: { id: 'their-wave', title: 'Their wave', encrypted: true }, participants: [], invitedUserHandle: 'cy', invitedBy: { id: 'u-zed', handle: 'zed', displayName: 'Zed' }, memberCount: 1 });
    const inv = ((await api('GET', '/api/wave-invitations', { token: cy })).body?.invitations || [])[0];
    const acc = await api('POST', `/api/wave-invitations/${inv.id}/accept`, { token: cy });
    const copyId = acc.body?.wave?.id;
    r.copyServers = raw('SELECT node_name FROM federated_wave_servers WHERE wave_id = ? ORDER BY node_name', copyId).map(x => x.node_name);
    const lookup = async (from) => ((await signed(from, '/api/federation/e2ee-keys', { userIds: ['u-cy'] })).body?.people || []).map(p => p.userId);
    r.lookups = { third: await lookup('third.example'), far: await lookup('far.example') };

    // cy holds version 1 of the copy's key
    await inbox('peer.example', 'wave_key_grant', { originWaveId: 'their-wave', userId: 'u-cy', keys: [{ keyVersion: 1, encryptedWaveKey: wrapped(), format: 2 }], senderPublicKey: zedKey, sender: { userId: 'u-zed', nodeName: 'peer.example' } });

    // relayed requests: from peer for yan@third (kept), from far (not), for someone on a server we aren't allied with (not)
    await inbox('peer.example', 'wave_key_request_relay', { originWaveId: 'their-wave', requestId: 'rkr-origin-1', user: { id: 'u-yan', handle: 'yan', nodeName: 'third.example' }, versions: [1, 4], servers: ['peer.example', 'third.example', 'host.example'] });
    await inbox('far.example', 'wave_key_request_relay', { originWaveId: 'their-wave', requestId: 'rkr-far-1', user: { id: 'u-fay', handle: 'fay', nodeName: 'far.example' }, versions: [1] });
    await inbox('peer.example', 'wave_key_request_relay', { originWaveId: 'their-wave', requestId: 'rkr-origin-2', user: { id: 'u-nan', handle: 'nan', nodeName: 'nowhere.example' }, versions: [1] });
    const offered = (await api('GET', '/api/e2ee/key-requests', { token: cy })).body.requests.filter(q => q.remote);
    r.copyOffered = offered.map(q => `${q.remote.userId}@${q.remote.nodeName}:${q.versions.join(',')}`).sort();
    const yanReq = offered.find(q => q.remote.userId === 'u-yan');

    // cy grants: only versions held go back to peer, as a relayed grant
    r.copyWrongSender = (await api('POST', `/api/waves/${copyId}/key-grant-remote`, { token: cy, body: { requestId: yanReq?.requestId, senderPublicKey: enc.bob.publicKey, keys: [{ keyVersion: 1, encryptedWaveKey: wrapped(), format: 2 }] } })).body?.code;
    clear();
    const cg = await api('POST', `/api/waves/${copyId}/key-grant-remote`, { token: cy, body: { requestId: yanReq?.requestId, senderPublicKey: enc.cy.publicKey,
      keys: [{ keyVersion: 1, encryptedWaveKey: wrapped(), format: 2 }, { keyVersion: 2, encryptedWaveKey: wrapped(), format: 2 }] } });
    await settle();
    const back = peer.of('wave_key_grant_relay')[0];
    r.copyGrant = { status: cg.status, wave: back?.originWaveId, request: back?.requestId, versions: (back?.keys || []).map(k => k.keyVersion), sender: back?.sender?.userId, toThird: third.got.length };

    // peer settles the other request: no longer offered
    await inbox('peer.example', 'wave_key_request_settled', { originWaveId: 'their-wave', requestId: 'rkr-origin-1' });
    r.afterSettled = (await api('GET', '/api/e2ee/key-requests', { token: cy })).body.requests.filter(q => q.remote).length;
    return r;
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    for (const p of Object.values(fakes)) p.srv.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('key requests are relayed to every server in the wave, and answered through its own', { timeout: 180000 }, async () => {
  const r = await run();
  assert.deepEqual(r.servers, { inAnswer: ['host.example', 'peer.example', 'third.example'], toPeer: ['host.example', 'peer.example', 'third.example'], peerAnswered: 200 },
    'the newcomer\'s server is answered with the wave\'s servers; the others are told');
  assert.deepEqual(r.relay, { toPeer: { user: 'u-yan', node: 'third.example', versions: [1], servers: 3 }, toThird: 0, toFar: 0 }, 'passed to the other server in the wave only');
  assert.equal(r.fromFar, 0, 'a grant from a server not in the wave goes nowhere');
  assert.deepEqual(r.grant, { to: 'u-yan', versions: [1], sender: 'u-zed@peer.example', key: true }, 'third gets it wrapped by zed, named by his own server, only versions asked');
  assert.deepEqual(r.settled, { peer: 1, third: 1, offered: 0 }, 'settled everywhere');
  assert.deepEqual(r.localRelay, { status: 200, node: 'host.example', user: 'u-bob', third: 1 }, 'a newcomer here is offered elsewhere too');
  assert.deepEqual(r.localStored, ['1:2:u-zed@peer.example'], 'stored with who wrapped it');
  assert.equal(r.localNotOverwritten, true, 'never over a key they have');
  assert.deepEqual(r.copyServers, ['peer.example', 'third.example'], 'a copy knows the wave\'s servers');
  assert.deepEqual(r.lookups, { third: ['u-cy'], far: [] }, 'a server in the wave may look up people here; one not in it may not');
  assert.deepEqual(r.copyOffered, ['u-yan@third.example:1'], 'only from the wave\'s server, for someone on an allied server, versions that exist');
  assert.equal(r.copyWrongSender, 'SENDER_KEY_MISMATCH');
  assert.deepEqual(r.copyGrant, { status: 200, wave: 'their-wave', request: 'rkr-origin-1', versions: [1], sender: 'u-cy', toThird: 0 }, 'back through the wave\'s server, only versions held');
  assert.equal(r.afterSettled, 0, 'settled there: no longer offered here');
});

test('counterfactual: without the in-the-wave check, a grant from a server not in it is passed on', { timeout: 180000 }, async () => {
  const r = await run({ noInWaveCheck: true });
  assert.equal(r.fromFar, 1);
});

test('counterfactual: finding the copy by wave id alone, a relayed request from a server that isn\'t the wave\'s is offered', { timeout: 180000 }, async () => {
  const r = await run({ relayCopyByIdAlone: true });
  assert.ok(r.copyOffered.includes('u-fay@far.example:1'), JSON.stringify(r.copyOffered));
});
