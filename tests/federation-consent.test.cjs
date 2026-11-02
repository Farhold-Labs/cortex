'use strict';

// People on other servers are asked (v2.137.0, wave-access phase 6).
//
// Until now an invitation from another server put the person straight into
// the conversation, and the wave's server started sending it there at once.
// Now their own server asks them, holds nothing of the wave until they accept,
// and answers the wave's server, which only then counts that server as one of
// the wave's (so it gets pings and may fetch the history).
//
// [SECURITY] Answering needs an invitation: a paired server cannot join a wave
// by claiming someone on it accepted. Blocks are honoured across servers, and a
// block of someone on another server is saved (it used to fail a foreign key).
//
// Counterfactuals: without the invitation check on the wave's server, a paired
// server nobody invited joins and reads the history; without the block check on
// the invitee's server, someone who blocked the inviter is still asked.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'FedConsent123!';

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
  const peer = { got, answer: { status: 200, body: { ok: true, accepted: true, wave: { title: 'From afar', audience: 'people' } } } };
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

async function run({ noInvitationCheck = false, noHomeBlockCheck = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fedconsent-'));
  const peer = await fakePeer();   // invites people here
  const near = await fakePeer();   // people here invite someone there
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

    const f = path.join(serverDir, 'server.js');
    let src = fs.readFileSync(f, 'utf8');
    if (noInvitationCheck) {
      const check = "&& db.findRemoteWaveInvitation(wave.id, sourceNode.nodeName, handle);";
      assert.ok(src.includes(check), 'counterfactual: could not find the invitation check');
      src = src.replace(check, "&& (db.findRemoteWaveInvitation(wave.id, sourceNode.nodeName, handle) || { id: 'claimed' });");
    }
    if (noHomeBlockCheck) {
      const check = "// Blocked: declined, and the inviter is not told why.\n        if (";
      assert.ok(src.includes(check), 'counterfactual: could not find the block check');
      src = src.replace(check, '// Blocked check removed\n        if (false) if (');
    }
    fs.writeFileSync(f, src + "\nserver.on('listening', () => console.log('FEDCONSENT_PORT=' + server.address().port));\n");

    const keys = { 'peer.example': rsa(), 'near.example': rsa(), 'far.example': rsa() };
    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const setup = new DatabaseSQLite({ dbPath });
    const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync(password, 4);
    for (const [id, handle] of [['u-alice', 'alice'], ['u-bob', 'bob'], ['u-dave', 'dave'], ['u-erin', 'erin']]) {
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

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-federation-consent-key',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'host.example', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 20000;
    while (!/FEDCONSENT_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }
    const host = `127.0.0.1:${output.match(/FEDCONSENT_PORT=(\d+)/)[1]}`;
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
    const alice = await login('alice'), bob = await login('bob'), dave = await login('dave'), erin = await login('erin');
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
    const settle = () => new Promise(r => setTimeout(r, 600));
    const carol = { id: 'u-carol', handle: 'carol', displayName: 'Carol' };
    const r = {};

    // ---- Invited from another server ----
    await send('wave_invite', { wave: { id: 'origin-chat', title: 'Chat', createdBy: 'u-carol' }, invitedUserHandle: 'alice', invitedBy: carol, participants: [carol], memberCount: 1 });
    // A ping for it before anyone here accepted.
    await send('new_ping', { originWaveId: 'origin-chat', ping: { id: 'early-ping', content: 'Hi', createdAt: now }, author: { ...carol, nodeName: 'peer.example' } });
    const asked = (await invitations(alice)).find(i => i.kind === 'federated');
    r.asked = {
      copy: copyOf('origin-chat'),
      invitation: asked && { originNode: asked.originNode, title: asked.waveTitle, by: asked.invitedBy?.handle },
    };
    const acc = await api('POST', `/api/wave-invitations/${asked.id}/accept`, { token: alice });
    await settle();
    const chat = copyOf('origin-chat');
    const pings = chat && (await api('GET', `/api/waves/${chat.id}`, { token: alice })).body;
    r.accepted = {
      status: acc.status,
      answer: peer.answers().map(a => `${a.originWaveId}:${a.handle}:${a.accepted}`),
      alice: chat && (await api('GET', `/api/waves/${chat.id}`, { token: alice })).status,
      bob: chat && (await api('GET', `/api/waves/${chat.id}`, { token: bob })).status,
      history: JSON.stringify(pings || {}).includes('Before you came'),
      left: (await invitations(alice)).length,
    };

    // Bob blocks carol (someone on another server); she invites him.
    peer.got.length = 0;
    const blocked = await api('POST', '/api/users/u-carol/block', { token: bob });
    const list = (await api('GET', '/api/users/blocked', { token: bob })).body?.blockedUsers || [];
    await send('wave_invite', { wave: { id: 'origin-two', title: 'Two', createdBy: 'u-carol' }, invitedUserHandle: 'bob', invitedBy: carol, participants: [carol] });
    await settle();
    r.blocked = {
      saved: blocked.status, listed: list.map(b => `${b.handle}@${b.nodeName}`),
      bobAsked: (await invitations(bob)).length,
      answer: peer.answers().map(a => `${a.handle}:${a.accepted}`),
    };

    // Dave declines and blocks.
    peer.got.length = 0;
    await send('wave_invite', { wave: { id: 'origin-three', title: 'Three', createdBy: 'u-carol' }, invitedUserHandle: 'dave', invitedBy: carol, participants: [carol] });
    const daveInv = (await invitations(dave))[0];
    await api('POST', `/api/wave-invitations/${daveInv.id}/decline`, { token: dave, body: { block: true } });
    await settle();
    r.declined = {
      answer: peer.answers().map(a => `${a.handle}:${a.accepted}`),
      daveBlocked: ((await api('GET', '/api/users/blocked', { token: dave })).body?.blockedUsers || []).map(b => b.handle),
      copy: copyOf('origin-three'),
    };

    // Withdrawn by the wave's server; and one that is gone when accepted.
    await send('wave_invite', { wave: { id: 'origin-four', title: 'Four', createdBy: 'u-carol' }, invitedUserHandle: 'erin', invitedBy: carol });
    const beforeWithdraw = (await invitations(erin)).length;
    await send('wave_invite_withdrawn', { originWaveId: 'origin-four', handle: 'erin' });
    r.withdrawn = { before: beforeWithdraw, after: (await invitations(erin)).length };
    await send('wave_invite', { wave: { id: 'origin-five', title: 'Five', createdBy: 'u-carol' }, invitedUserHandle: 'erin', invitedBy: carol });
    peer.answer = { status: 404, body: { error: 'No such invitation', code: 'INVITATION_GONE' } };
    const gone = await api('POST', `/api/wave-invitations/${(await invitations(erin))[0].id}/accept`, { token: erin });
    r.gone = { status: gone.status, left: (await invitations(erin)).length, copy: copyOf('origin-five') };

    // ---- Inviting someone on another server ----
    const ours = (await api('POST', '/api/waves', { token: alice, body: { title: 'Ours', privacy: 'private', participants: ['@zed@near.example'] } })).body;
    await settle();
    const invite = near.of('wave_invite')[0];
    await api('POST', '/api/pings', { token: alice, body: { wave_id: ours.id, content: 'Before zed answers' } });
    await settle();
    const shown = (await api('GET', `/api/waves/${ours.id}`, { token: alice })).body?.invited || [];
    r.sent = {
      invite: invite && { handle: invite.invitedUserHandle, by: invite.invitedBy?.handle },
      pingsBeforeAnswer: near.of('new_ping').length,
      shown: shown.map(i => i.handle),
      backfillBefore: (await signed('near.example', '/api/federation/wave-backfill', { originWaveId: ours.id })).status,
    };

    // A paired server claims someone accepted, nobody having been asked.
    const claim = await signed('far.example', '/api/federation/wave-invitations/answer', { originWaveId: ours.id, handle: 'mallory', accepted: true });
    r.claim = {
      status: claim.status,
      backfill: (await signed('far.example', '/api/federation/wave-backfill', { originWaveId: ours.id })).status,
    };

    // Zed accepts, through his server.
    const answered = await signed('near.example', '/api/federation/wave-invitations/answer', { originWaveId: ours.id, handle: 'zed', accepted: true });
    near.got.length = 0;
    await api('POST', '/api/pings', { token: alice, body: { wave_id: ours.id, content: 'Welcome' } });
    await settle();
    r.joined = {
      status: answered.status, title: answered.body?.wave?.title,
      pings: near.of('new_ping').length,
      backfill: (await signed('near.example', '/api/federation/wave-backfill', { originWaveId: ours.id })).status,
      again: (await signed('near.example', '/api/federation/wave-invitations/answer', { originWaveId: ours.id, handle: 'zed', accepted: true })).status,
      shown: ((await api('GET', `/api/waves/${ours.id}`, { token: alice })).body?.invited || []).length,
    };

    // Withdrawing an invitation to someone elsewhere tells their server.
    near.got.length = 0;
    const inv2 = await api('POST', `/api/waves/${ours.id}/invite-federated`, { token: alice, body: { participants: ['@yan@near.example'] } });
    const pending = ((await api('GET', `/api/waves/${ours.id}`, { token: alice })).body?.invited || []).find(i => i.remote);
    const wd = await api('DELETE', `/api/wave-invitations/${pending.invitationId}`, { token: alice });
    await settle();
    r.withdraw = {
      invited: inv2.body?.results?.invited, status: wd.status,
      told: near.of('wave_invite_withdrawn').map(p => p.handle),
      bobCannot: (await api('POST', `/api/waves/${ours.id}/invite-federated`, { token: bob, body: { participants: ['@yan@near.example'] } })).status,
    };

    // Alice blocks zed (known here from his ping): he can't be invited again.
    await send('new_ping', { originWaveId: ours.id, ping: { id: 'zed-ping', content: 'Thanks', createdAt: new Date().toISOString() },
      author: { id: 'u-zed', handle: 'zed', displayName: 'Zed', nodeName: 'near.example' } }, 'near.example');
    await api('POST', '/api/users/u-zed/block', { token: alice });
    near.got.length = 0;
    const again = (await api('POST', '/api/waves', { token: alice, body: { title: 'Again', privacy: 'private', participants: ['@zed@near.example'] } })).body;
    await settle();
    r.aliceBlocked = { refused: again.refused, sent: near.of('wave_invite').length };
    return r;
  } finally {
    if (child) child.kill();
    peer.srv.close(); near.srv.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('people on other servers are asked', { timeout: 120000 }, async (t) => {
  const r = await run();

  await t.test('an invitation from another server is a question, and nothing of the wave is here', () => {
    assert.deepEqual(r.asked, { copy: null, invitation: { originNode: 'peer.example', title: 'Chat', by: 'carol@peer.example' } });
  });

  await t.test('accepting answers their server, then makes the wave and fetches its history', () => {
    assert.deepEqual(r.accepted, { status: 200, answer: ['origin-chat:alice:true'], alice: 200, bob: 403, history: true, left: 0 });
  });

  await t.test('a block of someone on another server is saved, and declines their invitations', () => {
    assert.deepEqual(r.blocked, { saved: 200, listed: ['carol@peer.example'], bobAsked: 0, answer: ['bob:false'] });
  });

  await t.test('declining (and blocking) tells their server no, and keeps nothing', () => {
    assert.deepEqual(r.declined, { answer: ['dave:false'], daveBlocked: ['carol'], copy: null });
  });

  await t.test('withdrawn and expired invitations go away', () => {
    assert.deepEqual(r.withdrawn, { before: 1, after: 0 });
    assert.deepEqual(r.gone, { status: 410, left: 0, copy: null });
  });

  await t.test('sending: their server is asked, and gets nothing of the wave until they accept', () => {
    assert.deepEqual(r.sent, { invite: { handle: 'zed', by: 'alice' }, pingsBeforeAnswer: 0, shown: ['zed@near.example'], backfillBefore: 403 });
  });

  await t.test('[SECURITY] a paired server cannot join a wave by claiming someone accepted', () => {
    assert.deepEqual(r.claim, { status: 404, backfill: 403 });
  });

  await t.test('once they accept, their server is one of the wave\'s', () => {
    assert.deepEqual(r.joined, { status: 200, title: 'Ours', pings: 1, backfill: 200, again: 404, shown: 0 });
  });

  await t.test('withdrawing tells their server; only the creator invites travellers', () => {
    assert.deepEqual(r.withdraw, { invited: ['@yan@near.example'], status: 200, told: ['yan'], bobCannot: 403 });
  });

  await t.test('someone the inviter blocked on another server is not asked', () => {
    assert.deepEqual(r.aliceBlocked, { refused: ['@zed@near.example'], sent: 0 });
  });
});

test('counterfactual: without the invitation check, a paired server joins and reads the history', { timeout: 120000 }, async () => {
  const r = await run({ noInvitationCheck: true });
  assert.deepEqual(r.claim, { status: 200, backfill: 200 });
});

test('counterfactual: without the block check, someone who blocked the inviter is still asked', { timeout: 120000 }, async () => {
  const r = await run({ noHomeBlockCheck: true });
  assert.equal(r.blocked.bobAsked, 1);
});
