'use strict';

// Encryption across servers, phase 3 (v2.153.0, docs/federated-e2ee/01-design.md).
//
// One real server (host.example) and a fake ally (peer.example, protocol 3),
// plus old.example (protocol 2) and far.example (allied, in no wave).
//
// The wave's own server (host is origin):
//   - an encrypted wave may include people on a protocol-3 server, not on an
//     older one (ENCRYPTED_SERVER_NOT_READY);
//   - the ally's acceptance is answered with encrypted + the key version;
//   - a key request from the ally for its own member is kept and offered to
//     members here; one for someone not in the wave is refused;
//   - a member's grant goes to the ally as wave_key_grant, with who wrapped it;
//   - a renewal sends each server its own people's keys and the new version;
//   - someone elsewhere leaving marks the wave for a new key.
// A copy here of the ally's wave (host is the copy's server):
//   - accepting makes the copy encrypted at the ally's version;
//   - a key request is passed to the ally;
//   - keys are taken only from the ally that owns the wave, only for people in
//     the copy, never over a key someone has, with who wrapped them;
//   - a renewal there moves the copy's version.
//
// [SECURITY] Counterfactuals:
//   - finding the copy by wave id alone, far.example hands people here a key;
//   - without the membership check, a key request for someone not in the wave
//     is kept (and pushed to members' devices; the list they read re-checks).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'AcrossServers-1!';
const COPY_BY_ORIGIN = "        const copy = typeof kWave === 'string' && db.getWaveByOrigin(sourceNode.nodeName, kWave);\n";
const MEMBER_CHECK = '        if (!rqId || !remoteWaveMember(ours.id, sourceNode.nodeName, rqId)) {\n';

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

async function fakePeer() {
  const peer = { got: [], answer: { ok: true, accepted: true, wave: { title: 'Their wave', audience: 'people', encrypted: true, keyVersion: 2 } } };
  peer.zedKey = p384();
  peer.srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(body || '{}'); } catch { /* ignore */ }
      peer.got.push({ path: req.url, body: json });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/federation/wave-invitations/answer') return res.end(JSON.stringify(peer.answer));
      if (req.url === '/api/federation/wave-backfill') return res.end(JSON.stringify({ pings: [], hasMore: false }));
      if (req.url === '/api/federation/e2ee-keys') {
        return res.end(JSON.stringify({ sealNodeName: 'peer.example', people: (json.userIds || []).includes('u-zed') ? [{ userId: 'u-zed', handle: 'zed', publicKey: peer.zedKey, identityKey: null, statements: [] }] : [] }));
      }
      res.end('{"success":true}');
    });
  });
  await new Promise(r => peer.srv.listen(0, '127.0.0.1', r));
  peer.base = `http://127.0.0.1:${peer.srv.address().port}`;
  peer.of = (type) => peer.got.filter(m => m.body?.type === type).map(m => m.body.payload);
  return peer;
}

