'use strict';

// Groups and travellers (v2.138.0, wave-access phase 6, last part).
//
// A group wave keeps its group when people on other servers join it: the
// group is its people here, and the wave's server lists its people elsewhere
// (recorded when their server accepts, or when they post). The owner can see
// and remove them; their server takes them off its copy, and once nobody there
// is left the wave is no longer sent there. Leaving a copy tells the wave's
// server. On the receiving side, the copy's nominal creator (whoever accepted
// first) can leave and cannot remove anyone.
//
// [SECURITY] Only the server a copy came from can remove people from it. A
// server can report only its own people leaving (the list is kept per server;
// the wave_member_left partner check is a second line).
//
// Counterfactuals: finding the copy by wave id alone, another paired server
// removes people from a conversation it has nothing to do with; without the
// copy rule, whoever accepted first removes the others here.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'FedGroups123!';

function signedRequest({ method, pathname, host, body, privateKey, nodeName }) {
  const bodyString = JSON.stringify(body);
  const digest = `SHA-256=${crypto.createHash('sha256').update(bodyString).digest('base64')}`;
  const date = new Date().toUTCString();
  const signingString = [
    `(request-target): ${method.toLowerCase()} ${pathname}`,
    `host: ${host}`,
    `date: ${date}`,
    `digest: ${digest}`,
  ].join('\n');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signingString);
  const signature = signer.sign(privateKey, 'base64');
  return {
    headers: {
      'Content-Type': 'application/json', Date: date, Digest: digest,
      Signature: `keyId="https://${nodeName}/api/federation/identity#main-key",` +
                 `algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`,
    },
    bodyString,
  };
}

const rsa = () => crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

/** Another server: records what it is sent, answers what it is asked. */
async function fakePeer() {
  const got = [];
  const peer = { got, removal: { ok: true, removed: true, remaining: 0 },
    answer: { status: 200, body: { ok: true, accepted: true, wave: { title: 'From afar', audience: 'people' } } } };
  peer.srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(body || '{}'); } catch { /* ignore */ }
      got.push({ path: req.url, body: json });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/federation/wave-invitations/answer') {
        res.statusCode = peer.answer.status;
        return res.end(JSON.stringify(peer.answer.body));
      }
      if (req.url === '/api/federation/wave-members/remove') {
        return res.end(JSON.stringify(peer.removal));
      }
      if (req.url === '/api/federation/wave-backfill') {
        return res.end(JSON.stringify({ pings: [{ id: 'old-ping-1', content: 'Before you came', createdAt: '2026-11-01T10:00:00.000Z',
          author: { id: 'u-carol', handle: 'carol', displayName: 'Carol' } }], hasMore: false }));
      }
      res.end('{"success":true}');
    });
  });
  await new Promise(r => peer.srv.listen(0, '127.0.0.1', r));
  peer.base = `http://127.0.0.1:${peer.srv.address().port}`;
  peer.of = (type) => got.filter(m => m.body?.type === type).map(m => m.body.payload);
  peer.answers = () => got.filter(m => m.path === '/api/federation/wave-invitations/answer').map(m => m.body);
  return peer;
}

