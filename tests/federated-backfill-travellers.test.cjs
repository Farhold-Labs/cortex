'use strict';

// Late-joining servers get the whole history (v2.155.0).
//
// A server that joins a wave pulls its history from the wave's server
// (/api/federation/wave-backfill). Until v2.155.0 that served only pings
// posted on the wave's own server, never those of its people on other
// servers, which it holds as remote_pings: a third server joining late never
// saw them.
//
// One real server (host.example) and fake allies: peer.example and
// third.example are in the wave; far.example is allied and in no wave.
//
// host holds the wave:
//   - asked without `travellers` (an older server), it serves its own pings only;
//   - asked with it, also peer's person's, labelled with their server, never
//     the asker's own people's, nor deleted or expired ones;
//   - far (not in the wave) is refused.
// host holds a copy of peer's wave:
//   - accepting pulls the history asking for travellers;
//   - pings by people on third are filed as theirs; one claiming to be by
//     someone here is dropped.
//
// [SECURITY] Counterfactual: without the own-server check, a ping the wave's
// server says is by cy, a person here, is filed as hers.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'Backfill-1!';
const OWN_NODE_CHECK = 'if (authorNode === currentNodeName()) { failed++;';

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
      res.end('{"success":true}');
    });
  });
  await new Promise(r => peer.srv.listen(0, '127.0.0.1', r));
  peer.base = `http://127.0.0.1:${peer.srv.address().port}`;
  return peer;
}

const at = (m) => new Date(Date.UTC(2026, 10, 1, 12, m)).toISOString();
const author = (id, handle, nodeName) => ({ id, handle, displayName: handle, avatar: handle[0].toUpperCase(), ...(nodeName ? { nodeName } : {}) });

