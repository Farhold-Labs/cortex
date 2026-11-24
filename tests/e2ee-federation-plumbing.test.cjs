'use strict';

// Encryption across servers, phase 2 (v2.152.0, docs/federated-e2ee/01-design.md):
// the plumbing, with encrypted waves and other servers still refused together
// at the door (encryptedTravellersRefusal). The state phase 3 will create is
// made here by hand: an encrypted wave of ours sent to peer.example.
//
// 1. Protocol 3: /identity says so (with the pinned seal name), and an ally's
//    signed envelope updates what we know it speaks.
// 2. Key lookup between servers answers only for people who share an
//    encrypted wave with the asking server. [SECURITY] Counterfactual: without
//    that check, any paired server reads anyone's keys (a directory).
// 3. Encryption fields travel: outgoing pings carry them, incoming ones are
//    stored with them and shown to devices, backfill serves them.
// 4. Plain text from another server into an encrypted wave is dropped.
//    Counterfactual: without the refusal it is stored.
// 5. A device's lookup of someone elsewhere goes through its server, is
//    cached, and asked again after the ally says their keys changed; a key
//    change here is announced to the allies that share a wave.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'Plumbing-123!';
const SHARING_CHECK = '    if (!e2eeSharingNodesFor(userId).has(askerNode)) continue;\n';
const PLAIN_CHECK = '        const plainFromAfar = federatedCiphertextRefusal(localWave.id, fedPing);\n';

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

/** peer.example: records what it is sent; answers key lookups for its zed. */
async function fakePeer() {
  const peer = { got: [], zed: { userId: 'u-zed', handle: 'zed', publicKey: p384(), identityKey: p384() } };
  peer.zed.statements = [{ seq: 1, identityKey: peer.zed.identityKey, encryptionKey: peer.zed.publicKey, signingKey: p384(), issuedAt: '2026-11-24T10:00:00.000Z', signature: b64(96) }];
  peer.srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(body || '{}'); } catch { /* ignore */ }
      peer.got.push({ path: req.url, body: json });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/federation/e2ee-keys') {
        return res.end(JSON.stringify({ sealNodeName: 'peer.example', people: (json.userIds || []).includes('u-zed') ? [peer.zed] : [] }));
      }
      res.end('{"success":true}');
    });
  });
  await new Promise(r => peer.srv.listen(0, '127.0.0.1', r));
  peer.base = `http://127.0.0.1:${peer.srv.address().port}`;
  peer.of = (type) => peer.got.filter(m => m.body?.type === type).map(m => m.body);
  peer.lookups = () => peer.got.filter(m => m.path === '/api/federation/e2ee-keys').length;
  return peer;
}