async function run({ anyServerRemoves = false, copyCreatorRemoves = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fedgroups-'));
  const peer = await fakePeer();   // a server whose wave people here are in
  const near = await fakePeer();   // a server people here invite someone on
  let child, output = '';
  try {
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

    const f = path.join(serverDir, 'server.js');
    let src = fs.readFileSync(f, 'utf8');
    if (anyServerRemoves) {
      const find = "const copy = db.getWaveByOrigin(sourceNode.nodeName, originWaveId);\n  if (!copy) return res.status(404).json({ error: 'No such wave here', code: 'NO_COPY' });";
      assert.ok(src.includes(find), 'counterfactual: could not find the copy lookup');
      src = src.replace(find, "const anyCopy = db.db.prepare('SELECT id FROM waves WHERE origin_wave_id = ?').get(originWaveId);\n  const copy = anyCopy && db.getWave(anyCopy.id);\n  if (!copy) return res.status(404).json({ error: 'No such wave here', code: 'NO_COPY' });");
    }
    if (copyCreatorRemoves) {
      const find = "  if (wave.federationState === 'participant') {\n    if (userId !== req.user.userId) {";
      assert.ok(src.includes(find), 'counterfactual: could not find the copy rule');
      src = src.replace(find, "  if (false) {\n    if (userId !== req.user.userId) {");
    }
    fs.writeFileSync(f, src + "\nserver.on('listening', () => console.log('FEDGROUPS_PORT=' + server.address().port));\n");

    const keys = { 'peer.example': rsa(), 'near.example': rsa(), 'far.example': rsa() };
    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const setup = new DatabaseSQLite({ dbPath });
    const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync(password, 4);
    for (const [id, handle] of [['u-alice', 'alice'], ['u-bob', 'bob'], ['u-dave', 'dave']]) {
      setup.createUser({ id, handle, email: `${handle}@example.test`, passwordHash: hash, displayName: handle });
    }
    setup.db.prepare("UPDATE users SET role = 'user'").run();
    const ourKeys = rsa();
    setup.setServerIdentity({ nodeName: 'host.example', publicKey: ourKeys.publicKey, privateKey: ourKeys.privateKey });
    const now = new Date().toISOString();
    for (const [node, base] of [['peer.example', peer.base], ['near.example', near.base], ['far.example', 'http://127.0.0.1:9']]) {
      setup.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                        VALUES (?, ?, ?, ?, 'active', ?)`).run(`fed-${node}`, node, base, keys[node].publicKey, now);
    }
    setup.db.close();

    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-federation-groups-key',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'host.example', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 20000;
    while (!/FEDGROUPS_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }
    const host = `127.0.0.1:${output.match(/FEDGROUPS_PORT=(\d+)/)[1]}`;
    const base = `http://${host}`;

    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, body: json };
    };
    const login = async (handle) => (await api('POST', '/api/auth/login', { body: { handle, password } })).body.token;
    const alice = await login('alice'), bob = await login('bob'), dave = await login('dave');
    const signed = async (from, pathname, body) => {
      const { headers, bodyString } = signedRequest({ method: 'POST', pathname, host, body, privateKey: keys[from].privateKey, nodeName: from });
      const res = await fetch(base + pathname, { method: 'POST', headers, body: bodyString });
      assert.notEqual(res.status, 401, 'signature rejected — the fixture is wrong');
      let json = null;
      try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, body: json };
    };
    const send = (type, payload, from = 'peer.example') =>
      signed(from, '/api/federation/inbox', { id: `env-${crypto.randomUUID()}`, type, payload });
    const copyOf = (originId) => {
      const d = new (require(path.join(root, 'server/node_modules/better-sqlite3')))(dbPath, { readonly: true });
      try { return d.prepare('SELECT id FROM waves WHERE origin_wave_id = ?').get(originId) || null; } finally { d.close(); }
    };
    const invitations = async (token) => (await api('GET', '/api/wave-invitations', { token })).body?.invitations || [];
    const acceptAll = async (token) => { for (const i of await invitations(token)) await api('POST', `/api/wave-invitations/${i.id}/accept`, { token }); };
    const wave = async (token, id) => (await api('GET', `/api/waves/${id}`, { token })).body || {};
    const travellers = async (id) => ((await wave(alice, id)).travellers || []).map(t => t.address).sort();
    const settle = () => new Promise(r => setTimeout(r, 600));
    const r = {};

    // ---- A group wave with someone on another server ----
    const g = (await api('POST', '/api/waves', { token: alice, body: { title: 'Crew and zed', privacy: 'private', participants: ['u-bob', 'u-dave', '@zed@near.example'] } })).body;
    await acceptAll(bob);
    await settle();
    const made = await wave(alice, g.id);
    r.made = { privacy: made.privacy, group: !!made.groupId, origin: made.federationState, bob: (await api('GET', `/api/waves/${g.id}`, { token: bob })).status,
      invited: near.of('wave_invite').map(p => p.invitedUserHandle) };
    await signed('near.example', '/api/federation/wave-invitations/answer', { originWaveId: g.id, handle: 'zed', accepted: true, user: { id: 'u-zed', displayName: 'Zed' } });
    near.got.length = 0;
    await api('PUT', `/api/waves/${g.id}`, { token: alice, body: { allowReplies: false } });
    await settle();
    r.joined = { travellers: await travellers(g.id), name: (await wave(alice, g.id)).travellers?.[0]?.displayName,
      synced: near.of('wave_broadcast').length, still: (await wave(alice, g.id)).privacy };
    // Someone there who joined before anyone recorded it, seen when they post.
    await send('new_ping', { originWaveId: g.id, ping: { id: 'yan-1', content: 'hello', createdAt: now }, author: { id: 'u-yan', handle: 'yan', displayName: 'Yan', nodeName: 'near.example' } }, 'near.example');
    r.seen = await travellers(g.id);
    // A server not in the wave says yan left; then near says so.
    await send('wave_member_left', { originWaveId: g.id, handle: 'yan', remaining: 0 }, 'far.example');
    r.forgedLeave = await travellers(g.id);
    await send('wave_member_left', { originWaveId: g.id, handle: 'yan', remaining: 1 }, 'near.example');
    r.left = await travellers(g.id);

    // Removing zed: only the owner; their server is asked, and with nobody left there the wave stops going.
    r.bobRemoves = (await api('DELETE', `/api/waves/${g.id}/travellers/zed@near.example`, { token: bob })).status;
    near.got.length = 0;
    near.removal = { ok: true, removed: true, remaining: 0 };
    const rm = await api('DELETE', `/api/waves/${g.id}/travellers/zed@near.example`, { token: alice });
    await api('POST', '/api/pings', { token: alice, body: { wave_id: g.id, content: 'After zed' } });
    await settle();
    r.removed = {
      status: rm.status,
      asked: near.got.filter(m => m.path === '/api/federation/wave-members/remove').map(m => `${m.body.originWaveId === g.id}:${m.body.handle}`),
      travellers: await travellers(g.id),
      pings: near.of('new_ping').length,
      backfill: (await signed('near.example', '/api/federation/wave-backfill', { originWaveId: g.id })).status,
    };

    // People elsewhere only join a conversation kept to its people.
    const pub = (await api('POST', '/api/waves', { token: alice, body: { title: 'Open', privacy: 'public' } })).body;
    r.public = {
      invite: (await api('POST', `/api/waves/${pub.id}/invite-federated`, { token: alice, body: { participants: ['@zed@near.example'] } })).body?.code,
      create: (await api('POST', '/api/waves', { token: alice, body: { title: 'Open2', privacy: 'public', participants: ['@zed@near.example'] } })).body?.code,
    };
    // A conversation with someone elsewhere becomes a group of its people here.
    const c = (await api('POST', '/api/waves', { token: alice, body: { title: 'Bob and zed', privacy: 'private', participants: ['u-bob', '@zed@near.example'] } })).body;
    await acceptAll(bob);
    const before = (await wave(alice, c.id)).privacy;
    const grouped = await api('POST', `/api/waves/${c.id}/group`, { token: alice });
    const after = await wave(alice, c.id);
    r.grouped = { before, status: grouped.status, after: after.privacy, origin: after.federationState };

    // ---- Receiving: alice and bob are in a wave from peer.example ----
    for (const handle of ['alice', 'bob']) {
      await send('wave_invite', { wave: { id: 'origin-g', title: 'Theirs' }, invitedUserHandle: handle, invitedBy: { id: 'u-carol', handle: 'carol', displayName: 'Carol' } });
    }
    await acceptAll(alice); await acceptAll(bob);
    const copy = copyOf('origin-g');
    r.copyRemove = (await api('DELETE', `/api/waves/${copy.id}/participants/u-bob`, { token: alice })).status;
    const forged = await signed('far.example', '/api/federation/wave-members/remove', { originWaveId: 'origin-g', handle: 'bob' });
    r.forgedRemove = { status: forged.status, bob: (await api('GET', `/api/waves/${copy.id}`, { token: bob })).status };
    const real = await signed('peer.example', '/api/federation/wave-members/remove', { originWaveId: 'origin-g', handle: 'bob' });
    r.realRemove = { body: real.body, bob: (await api('GET', `/api/waves/${copy.id}`, { token: bob })).status, alice: (await api('GET', `/api/waves/${copy.id}`, { token: alice })).status };
    peer.got.length = 0;
    const leave = await api('DELETE', `/api/waves/${copy.id}/participants/u-alice`, { token: alice });
    await settle();
    r.leave = { status: leave.status, told: peer.of('wave_member_left').map(p => `${p.originWaveId}:${p.handle}:${p.remaining}`), copy: copyOf('origin-g') };

    // Muting someone on another server is saved.
    const mute = await api('POST', '/api/users/u-carol/mute', { token: dave });
    r.mute = { status: mute.status, listed: ((await api('GET', '/api/users/muted', { token: dave })).body?.mutedUsers || []).map(m => `${m.handle}@${m.nodeName}`) };
    return r;
  } finally {
    if (process.env.FG_DEBUG) console.log(output.slice(-2500));
    if (child) child.kill();
    peer.srv.close(); near.srv.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('groups and travellers', { timeout: 120000 }, async (t) => {
  const r = await run();

  await t.test('a group wave keeps its group with someone elsewhere in it', () => {
    assert.deepEqual(r.made, { privacy: 'group', group: true, origin: 'origin', bob: 200, invited: ['zed'] });
  });

  await t.test('their server accepting lists them, and settings reach their server', () => {
    assert.deepEqual(r.joined, { travellers: ['zed@near.example'], name: 'Zed', synced: 1, still: 'group' });
  });

  await t.test('someone who joined before it was recorded is listed when they post', () => {
    assert.deepEqual(r.seen, ['yan@near.example', 'zed@near.example']);
  });

  await t.test('a server can say only that its own people left', () => {
    assert.deepEqual(r.forgedLeave, ['yan@near.example', 'zed@near.example']);
    assert.deepEqual(r.left, ['zed@near.example']);
  });

  await t.test('the owner removes them; their server is asked, and gets nothing more once nobody there is left', () => {
    assert.equal(r.bobRemoves, 403);
    assert.deepEqual(r.removed, { status: 200, asked: ['true:zed'], travellers: [], pings: 0, backfill: 403 });
  });

  await t.test('people elsewhere join only a conversation kept to its people', () => {
    assert.deepEqual(r.public, { invite: 'PUBLIC_WAVE', create: 'CROSS_SERVER' });
    assert.deepEqual(r.grouped, { before: 'crossServer', status: 200, after: 'group', origin: 'origin' });
  });

  await t.test('on a copy, the first to accept cannot remove anyone, and can leave', () => {
    assert.equal(r.copyRemove, 403);
    assert.equal(r.leave.status, 200);
    assert.deepEqual(r.leave.told, ['origin-g:alice:0']);
    assert.equal(r.leave.copy, null, 'nobody here is left, so the copy is gone');
  });

  await t.test('[SECURITY] only the server a copy came from removes people from it', () => {
    assert.deepEqual(r.forgedRemove, { status: 404, bob: 200 });
    assert.deepEqual(r.realRemove, { body: { ok: true, removed: true, remaining: 1 }, bob: 403, alice: 200 });
  });

  await t.test('muting someone on another server is saved', () => {
    assert.deepEqual(r.mute, { status: 200, listed: ['carol@peer.example'] });
  });
});

test('counterfactual: finding the copy by wave id alone, another server removes people from it', { timeout: 120000 }, async () => {
  const r = await run({ anyServerRemoves: true });
  assert.deepEqual(r.forgedRemove, { status: 200, bob: 403 });
});

test('counterfactual: without the copy rule, whoever accepted first removes the others', { timeout: 120000 }, async () => {
  const r = await run({ copyCreatorRemoves: true });
  assert.equal(r.copyRemove, 200);
});