async function run({ noOwnNodeCheck = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-backfill-'));
  const peer = await fakeServer({ ok: true, accepted: true, wave: { title: 'Their wave', audience: 'people' } }, [
    { id: 'rp-zed-1', content: 'zed here', createdAt: at(3), reactions: {}, author: author('u-zed', 'zed') },
    { id: 'rp-yan-1', content: 'yan from third', createdAt: at(2), reactions: {}, author: author('u-yan', 'yan', 'third.example') },
    { id: 'rp-forged', content: 'not really cy', createdAt: at(1), reactions: {}, author: author('u-cy', 'cy', 'host.example') },
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
    if (noOwnNodeCheck) {
      assert.ok(src.includes(OWN_NODE_CHECK), 'counterfactual: own-server check not found');
      src = src.split(OWN_NODE_CHECK).join('if (false) { failed++;');
    }
    fs.writeFileSync(f, src + "\nserver.on('listening', () => console.log('BACKFILL_PORT=' + server.address().port));\n");

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
                        VALUES (?, ?, ?, ?, 'active', ?, 3)`).run(`fed-${node}`, node, fakes[node].base, keys[node].publicKey, now);
    }
    setup.db.close();

    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-backfill-key-0000000000000',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'host.example', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/BACKFILL_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }
    const host = `127.0.0.1:${output.match(/BACKFILL_PORT=(\d+)/)[1]}`;
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
    const alice = await login('alice'), cy = await login('cy');
    const r = {};

    // ===== host holds the wave =====
    const w = await api('POST', '/api/waves', { token: alice, body: { title: 'History', privacy: 'private', participants: ['@zed@peer.example', '@yan@third.example'] } });
    const waveId = w.body.id;
    await settle();
    await signed('peer.example', '/api/federation/wave-invitations/answer', { originWaveId: waveId, handle: 'zed', accepted: true, user: { id: 'u-zed' } });
    await signed('third.example', '/api/federation/wave-invitations/answer', { originWaveId: waveId, handle: 'yan', accepted: true, user: { id: 'u-yan' } });
    await api('POST', '/api/pings', { token: alice, body: { wave_id: waveId, content: 'alice first' } });
    for (const [from, id, handle, text] of [['peer.example', 'zed', 'zed', 'zed replies'], ['third.example', 'yan', 'yan', 'yan replies']]) {
      await inbox(from, 'new_ping', { originWaveId: waveId, ping: { id: `p-${id}-1`, content: text, createdAt: new Date().toISOString() }, author: author(`u-${id}`, handle, from) });
    }
    await inbox('peer.example', 'new_ping', { originWaveId: waveId, ping: { id: 'p-zed-gone', content: 'deleted', createdAt: new Date().toISOString() }, author: author('u-zed', 'zed', 'peer.example') });
    await inbox('peer.example', 'new_ping', { originWaveId: waveId, ping: { id: 'p-zed-due', content: 'expired', createdAt: new Date().toISOString() }, author: author('u-zed', 'zed', 'peer.example') });
    raw("UPDATE remote_pings SET deleted = 1 WHERE id = 'p-zed-gone'");
    raw("UPDATE remote_pings SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = 'p-zed-due'");
    const page = async (from, travellers) => {
      const res = await signed(from, '/api/federation/wave-backfill', { originWaveId: waveId, limit: 50, ...(travellers ? { travellers: true } : {}) });
      return { status: res.status, pings: (res.body?.pings || []).map(p => `${p.content}|${p.author.handle}@${p.author.nodeName}`).sort() };
    };
    r.older = await page('third.example', false);
    r.newer = await page('third.example', true);
    r.far = (await page('far.example', true)).status;

    // ===== host holds a copy of peer's wave =====
    await inbox('peer.example', 'wave_invite', { wave: { id: 'their-wave', title: 'Their wave' }, participants: [], invitedUserHandle: 'cy', invitedBy: { id: 'u-zed', handle: 'zed', displayName: 'Zed' }, memberCount: 1 });
    const inv = ((await api('GET', '/api/wave-invitations', { token: cy })).body?.invitations || [])[0];
    const acc = await api('POST', `/api/wave-invitations/${inv.id}/accept`, { token: cy });
    const copyId = acc.body?.wave?.id;
    await settle();
    r.asked = peer.got.filter(m => m.path === '/api/federation/wave-backfill').map(m => m.body.travellers);
    r.copy = raw('SELECT id, author_id a, author_node n FROM remote_pings WHERE wave_id = ? ORDER BY id', copyId).map(x => `${x.id}:${x.a}@${x.n}`);
    r.pulled = raw('SELECT wave_id FROM federated_history_pulls WHERE wave_id = ?', copyId).length;
    r.remoteUsers = raw("SELECT handle, node_name FROM remote_users WHERE id IN ('u-yan', 'u-cy') ORDER BY handle").map(x => `${x.handle}@${x.node_name}`);
    return r;
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
    for (const p of Object.values(fakes)) p.srv.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

let fixed;
const fixedRun = () => (fixed ||= run());

test('the wave\'s server serves its travellers\' pings only to a server that asks for them', async () => {
  const r = await fixedRun();
  assert.deepEqual(r.older.pings, ['alice first|alice@host.example']);
  assert.equal(r.newer.status, 200);
  assert.deepEqual(r.newer.pings, ['alice first|alice@host.example', 'zed replies|zed@peer.example']);
  assert.equal(r.far, 403);
});

test('a copy asks for the whole history and files each ping under its author\'s server', async () => {
  const r = await fixedRun();
  assert.deepEqual(r.asked, [true]);
  assert.deepEqual(r.copy, ['rp-yan-1:u-yan@third.example', 'rp-zed-1:u-zed@peer.example']);
  assert.deepEqual(r.remoteUsers, ['yan@third.example']);
  assert.equal(r.pulled, 1, 'a copy pulled at acceptance is recorded, so it is not pulled again');
});

test('[SECURITY] counterfactual: without the own-server check, a ping "by" someone here is filed', async () => {
  const r = await run({ noOwnNodeCheck: true });
  assert.ok(r.copy.includes('rp-forged:u-cy@host.example'), 'the forged ping should land without the check: ' + JSON.stringify(r.copy));
});
