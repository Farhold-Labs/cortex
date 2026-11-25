'use strict';

// Turning encryption on for a wave with people on other servers (v2.155.0).
//
// Until v2.155.0 it was refused: the other servers hold the wave's earlier
// pings in plain text. Now the wave's own server may, if every server in the
// wave speaks protocol 4. It tells them (`wave_encrypted`), their people ask
// for the key, and the earlier pings, re-encrypted by the creator's device,
// replace the plain copies there (`pings_reencrypted`), their own people's
// included. Decided 2026-11-24: replace them.
//
// One real server (host.example) and fake allies: peer.example is in the
// wave; far.example is allied and in no wave.
//
// host holds the wave:
//   - refused while peer speaks protocol 3; a copy can't be encrypted here;
//   - peer is told, with the wave's servers;
//   - the earlier pings to re-encrypt include zed's (from peer), and those
//     re-encrypted go to peer; plain text in the batch is neither stored nor sent.
// host holds a copy of peer's wave:
//   - only peer's word encrypts it; then cy asks peer for the key;
//   - only peer's batch, only after, replaces the plain copies: zed's and
//     cy's own; not plain text, not a ping of another wave.
//
// [SECURITY] Counterfactual: finding the copy by wave id alone, far.example
// rewrites cy's ping.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'EncryptLater-1!';
const ORIGIN_CHECK = "const copy = typeof rWave === 'string' && db.getWaveByOrigin(sourceNode.nodeName, rWave);\n        if (!copy || copy.federationState !== 'participant' || !db.isWaveEncrypted(copy.id) || !Array.isArray(rPings)) break;";

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

async function fakeServer(answer, history = []) {
  const peer = { got: [], answer, history };
  peer.srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(body || '{}'); } catch { /* ignore */ }
      peer.got.push({ path: req.url, body: json });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/federation/wave-invitations/answer') return res.end(JSON.stringify(peer.answer || {}));
      if (req.url === '/api/federation/wave-backfill') return res.end(JSON.stringify({ pings: peer.history, hasMore: false }));
      if (req.url === '/api/federation/e2ee-keys') return res.end(JSON.stringify({ sealNodeName: null, people: [] }));
      res.end('{"success":true}');
    });
  });
  await new Promise(r => peer.srv.listen(0, '127.0.0.1', r));
  peer.base = `http://127.0.0.1:${peer.srv.address().port}`;
  peer.of = (type) => peer.got.filter(m => m.body?.type === type).map(m => m.body.payload);
  return peer;
}

const b64 = (n) => crypto.randomBytes(n).toString('base64');
const sealed = () => ({ content: b64(48), nonce: b64(12) });
const author = (id, handle, nodeName) => ({ id, handle, displayName: handle, avatar: handle[0].toUpperCase(), ...(nodeName ? { nodeName } : {}) });

