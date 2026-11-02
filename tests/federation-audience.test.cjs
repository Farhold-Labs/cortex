'use strict';

// [SECURITY] Who may read a Verse-Wide wave (v2.136.1).
//
// "Verse-Wide" meant two things. A broadcast, sent to every allied server for
// everyone there to read (Cortex Updates). And a conversation someone opened to
// a person on another server. The receiving server could not tell them apart
// and let every account read every federated copy, so inviting @alice@there
// into a private conversation shared it with all of "there". And on the
// sending server, changing such a wave's settings re-sent it as a broadcast to
// every allied server.
//
// Now each Verse-Wide wave says whether it is everyone's ('everyone', a
// broadcast) or its people's. Only an instance admin makes a broadcast; a
// broadcast is everyone's on its home server too. Copies from before are
// sorted by how they were made: a broadcast's copy has an id starting `wave-`.
//
// Counterfactuals: with the old rule ("every federated copy is everyone's"), a
// person not invited reads the private conversation; with the old targets
// ("every allied server"), a settings change sends it to a server nobody on
// it was invited from.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'FedAudience123!';

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

async function recorder() {
  const got = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try { got.push(JSON.parse(body || '{}')); } catch { /* ignore */ }
      res.setHeader('Content-Type', 'application/json');
      res.end('{"success":true}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { got, srv, base: `http://127.0.0.1:${srv.address().port}` };
}

async function run({ oldRule = false, oldTargets = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fedaud-'));
  const near = await recorder();   // an allied server someone here invited a person on
  const far = await recorder();    // an allied server nobody invited anyone on
  const peer = await recorder();   // the server inviting alice; answers whatever it is asked
  let child;
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

    if (oldRule) {
      const f = path.join(serverDir, 'server.js');
      let s = fs.readFileSync(f, 'utf8');
      const rule = "&& wave.federationAudience === 'everyone') return true;";
      assert.ok(s.includes(rule), 'counterfactual: could not find the audience rule');
      s = s.replace(rule, "&& wave.federationState === 'participant') return true;");
      fs.writeFileSync(f, s);
    }

    if (oldTargets) {
      const f = path.join(serverDir, 'server.js');
      let s = fs.readFileSync(f, 'utf8');
      const targets = "wave.federationAudience === 'everyone' ? allActive : allActive.filter(n => joined.has(n.nodeName));";
      assert.ok(s.includes(targets), 'counterfactual: could not find the broadcast targets');
      s = s.replace(targets, 'allActive;');
      fs.writeFileSync(f, s);
    }

    const keys = { 'peer.example': rsa(), 'near.example': rsa() };
    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const setup = new DatabaseSQLite({ dbPath });
    const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync(password, 4);
    for (const [id, handle] of [['u-admin', 'admin'], ['u-alice', 'alice'], ['u-bob', 'bob']]) {
      setup.createUser({ id, handle, email: `${handle}@example.test`, passwordHash: hash, displayName: handle });
    }
    setup.db.prepare("UPDATE users SET role = 'admin' WHERE id = 'u-admin'").run();
    setup.db.prepare("UPDATE users SET role = 'user' WHERE id != 'u-admin'").run();
    const ourKeys = rsa();
    setup.setServerIdentity({ nodeName: 'host.example', publicKey: ourKeys.publicKey, privateKey: ourKeys.privateKey });
    const now = new Date().toISOString();
    for (const [node, base, key] of [
      ['peer.example', peer.base, keys['peer.example'].publicKey],
      ['near.example', near.base, keys['near.example'].publicKey],
      ['far.example', far.base, rsa().publicKey],
    ]) {
      setup.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                        VALUES (?, ?, ?, ?, 'active', ?)`).run(`fed-${node}`, node, base, key, now);
    }
    // Copies from before v2.136.1, with no recorded audience: one made by an
    // invitation (a bare id), one by a broadcast (an id starting `wave-`).
    for (const [id, title] of [['3f2a9c1e-old-invite', 'Old invitation'], ['wave-old-broadcast', 'Old broadcast']]) {
      setup.db.prepare(`INSERT INTO waves (id, title, privacy, created_by, created_at, updated_at, federation_state, origin_node, origin_wave_id)
                        VALUES (?, ?, 'crossServer', 'u-admin', ?, ?, 'participant', 'peer.example', ?)`).run(id, title, now, now, `origin-${id}`);
    }
    setup.db.prepare("UPDATE waves SET federation_audience = NULL").run();
    setup.db.close();

    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('FEDAUD_PORT=' + server.address().port));\n");
    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-federation-audience-key',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'host.example', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 20000;
    while (!/FEDAUD_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }
    const host = `127.0.0.1:${output.match(/FEDAUD_PORT=(\d+)/)[1]}`;
    const base = `http://${host}`;
    const INBOX = '/api/federation/inbox';

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
    const admin = await login('admin'), alice = await login('alice'), bob = await login('bob');
    const send = async (type, payload) => {
      const body = { id: `env-${crypto.randomUUID()}`, type, payload };
      const { headers, bodyString } = signedRequest({ method: 'POST', pathname: INBOX, host, body, privateKey: keys['peer.example'].privateKey, nodeName: 'peer.example' });
      const res = await fetch(base + INBOX, { method: 'POST', headers, body: bodyString });
      assert.notEqual(res.status, 401, 'signature rejected — the fixture is wrong');
    };
    const copyOf = (originId) => {
      const d = new (require(path.join(root, 'server/node_modules/better-sqlite3')))(dbPath, { readonly: true });
      try { return d.prepare('SELECT id, federation_audience FROM waves WHERE origin_wave_id = ?').get(originId); } finally { d.close(); }
    };
    const read = async (token, id) => (await api('GET', `/api/waves/${id}`, { token })).status;
    const listed = async (token, id) => ((await api('GET', '/api/waves', { token })).body || []).some(w => w.id === id);
    const settle = () => new Promise(r => setTimeout(r, 600));
    const r = {};

    // Sorted at boot.
    r.backfill = { invitation: await read(bob, '3f2a9c1e-old-invite'), broadcast: await read(bob, 'wave-old-broadcast') };

    // An invitation for alice from another server.
    await send('wave_invite', { wave: { id: 'origin-chat', title: 'Private chat', privacy: 'crossServer' }, invitedUserHandle: 'alice', participants: [] });
    // v2.137.0: she is asked; the copy is made when she accepts.
    const question = ((await api('GET', '/api/wave-invitations', { token: alice })).body?.invitations || [])[0];
    await api('POST', `/api/wave-invitations/${question.id}/accept`, { token: alice });
    const chat = copyOf('origin-chat');
    r.invited = { audience: chat?.federation_audience, alice: await read(alice, chat.id), bob: await read(bob, chat.id), bobLists: await listed(bob, chat.id) };

    // A broadcast from a server that says nothing about audience (older peer).
    await send('wave_broadcast', { wave: { id: 'origin-news', title: 'News' }, participants: [] });
    const news = copyOf('origin-news');
    r.broadcast = { audience: news?.federation_audience, bob: await read(bob, news.id), bobLists: await listed(bob, news.id) };
    // A settings update for a conversation nobody here is in makes nothing.
    await send('wave_broadcast', { wave: { id: 'origin-secret', title: 'Secret' }, audience: 'people', participants: [] });
    r.peopleUnknown = copyOf('origin-secret') || null;
    // The origin keeps a former broadcast to its people.
    await send('wave_broadcast', { wave: { id: 'origin-news', title: 'News' }, audience: 'people', participants: [] });
    r.unbroadcast = await read(bob, news.id);

    // Sending: alice opens a conversation to someone on near.example.
    const ours = (await api('POST', '/api/waves', { token: alice, body: { title: 'Ours', privacy: 'private' } })).body;
    r.memberBroadcast = (await api('PUT', `/api/waves/${ours.id}`, { token: alice, body: { privacy: 'crossServer' } })).body?.code;
    await api('POST', `/api/waves/${ours.id}/invite-federated`, { token: alice, body: { participants: ['@zed@near.example'] } });
    // v2.137.0: zed accepts, through his server.
    {
      const body = { originWaveId: ours.id, handle: 'zed', accepted: true };
      const pathname = '/api/federation/wave-invitations/answer';
      const { headers, bodyString } = signedRequest({ method: 'POST', pathname, host, body, privateKey: keys['near.example'].privateKey, nodeName: 'near.example' });
      assert.equal((await fetch(base + pathname, { method: 'POST', headers, body: bodyString })).status, 200);
    }
    await settle();
    // A settings change used to re-send it to every allied server.
    near.got.length = 0; far.got.length = 0;
    await api('PUT', `/api/waves/${ours.id}`, { token: alice, body: { allowReplies: false } });
    await settle();
    r.settingsSync = {
      near: near.got.map(m => `${m.type}:${m.payload?.audience}`),
      far: far.got.map(m => m.type),
    };
    r.oursForBob = await read(bob, ours.id);
    // An admin broadcasts it: everyone's, here and everywhere.
    far.got.length = 0;
    const b = await api('POST', `/api/waves/${ours.id}/broadcast`, { token: admin, body: { everyone: true } });
    await settle();
    r.adminBroadcast = { status: b.status, far: far.got.map(m => `${m.type}:${m.payload?.audience}`), bob: await read(bob, ours.id) };
    r.memberBroadcastRoute = (await api('POST', `/api/waves/${ours.id}/broadcast`, { token: alice, body: { everyone: false } })).status;
    return r;
  } finally {
    if (child) child.kill();
    near.srv.close(); far.srv.close(); peer.srv.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('who may read a Verse-Wide wave', { timeout: 120000 }, async (t) => {
  const r = await run();

  await t.test('copies from before are sorted by how they were made', () => {
    assert.deepEqual(r.backfill, { invitation: 403, broadcast: 200 });
  });

  await t.test('an invitation from another server is the invitee\'s, not the whole server\'s', () => {
    assert.deepEqual(r.invited, { audience: 'people', alice: 200, bob: 403, bobLists: false });
  });

  await t.test('a broadcast is everyone\'s; the origin decides, and may take it back', () => {
    assert.deepEqual(r.broadcast, { audience: 'everyone', bob: 200, bobLists: true });
    assert.equal(r.peopleUnknown, null, 'no copy for a conversation nobody here is in');
    assert.equal(r.unbroadcast, 403);
  });

  await t.test('sending: a conversation stays with the servers its people are on', () => {
    assert.equal(r.memberBroadcast, 'BROADCAST_ADMIN_ONLY');
    assert.deepEqual(r.settingsSync, { near: ['wave_broadcast:people'], far: [] });
    assert.equal(r.oursForBob, 403);
  });

  await t.test('only an admin broadcasts, and a broadcast is everyone\'s at home too', () => {
    assert.deepEqual(r.adminBroadcast, { status: 200, far: ['wave_broadcast:everyone'], bob: 200 });
    assert.equal(r.memberBroadcastRoute, 403);
  });
});

test('counterfactual: with every federated copy everyone\'s, the uninvited read the private conversation', { timeout: 120000 }, async () => {
  const r = await run({ oldRule: true });
  assert.equal(r.invited.bob, 200);
});

test('counterfactual: sending to every allied server, a settings change reaches the uninvited server', { timeout: 120000 }, async () => {
  const r = await run({ oldTargets: true });
  assert.ok(r.settingsSync.far.includes('wave_broadcast'));
});