async function run({ copyByIdAlone = false, noMemberCheck = false } = {}) {
  const c = await import(path.join(root, 'client/crypto.js'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-across-'));
  const peer = await fakePeer();
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
    if (copyByIdAlone) {
      assert.ok(src.includes(COPY_BY_ORIGIN), 'counterfactual: copy lookup not found');
      src = src.split(COPY_BY_ORIGIN).join("        const anyCopy = typeof kWave === 'string' && db.db.prepare('SELECT id FROM waves WHERE origin_wave_id = ?').get(kWave);\n        const copy = anyCopy && db.getWave(anyCopy.id);\n");
    }
    if (noMemberCheck) {
      assert.ok(src.includes(MEMBER_CHECK), 'counterfactual: member check not found');
      src = src.split(MEMBER_CHECK).join('        if (!rqId) {\n');
    }
    fs.writeFileSync(f, src + "\nserver.on('listening', () => console.log('ACROSS_PORT=' + server.address().port));\n");

    const keys = { 'peer.example': rsa(), 'old.example': rsa(), 'far.example': rsa() };
    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const setup = new DatabaseSQLite({ dbPath });
    const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync(password, 4);
    for (const [id, handle] of [['u-admin', 'xadmin'], ['u-alice', 'alice'], ['u-bob', 'bob']]) {
      setup.createUser({ id, handle, email: `${handle}@example.test`, passwordHash: hash, displayName: handle });
    }
    setup.db.prepare("UPDATE users SET role = 'user' WHERE id != 'u-admin'").run();
    const ours = rsa();
    setup.setServerIdentity({ nodeName: 'host.example', publicKey: ours.publicKey, privateKey: ours.privateKey });
    const now = new Date().toISOString();
    for (const [node, base, v] of [['peer.example', peer.base, 3], ['old.example', 'http://127.0.0.1:9', 2], ['far.example', 'http://127.0.0.1:9', 3]]) {
      setup.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at, protocol_version)
                        VALUES (?, ?, ?, ?, 'active', ?, ?)`).run(`fed-${node}`, node, base, keys[node].publicKey, now, v);
    }
    setup.db.close();

    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-e2ee-across-key-0000000000',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'host.example', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/ACROSS_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }
    const host = `127.0.0.1:${output.match(/ACROSS_PORT=(\d+)/)[1]}`;
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
    const raw = (sql, ...args) => {
      const d = new (require(path.join(root, 'server/node_modules/better-sqlite3')))(dbPath);
      try { return d.prepare(sql)[/^\s*select/i.test(sql) ? 'all' : 'run'](...args); } finally { d.close(); }
    };
    const login = async (handle) => (await api('POST', '/api/auth/login', { body: { handle, password } })).body.token;
    const alice = await login('alice'), bob = await login('bob');
    const aliceEnc = await c.setupUserE2EE(password);
    await api('POST', '/api/e2ee/keys/register', { token: alice, body: { publicKey: aliceEnc.publicKey, encryptedPrivateKey: aliceEnc.encryptedPrivateKey, salt: aliceEnc.salt } });
    const bobEnc = await c.setupUserE2EE(password);
    await api('POST', '/api/e2ee/keys/register', { token: bob, body: { publicKey: bobEnc.publicKey, encryptedPrivateKey: bobEnc.encryptedPrivateKey, salt: bobEnc.salt } });
    const r = {};

    // ===== host is the wave's own server =====
    const make = (participants) => api('POST', '/api/waves', { token: alice, body: {
      title: 'Across', privacy: 'private', participants, encrypted: true,
      keyDistribution: [{ userId: null, encryptedWaveKey: wrapped(), senderPublicKey: aliceEnc.publicKey }],
    } });
    const old = await make(['@ola@old.example']);
    r.oldServer = { status: old.status, code: old.body?.code, servers: old.body?.servers };
    const w = await make(['@zed@peer.example']);
    r.created = w.status;
    const waveId = w.body.id;
    await settle();
    r.invitedEncrypted = peer.of('wave_invite')[0]?.wave?.encrypted;
    const accepted = await signed('peer.example', '/api/federation/wave-invitations/answer', { originWaveId: waveId, handle: 'zed', accepted: true, user: { id: 'u-zed', displayName: 'Zed' } });
    r.answer = { status: accepted.status, encrypted: accepted.body?.wave?.encrypted, keyVersion: accepted.body?.wave?.keyVersion, seal: accepted.body?.wave?.sealNodeName };

    // A key request for zed (in the wave), and one for someone who isn't
    await inbox('peer.example', 'wave_key_request', { originWaveId: waveId, user: { id: 'u-zed', handle: 'zed' }, versions: [1, 9] });
    await inbox('peer.example', 'wave_key_request', { originWaveId: waveId, user: { id: 'u-yan', handle: 'yan' }, versions: [1] });
    await inbox('far.example', 'wave_key_request', { originWaveId: waveId, user: { id: 'u-zed', handle: 'zed' }, versions: [1] });
    const offered = (await api('GET', '/api/e2ee/key-requests', { token: alice })).body.requests;
    r.yanKept = raw("SELECT COUNT(*) AS n FROM remote_wave_key_requests WHERE user_id = 'u-yan'")[0].n;
    r.offered = offered.filter(q => q.remote).map(q => `${q.remote.userId}@${q.remote.nodeName}:${q.versions.join(',')}`).sort();
    const zedRequest = offered.find(q => q.remote?.userId === 'u-zed');

    // alice's device grants it
    peer.got.length = 0;
    const g = await api('POST', `/api/waves/${waveId}/key-grant-remote`, { token: alice, body: {
      requestId: zedRequest.requestId, senderPublicKey: aliceEnc.publicKey, keys: [{ keyVersion: 1, encryptedWaveKey: wrapped(), format: 2 }],
    } });
    await settle();
    const grant = peer.of('wave_key_grant')[0];
    r.granted = { status: g.status, to: grant?.userId, versions: (grant?.keys || []).map(k => k.keyVersion), sender: grant?.sender?.userId, senderNode: grant?.sender?.nodeName,
      settled: (await api('GET', '/api/e2ee/key-requests', { token: alice })).body.requests.filter(q => q.remote?.userId === 'u-zed').length };
    r.wrongSender = (await api('POST', `/api/waves/${waveId}/key-grant-remote`, { token: alice, body: { requestId: zedRequest.requestId, senderPublicKey: bobEnc.publicKey, keys: [{ keyVersion: 1, encryptedWaveKey: wrapped() }] } })).body?.code;

    // Renewal: each server gets its own people's keys and the new version
    peer.got.length = 0;
    const badRemote = await api('POST', `/api/waves/${waveId}/key/rotate`, { token: alice, body: { keyVersion: 2, keyDistribution: [
      { userId: null, encryptedWaveKey: wrapped(), senderPublicKey: aliceEnc.publicKey, format: 2 },
      { remote: { nodeName: 'peer.example', userId: 'u-yan' }, encryptedWaveKey: wrapped(), senderPublicKey: aliceEnc.publicKey, format: 2 },
    ] } });
    const staleVersion = await api('POST', `/api/waves/${waveId}/key/rotate`, { token: alice, body: { keyVersion: 5, keyDistribution: [
      { userId: null, encryptedWaveKey: wrapped(), senderPublicKey: aliceEnc.publicKey, format: 2 },
    ] } });
    const rot = await api('POST', `/api/waves/${waveId}/key/rotate`, { token: alice, body: { keyVersion: 2, keyDistribution: [
      { userId: null, encryptedWaveKey: wrapped(), senderPublicKey: aliceEnc.publicKey, format: 2 },
      { remote: { nodeName: 'peer.example', userId: 'u-zed' }, encryptedWaveKey: wrapped(), senderPublicKey: aliceEnc.publicKey, format: 2 },
    ] } });
    await settle();
    const rotated = peer.of('wave_key_rotated')[0];
    r.rotation = { badRemote: badRemote.body?.code, stale: staleVersion.body?.code, status: rot.status, version: rotated?.keyVersion, to: (rotated?.keys || []).map(k => k.userId) };

    // A pending renewal is skipped when none is needed (another device made it)
    const notNeeded = await api('POST', `/api/waves/${waveId}/key/rotate`, { token: alice, body: { ifNeeded: true, keyVersion: 3, keyDistribution: [
      { userId: null, encryptedWaveKey: wrapped(), senderPublicKey: aliceEnc.publicKey, format: 2 },
    ] } });
    r.skipped = { skipped: notNeeded.body?.skipped, version: notNeeded.body?.newKeyVersion };

    // zed leaves on peer: the wave needs a new key; told twice, it is marked once
    await inbox('peer.example', 'wave_member_left', { originWaveId: waveId, handle: 'zed', remaining: 0 });
    r.rekey = (await api('GET', `/api/waves/${waveId}`, { token: alice })).body?.rekeyNeeded;
    raw('UPDATE wave_key_metadata SET rekey_needed_at = NULL WHERE wave_id = ?', waveId);
    await inbox('peer.example', 'wave_member_left', { originWaveId: waveId, handle: 'zed', remaining: 0 });
    r.rekeyAgain = (await api('GET', `/api/waves/${waveId}`, { token: alice })).body?.rekeyNeeded;
    // zed's keys can still be looked up for his old pings in it
    raw("INSERT INTO remote_pings (id, wave_id, origin_wave_id, origin_node, author_id, author_node, content, created_at) VALUES ('zp1', ?, ?, 'peer.example', 'u-zed', 'peer.example', 'x', ?)", waveId, waveId, now);
    const afterLeaving = await api('GET', '/api/e2ee/keys/remote?node=peer.example&userId=u-zed', { token: alice });
    r.zedStillChecked = { status: afterLeaving.status, key: afterLeaving.body?.publicKey === peer.zedKey };

    // ===== host holds a copy of peer's wave =====
    await inbox('peer.example', 'wave_invite', { wave: { id: 'their-wave', title: 'Their wave', encrypted: true }, participants: [], invitedUserHandle: 'bob', invitedBy: { id: 'u-zed', handle: 'zed', displayName: 'Zed' }, memberCount: 1 });
    const inv = ((await api('GET', '/api/wave-invitations', { token: bob })).body?.invitations || [])[0];
    peer.got.length = 0;
    const acc = await api('POST', `/api/wave-invitations/${inv.id}/accept`, { token: bob });
    await settle();
    r.askedAtAccept = peer.of('wave_key_request').map(p => `${p.user?.id}:${(p.versions || []).join(',')}`);
    const copyId = acc.body?.wave?.id;
    r.copy = { status: acc.status, encrypted: acc.body?.wave?.encrypted,
      version: raw('SELECT current_key_version AS v FROM wave_key_metadata WHERE wave_id = ?', copyId)[0]?.v,
      flag: raw('SELECT encrypted FROM waves WHERE id = ?', copyId)[0]?.encrypted };

    peer.got.length = 0;
    const ask = await api('POST', `/api/waves/${copyId}/key-request`, { token: bob });
    await settle();
    const forwarded = peer.of('wave_key_request')[0];
    r.ask = { status: ask.status, versions: ask.body?.versions, forwarded: forwarded && { wave: forwarded.originWaveId, user: forwarded.user?.id, versions: forwarded.versions } };

    // Keys: from far (not the wave's server) ignored; for alice (not in the copy) ignored; for bob stored
    const theKeys = [{ keyVersion: 1, encryptedWaveKey: wrapped(), format: 2 }, { keyVersion: 2, encryptedWaveKey: wrapped(), format: 2 }];
    const zedKey = p384();
    await inbox('far.example', 'wave_key_grant', { originWaveId: 'their-wave', userId: 'u-bob', keys: theKeys, senderPublicKey: zedKey, sender: { userId: 'u-zed', nodeName: 'far.example' } });
    r.fromFar = raw('SELECT COUNT(*) AS n FROM wave_encryption_keys WHERE wave_id = ? AND user_id = ?', copyId, 'u-bob')[0].n;
    await inbox('peer.example', 'wave_key_grant', { originWaveId: 'their-wave', userId: 'u-alice', keys: theKeys, senderPublicKey: zedKey, sender: { userId: 'u-zed', nodeName: 'peer.example' } });
    r.notInCopy = raw('SELECT COUNT(*) AS n FROM wave_encryption_keys WHERE wave_id = ? AND user_id = ?', copyId, 'u-alice')[0].n;
    await inbox('peer.example', 'wave_key_grant', { originWaveId: 'their-wave', userId: 'u-bob', keys: theKeys, senderPublicKey: zedKey, sender: { userId: 'u-zed', nodeName: 'peer.example' } });
    const rows = raw('SELECT key_version, format, sender_user_id, sender_node, encrypted_wave_key FROM wave_encryption_keys WHERE wave_id = ? AND user_id = ? ORDER BY key_version', copyId, 'u-bob');
    r.stored = rows.map(x => `${x.key_version}:${x.format}:${x.sender_user_id}@${x.sender_node}`);
    const firstKey = rows[0]?.encrypted_wave_key;
    await inbox('peer.example', 'wave_key_grant', { originWaveId: 'their-wave', userId: 'u-bob', keys: [{ keyVersion: 1, encryptedWaveKey: wrapped(), format: 2 }], senderPublicKey: zedKey, sender: { userId: 'u-zed' } });
    r.notOverwritten = raw('SELECT encrypted_wave_key AS k FROM wave_encryption_keys WHERE wave_id = ? AND user_id = ? AND key_version = 1', copyId, 'u-bob')[0]?.k === firstKey;
    const seen = (await api('GET', `/api/waves/${copyId}/key`, { token: bob })).body;
    r.seenByDevice = { origin: seen.originWaveId, sender: seen.senderUserId, node: seen.senderNode, format: seen.format };

    // Renewal at peer moves the copy's version and brings bob's key
    await inbox('peer.example', 'wave_key_rotated', { originWaveId: 'their-wave', keyVersion: 3, keys: [{ userId: 'u-bob', encryptedWaveKey: wrapped(), format: 2 }], senderPublicKey: zedKey, sender: { userId: 'u-zed', nodeName: 'peer.example' } });
    r.copyRenewed = { version: raw('SELECT current_key_version AS v FROM wave_key_metadata WHERE wave_id = ?', copyId)[0]?.v,
      bobHas3: raw('SELECT COUNT(*) AS n FROM wave_encryption_keys WHERE wave_id = ? AND user_id = ? AND key_version = 3', copyId, 'u-bob')[0].n };
    // bob's encrypted ping in the copy is sent to peer, with its fields
    peer.got.length = 0;
    const sent = await api('POST', '/api/pings', { token: bob, body: { wave_id: copyId, content: b64(64), encrypted: true, nonce: b64(12), keyVersion: 3, format: 2 } });
    await settle();
    r.copyPing = { status: sent.status, out: peer.of('new_ping')[0]?.ping?.keyVersion, plain: (await api('POST', '/api/pings', { token: bob, body: { wave_id: copyId, content: 'in the clear' } })).body?.code };
    // A copy is renewed at its own server, never here
    r.copyRotate = (await api('POST', `/api/waves/${copyId}/key/rotate`, { token: bob, body: { keyDistribution: [{ userId: null, encryptedWaveKey: wrapped(), senderPublicKey: bobEnc.publicKey }] } })).status;
    return r;
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    peer.srv.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('phase 3: encrypted waves with people on other servers, keys through the wave\'s server', { timeout: 180000 }, async () => {
  const r = await run();
  assert.deepEqual(r.oldServer, { status: 409, code: 'ENCRYPTED_SERVER_NOT_READY', servers: ['old.example'] });
  assert.equal(r.created, 201);
  assert.equal(r.invitedEncrypted, true);
  assert.deepEqual(r.answer, { status: 200, encrypted: true, keyVersion: 1, seal: 'host.example' });
  assert.deepEqual(r.offered, ['u-zed@peer.example:1'], 'only zed, who is in the wave, from his own server, at versions that exist');
  assert.equal(r.yanKept, 0, 'a request for someone not in the wave is not kept');
  assert.deepEqual(r.granted, { status: 200, to: 'u-zed', versions: [1], sender: 'u-alice', senderNode: 'host.example', settled: 0 });
  assert.equal(r.wrongSender, 'SENDER_KEY_MISMATCH');
  assert.deepEqual(r.rotation, { badRemote: 'BAD_REMOTE_KEY', stale: 'KEY_MEMBERS_CHANGED', status: 200, version: 2, to: ['u-zed'] });
  assert.deepEqual(r.skipped, { skipped: true, version: 2 }, 'nothing pending: a pending renewal is skipped');
  assert.equal(r.rekey, true, 'someone elsewhere leaving needs a new key');
  assert.equal(r.rekeyAgain, false, 'told again after they were gone, it is not marked again');
  assert.deepEqual(r.zedStillChecked, { status: 200, key: true }, 'his old pings can still be checked');
  assert.deepEqual(r.askedAtAccept, ['u-bob:1,2'], 'accepting an encrypted wave asks for its keys at once');
  assert.deepEqual(r.copy, { status: 200, encrypted: true, version: 2, flag: 1 });
  assert.deepEqual(r.ask, { status: 200, versions: [1, 2], forwarded: { wave: 'their-wave', user: 'u-bob', versions: [1, 2] } });
  assert.equal(r.fromFar, 0, 'keys only from the wave\'s own server');
  assert.equal(r.notInCopy, 0, 'only for people in the copy');
  assert.deepEqual(r.stored, ['1:2:u-zed@peer.example', '2:2:u-zed@peer.example']);
  assert.equal(r.notOverwritten, true);
  assert.deepEqual(r.seenByDevice, { origin: 'their-wave', sender: 'u-zed', node: 'peer.example', format: 2 });
  assert.deepEqual(r.copyRenewed, { version: 3, bobHas3: 1 });
  assert.deepEqual(r.copyPing, { status: 201, out: 3, plain: 'ENCRYPTION_REQUIRED' });
  assert.equal(r.copyRotate, 403, 'a copy is renewed at its own server');
});

test('counterfactual: finding the copy by wave id alone, a server that isn\'t the wave\'s hands out keys', { timeout: 180000 }, async () => {
  const r = await run({ copyByIdAlone: true });
  assert.equal(r.fromFar, 2, 'with the origin check stripped, far.example\'s keys are stored');
});

test('counterfactual: without the membership check, a request for someone not in the wave is kept', { timeout: 180000 }, async () => {
  const r = await run({ noMemberCheck: true });
  assert.equal(r.yanKept, 1, 'with the check stripped, the request is kept (offering re-checks, a second line)');
});