async function run({ anyCopy = false } = {}) {
  const c = await import(path.join(root, 'client/crypto.js'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-enclater-'));
  const peer = await fakeServer({ ok: true, accepted: true, wave: { title: 'Their wave', audience: 'people' } }, [
    { id: 'rp-zed-1', content: 'zed in their wave', createdAt: new Date(Date.now() - 60000).toISOString(), reactions: {}, author: author('u-zed', 'zed') },
  ]);
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
    if (anyCopy) {
      assert.ok(src.includes(ORIGIN_CHECK), 'counterfactual: origin check not found');
      src = src.split(ORIGIN_CHECK).join("const anyRow = typeof rWave === 'string' && db.db.prepare('SELECT id FROM waves WHERE origin_wave_id = ?').get(rWave);\n        const copy = anyRow && db.getWave(anyRow.id);\n        if (!copy || copy.federationState !== 'participant' || !db.isWaveEncrypted(copy.id) || !Array.isArray(rPings)) break;");
    }
    fs.writeFileSync(f, src + "\nserver.on('listening', () => console.log('ENCLATER_PORT=' + server.address().port));\n");

    const keys = { 'peer.example': rsa(), 'third.example': rsa(), 'far.example': rsa() };
    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const setup = new DatabaseSQLite({ dbPath });
    const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync(password, 4);
    for (const [id, handle] of [['u-admin', 'xadmin'], ['u-alice', 'alice'], ['u-cy', 'cy']]) {
      setup.createUser({ id, handle, email: `${handle}@example.test`, passwordHash: hash, displayName: handle });
    }
    setup.db.prepare("UPDATE users SET role = 'user' WHERE id != 'u-admin'").run();
    const ours = rsa();
    setup.setServerIdentity({ nodeName: 'host.example', publicKey: ours.publicKey, privateKey: ours.privateKey });
    const now = new Date().toISOString();
    for (const node of Object.keys(fakes)) {
      setup.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at, protocol_version)
                        VALUES (?, ?, ?, ?, 'active', ?, 4)`).run(`fed-${node}`, node, fakes[node].base, keys[node].publicKey, now);
    }
    setup.db.close();

    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-enclater-key-000000000000',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'host.example', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/ENCLATER_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }
    const host = `127.0.0.1:${output.match(/ENCLATER_PORT=(\d+)/)[1]}`;
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
    const inbox = (from, type, payload) => signed(from, '/api/federation/inbox', { id: `env-${crypto.randomUUID()}`, type, payload, protocolVersion: 4 });
    const settle = () => new Promise(r => setTimeout(r, 700));
    const raw = (sql, ...args) => {
      const d = new (require(path.join(root, 'server/node_modules/better-sqlite3')))(dbPath);
      try { return d.prepare(sql)[/^\s*select/i.test(sql) ? 'all' : 'run'](...args); } finally { d.close(); }
    };
    const login = async (handle) => (await api('POST', '/api/auth/login', { body: { handle, password } })).body.token;
    const alice = await login('alice'), cy = await login('cy');
    const r = {};
    for (const t of [alice, cy]) {
      const e = await c.setupUserE2EE(password);
      await api('POST', '/api/e2ee/keys/register', { token: t, body: { publicKey: e.publicKey, encryptedPrivateKey: e.encryptedPrivateKey, salt: e.salt } });
    }
    const key = [{ userId: null, encryptedWaveKey: `${b64(48)}:${b64(12)}`, senderPublicKey: 'spki', format: 2 }];

    // ===== host holds the wave =====
    const w = (await api('POST', '/api/waves', { token: alice, body: { title: 'Later', privacy: 'private', participants: ['@zed@peer.example'] } })).body;
    await settle();
    await signed('peer.example', '/api/federation/wave-invitations/answer', { originWaveId: w.id, handle: 'zed', accepted: true, user: { id: 'u-zed' } });
    await api('POST', '/api/pings', { token: alice, body: { wave_id: w.id, content: 'alice before' } });
    await inbox('peer.example', 'new_ping', { originWaveId: w.id, ping: { id: 'p-zed-1', content: 'zed before', createdAt: new Date().toISOString() }, author: author('u-zed', 'zed', 'peer.example') });
    raw("UPDATE federation_nodes SET protocol_version = 3 WHERE node_name = 'peer.example'");
    const old = await api('POST', `/api/waves/${w.id}/encrypt`, { token: alice, body: { keyDistribution: key } });
    raw("UPDATE federation_nodes SET protocol_version = 4 WHERE node_name = 'peer.example'");
    peer.got.length = 0;
    const on = await api('POST', `/api/waves/${w.id}/encrypt`, { token: alice, body: { keyDistribution: key } });
    await settle();
    const told = peer.of('wave_encrypted')[0];
    r.origin = { old: `${old.status} ${old.body?.code}`, on: on.status, toPing: on.body?.pingsToEncrypt,
      told: told && { wave: told.originWaveId === w.id, version: told.keyVersion, servers: (told.servers || []).slice().sort() } };
    const todo = (await api('GET', `/api/waves/${w.id}/unencrypted-pings?limit=50`, { token: alice })).body.pings;
    r.todo = todo.map(p => p.content).sort();
    const batch = todo.map(p => ({ id: p.id, ...sealed() }));
    batch.push({ id: 'p-zed-1', content: 'still plain text here', nonce: b64(12) });
    const done = (await api('POST', `/api/waves/${w.id}/encrypt-pings`, { token: alice, body: { pings: batch } })).body;
    await settle();
    const sent = peer.of('pings_reencrypted')[0];
    r.reencrypted = { count: done.encryptedCount, complete: done.complete, sent: (sent?.pings || []).length,
      sentCiphertext: (sent?.pings || []).every(p => batch.find(b => b.id === p.id)?.content === p.content && p.content !== 'still plain text here'),
      zed: raw("SELECT encrypted, format FROM remote_pings WHERE id = 'p-zed-1'")[0] };

    // ===== host holds a copy of peer's wave =====
    await inbox('peer.example', 'wave_invite', { wave: { id: 'their-wave', title: 'Their wave' }, participants: [], invitedUserHandle: 'cy', invitedBy: { id: 'u-zed', handle: 'zed', displayName: 'Zed' }, memberCount: 1 });
    const inv = ((await api('GET', '/api/wave-invitations', { token: cy })).body?.invitations || [])[0];
    const copyId = (await api('POST', `/api/wave-invitations/${inv.id}/accept`, { token: cy })).body?.wave?.id;
    await settle();
    const mine = (await api('POST', '/api/pings', { token: cy, body: { wave_id: copyId, content: 'cy before' } })).body;
    // a ping of another wave here (alice's, already re-encrypted above)
    const other = raw('SELECT id, content FROM pings WHERE wave_id = ?', w.id)[0];
    const enc = () => db1(copyId);
    function db1(id) { return raw('SELECT encrypted FROM waves WHERE id = ?', id)[0].encrypted; }
    const state = () => ({
      zed: raw("SELECT encrypted e, content FROM remote_pings WHERE id = 'rp-zed-1'")[0],
      cy: raw('SELECT encrypted e, content FROM pings WHERE id = ?', mine.id)[0],
    });
    const zedSealed = sealed(), cySealed = sealed(), farSealed = sealed();
    // before it is encrypted, a batch is ignored
    await inbox('peer.example', 'pings_reencrypted', { originWaveId: 'their-wave', pings: [{ id: 'rp-zed-1', ...zedSealed, keyVersion: 1 }] });
    r.early = state().zed.e;
    // far's word doesn't encrypt it
    await inbox('far.example', 'wave_encrypted', { originWaveId: 'their-wave', keyVersion: 1, servers: ['far.example'] });
    r.farEncrypt = enc();
    peer.got.length = 0;
    await inbox('peer.example', 'wave_encrypted', { originWaveId: 'their-wave', keyVersion: 1, servers: ['peer.example', 'host.example', 'third.example'] });
    await settle();
    const ask = peer.of('wave_key_request')[0];
    r.copy = { encrypted: enc(), servers: raw('SELECT node_name FROM federated_wave_servers WHERE wave_id = ? ORDER BY node_name', copyId).map(x => x.node_name),
      asked: ask && `${ask.user?.id}:${(ask.versions || []).join(',')}` };
    // far's batch: nothing
    if (anyCopy) raw("UPDATE waves SET encrypted = 1 WHERE origin_wave_id = 'their-wave'");
    await inbox('far.example', 'pings_reencrypted', { originWaveId: 'their-wave', pings: [{ id: mine.id, ...farSealed, keyVersion: 1 }] });
    r.farBatch = state().cy.content === farSealed.content;
    // peer's batch: zed's and cy's replaced; plain text and another wave's ping not
    await inbox('peer.example', 'pings_reencrypted', { originWaveId: 'their-wave', pings: [
      { id: 'rp-zed-1', ...zedSealed, keyVersion: 1 },
      { id: mine.id, ...cySealed, keyVersion: 1 },
      { id: other.id, ...sealed(), keyVersion: 1 },
      { id: 'rp-zed-1', content: 'plain again', nonce: b64(12), keyVersion: 1 },
    ] });
    const after = state();
    r.replaced = { zed: after.zed.e === 1 && after.zed.content === zedSealed.content, cy: after.cy.e === 1 && after.cy.content === cySealed.content,
      other: raw('SELECT content FROM pings WHERE id = ?', other.id)[0].content === other.content };
    return r;
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
    for (const p of Object.values(fakes)) p.srv.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

let fixed;
const fixedRun = () => (fixed ||= run());

test('the wave\'s server encrypts a wave with people elsewhere and sends the re-encrypted history', async () => {
  const r = await fixedRun();
  assert.deepEqual(r.origin, { old: '409 ENCRYPTED_SERVER_NOT_READY', on: 200, toPing: 2, told: { wave: true, version: 1, servers: ['host.example', 'peer.example'] } });
  assert.deepEqual(r.todo, ['alice before', 'zed before']);
  assert.deepEqual(r.reencrypted, { count: 2, complete: true, sent: 2, sentCiphertext: true, zed: { encrypted: 1, format: 1 } });
});

test('a copy is encrypted only by its wave\'s server, then asks for the key and takes the ciphertext', async () => {
  const r = await fixedRun();
  assert.equal(r.early, 0);
  assert.equal(r.farEncrypt, 0);
  assert.deepEqual(r.copy, { encrypted: 1, servers: ['peer.example', 'third.example'], asked: 'u-cy:1' });
  assert.equal(r.farBatch, false);
  assert.deepEqual(r.replaced, { zed: true, cy: true, other: true });
});

test('[SECURITY] counterfactual: finding the copy by wave id alone, another server rewrites a ping here', async () => {
  const r = await run({ anyCopy: true });
  assert.equal(r.farBatch, true);
});