async function run({ stripSharing = false, stripPlain = false } = {}) {
  const c = await import(path.join(root, 'client/crypto.js'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-plumbing-'));
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
    for (const [on, find, to] of [[stripSharing, SHARING_CHECK, ''], [stripPlain, PLAIN_CHECK, '        const plainFromAfar = null;\n']]) {
      if (!on) continue;
      assert.ok(src.includes(find), 'counterfactual: check not found in server.js');
      src = src.split(find).join(to);
    }
    fs.writeFileSync(f, src + "\nserver.on('listening', () => console.log('PLUMB_PORT=' + server.address().port));\n");

    const keys = { 'peer.example': rsa(), 'far.example': rsa() };
    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const setup = new DatabaseSQLite({ dbPath });
    const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync(password, 4);
    for (const [id, handle] of [['u-admin', 'padmin'], ['u-alice', 'alice'], ['u-bob', 'bob']]) {
      setup.createUser({ id, handle, email: `${handle}@example.test`, passwordHash: hash, displayName: handle });
    }
    const ours = rsa();
    setup.setServerIdentity({ nodeName: 'host.example', publicKey: ours.publicKey, privateKey: ours.privateKey });
    const now = new Date().toISOString();
    for (const [node, base] of [['peer.example', peer.base], ['far.example', 'http://127.0.0.1:9']]) {
      setup.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at, protocol_version)
                        VALUES (?, ?, ?, ?, 'active', ?, 3)`).run(`fed-${node}`, node, base, keys[node].publicKey, now);
    }
    setup.db.close();

    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-e2ee-plumbing-key-000000000',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'host.example', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/PLUMB_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }
    const host = `127.0.0.1:${output.match(/PLUMB_PORT=(\d+)/)[1]}`;
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
    const inbox = (from, type, payload, extra = {}) => signed(from, '/api/federation/inbox', { id: `env-${crypto.randomUUID()}`, type, payload, ...extra });
    const settle = () => new Promise(r => setTimeout(r, 700));
    const raw = (sql, ...args) => {
      const d = new (require(path.join(root, 'server/node_modules/better-sqlite3')))(dbPath);
      try { return d.prepare(sql)[/^\s*select/i.test(sql) ? 'all' : 'run'](...args); } finally { d.close(); }
    };
    const login = async (handle) => (await api('POST', '/api/auth/login', { body: { handle, password } })).body.token;
    const alice = await login('alice'), bob = await login('bob');
    const enc = await c.setupUserE2EE(password);
    await api('POST', '/api/e2ee/keys/register', { token: alice, body: { publicKey: enc.publicKey, encryptedPrivateKey: enc.encryptedPrivateKey, salt: enc.salt } });
    const bobEnc = await c.setupUserE2EE(password);
    await api('POST', '/api/e2ee/keys/register', { token: bob, body: { publicKey: bobEnc.publicKey, encryptedPrivateKey: bobEnc.encryptedPrivateKey, salt: bobEnc.salt } });

    // An encrypted wave of alice's, sent to peer.example: what phase 3 makes.
    const w = await api('POST', '/api/waves', { token: alice, body: {
      title: 'Across', privacy: 'private', participants: [], encrypted: true,
      keyDistribution: [{ userId: null, encryptedWaveKey: 'QUJD:REVG', senderPublicKey: enc.publicKey }],
    } });
    assert.equal(w.status, 201, JSON.stringify(w.body));
    const waveId = w.body.id;
    raw("UPDATE waves SET federation_state = 'origin' WHERE id = ?", waveId);
    raw("INSERT INTO wave_federation (wave_id, node_name, status) VALUES (?, 'peer.example', 'active')", waveId);
    const r = {};

    // 1. Protocol 3
    const ident = (await api('GET', '/api/federation/identity')).body;
    r.identity = { protocol: ident.protocolVersion, e2ee: ident.capabilities.includes('e2ee'), seal: ident.sealNodeName };
    await inbox('far.example', 'decoy', {}, { protocolVersion: 4 });
    r.farSpeaks = raw("SELECT protocol_version AS v FROM federation_nodes WHERE node_name = 'far.example'")[0].v;

    // 2. Key lookup between servers
    const fromPeer = await signed('peer.example', '/api/federation/e2ee-keys', { userIds: ['u-alice', 'u-bob', 'u-nobody'] });
    const fromFar = await signed('far.example', '/api/federation/e2ee-keys', { userIds: ['u-alice', 'u-bob'] });
    r.lookup = {
      peer: fromPeer.body.people.map(p => p.userId), peerKey: fromPeer.body.people[0]?.publicKey === enc.publicKey,
      far: fromFar.body.people.map(p => p.userId), seal: fromPeer.body.sealNodeName,
      tooMany: (await signed('peer.example', '/api/federation/e2ee-keys', { userIds: Array.from({ length: 101 }, (_, i) => `u-${i}`) })).status,
    };

    // 3 + 4. Pings from peer: plain text dropped, ciphertext kept with its fields
    const author = { id: 'u-zed', handle: 'zed', displayName: 'Zed', nodeName: 'peer.example' };
    await inbox('peer.example', 'new_ping', { originWaveId: waveId, author, ping: { id: 'zed-plain', content: 'hello in the clear', createdAt: now } });
    await inbox('peer.example', 'new_ping', { originWaveId: waveId, author, ping: { id: 'zed-sealed', content: b64(64), createdAt: now, encrypted: true, nonce: b64(12), keyVersion: 1, format: 2 } });
    const listPings = async () => { const b = (await api('GET', `/api/waves/${waveId}/pings`, { token: alice })).body; return Array.isArray(b) ? b : (b?.pings || b?.messages || []); };
    const pings = await listPings();
    const sealed = pings.find(p => p.id === 'zed-sealed');
    r.incoming = { plainKept: pings.some(p => p.id === 'zed-plain'), sealed: !!sealed && { encrypted: sealed.encrypted, nonce: !!sealed.nonce, keyVersion: sealed.keyVersion, format: sealed.format } };
    // an edit keeps the fields; a plain edit is dropped
    await inbox('peer.example', 'ping_edited', { pingId: 'zed-sealed', originWaveId: waveId, content: 'now in the clear', editedAt: now });
    const afterPlainEdit = (await listPings()).find(p => p.id === 'zed-sealed');
    r.plainEditKept = afterPlainEdit?.content === 'now in the clear';

    // Outgoing: alice's encrypted ping reaches peer with its fields
    peer.got.length = 0;
    const mine = await api('POST', '/api/pings', { token: alice, body: { wave_id: waveId, content: b64(64), encrypted: true, nonce: b64(12), keyVersion: 1, format: 2 } });
    assert.equal(mine.status, 201, JSON.stringify(mine.body));
    await settle();
    const out = peer.of('new_ping')[0];
    r.outgoing = out && { encrypted: out.payload.ping.encrypted, nonce: !!out.payload.ping.nonce, keyVersion: out.payload.ping.keyVersion, format: out.payload.ping.format, protocol: out.protocolVersion };
    const back = await signed('peer.example', '/api/federation/wave-backfill', { originWaveId: waveId });
    const served = (back.body.pings || []).find(p => p.id === (mine.body.ping || mine.body).id);
    r.backfill = served && { encrypted: served.encrypted, keyVersion: served.keyVersion, format: served.format };

    // 5. A device looks zed up through its server: cached, asked again after a change
    const look = async (token) => api('GET', '/api/e2ee/keys/remote?node=peer.example&userId=u-zed', { token });
    const first = await look(alice);
    const second = await look(alice);
    const lookupsBefore = peer.lookups();
    await inbox('peer.example', 'e2ee_key_changed', { userId: 'u-zed' });
    await look(alice);
    r.remote = {
      status: first.status, key: first.body.publicKey === peer.zed.publicKey, identity: first.body.identityKey === peer.zed.identityKey,
      statement: first.body.statement?.seq, seal: first.body.sealNodeName, cachedSecond: second.status === 200 && lookupsBefore === 1,
      askedAgain: peer.lookups(), bob: (await look(bob)).body?.code,
    };
    // A key change here goes to the allies that share a wave with her
    peer.got.length = 0;
    const identity = await c.generateSigningKeypair();
    const signing = await c.generateSigningKeypair();
    const signingKey = await c.exportPublicKey(signing.publicKey);
    const issuedAt = new Date().toISOString();
    const made = await api('POST', '/api/e2ee/identity', { token: alice, body: {
      mode: 'create', identityKey: await c.exportPublicKey(identity.publicKey), ...(await c.wrapIdentity(identity.privateKey, c.generateRecoveryKey())),
      signingKey, encryptedSigningKey: await c.wrapSigningKey(signing.privateKey, enc.keyPair.privateKey, enc.keyPair.publicKey, 'u-alice'),
      statement: { seq: 1, issuedAt, signature: await c.signKeyStatement(identity.privateKey, { userId: 'u-alice', seq: 1, encryptionKey: enc.publicKey, signingKey, issuedAt }) },
    } });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    await settle();
    r.announced = peer.of('e2ee_key_changed').map(m => m.payload.userId);
    r.statementsTravel = ((await signed('peer.example', '/api/federation/e2ee-keys', { userIds: ['u-alice'] })).body.people[0]?.statements || []).map(s => s.seq);
    return r;
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    peer.srv.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('phase 2: protocol 3, key lookup between servers, encryption fields travel, plain text refused', { timeout: 180000 }, async () => {
  const r = await run();
  assert.deepEqual(r.identity, { protocol: 3, e2ee: true, seal: 'host.example' });
  assert.equal(r.farSpeaks, 4, 'an ally\'s signed envelope says what it speaks');
  assert.deepEqual(r.lookup, { peer: ['u-alice'], peerKey: true, far: [], seal: 'host.example', tooMany: 400 },
    'only people sharing an encrypted wave with the asking server, and nobody to a server that shares none');
  assert.equal(r.incoming.plainKept, false, 'plain text from another server is dropped');
  assert.deepEqual(r.incoming.sealed, { encrypted: true, nonce: true, keyVersion: 1, format: 2 });
  assert.equal(r.plainEditKept, false, 'and so is a plain edit');
  assert.deepEqual(r.outgoing, { encrypted: true, nonce: true, keyVersion: 1, format: 2, protocol: 3 });
  assert.deepEqual(r.backfill, { encrypted: true, keyVersion: 1, format: 2 });
  assert.deepEqual(r.remote, { status: 200, key: true, identity: true, statement: 1, seal: 'peer.example', cachedSecond: true, askedAgain: 2, bob: 'NOT_SHARED' });
  assert.deepEqual(r.announced, ['u-alice']);
  assert.deepEqual(r.statementsTravel, [1]);
});

test('counterfactual: without the sharing check, any paired server reads anyone\'s keys', { timeout: 180000 }, async () => {
  const r = await run({ stripSharing: true });
  assert.deepEqual(r.lookup.far.sort(), ['u-alice', 'u-bob'], 'with the check stripped, far.example gets keys it has no business with');
});

test('counterfactual: without the refusal, plain text from another server is stored in an encrypted wave', { timeout: 180000 }, async () => {
  const r = await run({ stripPlain: true });
  assert.equal(r.incoming.plainKept, true);
});
