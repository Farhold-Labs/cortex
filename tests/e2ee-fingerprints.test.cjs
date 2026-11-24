'use strict';

// Encryption across servers, phase 1 (v2.149.0, docs/federated-e2ee/).
//
// 1. Fingerprints: SHA-256 over "cortex-fp-v1" ‖ SPKI, first 16 bytes, as
//    8 groups of 4 upper-case hex. Checked against node:crypto.
// 2. Format 2: a wrapped wave key bound to its wave, version and recipient,
//    and a ping bound to its wave and author. Devices read it from this
//    release; nothing writes it yet. A key or ping moved to another place
//    must not open, and format 2 must never open as format 1.
//    Counterfactual: the same crypto.js with the binding (associated data)
//    stripped opens a ping moved to another wave, so the test fails for the
//    right reason.
// 3. Verified: a mark is for one key; a change drops it and says so.
// 4. The server stores and returns each ping's and wrapped key's format,
//    refuses an unknown one, and tells a device who it is in a seal.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const nodeCrypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const loadCrypto = () => import(path.join(root, 'client/crypto.js'));
const loadRecords = () => import(path.join(root, 'client/src/utils/keyRecords.js'));

test('a fingerprint is the first 128 bits of SHA-256 over the label and the key, in 8 groups', async () => {
  const c = await loadCrypto();
  const pair = await c.generateUserKeypair();
  const spki = await c.exportPublicKey(pair.publicKey);
  const expected = nodeCrypto.createHash('sha256')
    .update(Buffer.concat([Buffer.from('cortex-fp-v1'), Buffer.from(spki, 'base64')]))
    .digest().subarray(0, 16).toString('hex').toUpperCase().match(/.{4}/g).join(' ');
  const fp = await c.keyFingerprint(spki);
  assert.equal(fp, expected);
  assert.match(fp, /^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
  const other = await c.exportPublicKey((await c.generateUserKeypair()).publicKey);
  assert.notEqual(await c.keyFingerprint(other), fp);
});

async function formatTwo(c) {
  const alice = await c.generateUserKeypair();
  const bob = await c.generateUserKeypair();
  const waveKey = await c.generateWaveKey();
  const bobAddress = c.personAddress('user-bob', 'dev.farhold.com');
  const ctx = (wave, version, who) => c.waveKeyContext(wave, version, who);
  const wrap = await c.encryptWaveKey(waveKey, bob.publicKey, alice.privateKey, { format: 2, context: ctx('wave-1', 3, bobAddress) });
  const open = (context, opts = { format: 2 }) => c.decryptWaveKey(wrap.encryptedKey, wrap.nonce, alice.publicKey, bob.privateKey, { ...opts, context })
    .then(() => true, () => false);

  const aliceAddress = c.personAddress('user-alice', 'dev.farhold.com');
  const ping = await c.encryptPing('the plan', waveKey, { format: 2, context: c.pingContext('wave-1', aliceAddress) });
  const read = (context, format = 2) => c.decryptPing(ping.ciphertext, ping.nonce, waveKey, { format, context })
    .then(t => t, () => null);

  return {
    keyOpens: await open(ctx('wave-1', 3, bobAddress)),
    keyOtherWave: await open(ctx('wave-2', 3, bobAddress)),
    keyOtherVersion: await open(ctx('wave-1', 2, bobAddress)),
    keyOtherRecipient: await open(ctx('wave-1', 3, c.personAddress('user-carol', 'dev.farhold.com'))),
    keyOtherServer: await open(ctx('wave-1', 3, c.personAddress('user-bob', 'qa.farhold.com'))),
    keyAsFormatOne: await open(null, { format: 1 }),
    pingReads: await read(c.pingContext('wave-1', aliceAddress)),
    pingMoved: await read(c.pingContext('wave-2', aliceAddress)),
    pingOtherAuthor: await read(c.pingContext('wave-1', c.personAddress('user-mallory', 'dev.farhold.com'))),
    pingAsFormatOne: await read(null, 1),
  };
}

test('format 2 binds a wrapped key to its wave, version and recipient, and a ping to its wave and author', async () => {
  const c = await loadCrypto();
  const r = await formatTwo(c);
  assert.deepEqual(r, {
    keyOpens: true, keyOtherWave: false, keyOtherVersion: false, keyOtherRecipient: false, keyOtherServer: false, keyAsFormatOne: false,
    pingReads: 'the plan', pingMoved: null, pingOtherAuthor: null, pingAsFormatOne: null,
  });

  // Format 1 is unchanged: everything written so far still opens.
  const a = await c.generateUserKeypair();
  const b = await c.generateUserKeypair();
  const wk = await c.generateWaveKey();
  const w1 = await c.encryptWaveKey(wk, b.publicKey, a.privateKey);
  const k1 = await c.decryptWaveKey(w1.encryptedKey, w1.nonce, a.publicKey, b.privateKey);
  const p1 = await c.encryptPing('old', wk);
  assert.equal(await c.decryptPing(p1.ciphertext, p1.nonce, k1), 'old');

  // Format 2 without its context is refused, not quietly read as format 1.
  await assert.rejects(c.decryptPing(p1.ciphertext, p1.nonce, k1, { format: 2 }), /seal context/);
  // No field may contain the separator, so two lists can't give the same bytes.
  assert.throws(() => c.pingContext('wave\u00001', 'x@y'), /Invalid seal context/);
  assert.throws(() => c.waveKeyContext('wave-1', 0, 'x@y'), /Invalid seal context/);
  assert.notDeepEqual(c.pingContext('ab', 'c@d'), c.pingContext('a', 'bc@d'));
});

test('counterfactual: without the binding, a ping moved to another wave opens', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fmt2-cf-'));
  try {
    let src = fs.readFileSync(path.join(root, 'client/crypto.js'), 'utf8');
    const strip = [
      ["format === 2 ? { name: 'AES-GCM', iv: nonce, additionalData: requireContext(context) } : { name: 'AES-GCM', iv: nonce }", "{ name: 'AES-GCM', iv: nonce }"],
    ];
    for (const [from, to] of strip) {
      assert.ok(src.includes(from), 'binding not found in crypto.js');
      src = src.split(from).join(to);
    }
    const copy = path.join(temp, 'crypto.mjs');
    fs.writeFileSync(copy, src);
    const r = await formatTwo(await import(copy));
    assert.equal(r.pingMoved, 'the plan', 'with the binding stripped, the moved ping should open');
    assert.equal(r.pingOtherAuthor, 'the plan');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('a verification is for one key: a change drops it and says so until the new key is verified', async () => {
  const k = await loadRecords();
  let rec = k.emptyKeyRecords();
  rec = k.noteKey(rec, 'zoe', 'KEY-A', '2026-11-23T10:00:00Z').records;
  assert.equal(k.keyStanding(rec, 'zoe', 'KEY-A'), 'seen');

  // Only the key on record can be verified.
  assert.equal(k.markVerified(rec, 'zoe', 'KEY-OTHER'), rec);
  rec = k.markVerified(rec, 'zoe', 'KEY-A', '2026-11-23T10:05:00Z');
  assert.equal(k.keyStanding(rec, 'zoe', 'KEY-A'), 'verified');
  assert.equal(k.keyStanding(rec, 'zoe', 'KEY-B'), 'unknown');

  // The key changes: the verification does not carry over.
  const changed = k.noteKey(rec, 'zoe', 'KEY-B', '2026-11-23T11:00:00Z');
  assert.equal(changed.status, 'changed');
  rec = changed.records;
  assert.equal(k.keyStanding(rec, 'zoe', 'KEY-B'), 'lost');
  assert.deepEqual(k.unacknowledgedChanges(rec), [{ personId: 'zoe', changedAt: '2026-11-23T11:00:00Z', verificationLost: true }]);

  // Seeing the flag doesn't verify anything; it still says the verification is gone.
  rec = k.acknowledgeKeyChange(rec, 'zoe');
  assert.equal(k.keyStanding(rec, 'zoe', 'KEY-B'), 'lost');

  // Verifying the new key clears it; a third key loses it again.
  rec = k.markVerified(rec, 'zoe', 'KEY-B', '2026-11-23T11:10:00Z');
  assert.equal(k.keyStanding(rec, 'zoe', 'KEY-B'), 'verified');
  rec = k.noteKey(rec, 'zoe', 'KEY-C', '2026-11-23T12:00:00Z').records;
  assert.equal(k.keyStanding(rec, 'zoe', 'KEY-C'), 'lost');

  // A change for someone never verified is only 'changed'.
  let other = k.noteKey(k.emptyKeyRecords(), 'wash', 'W1').records;
  other = k.noteKey(other, 'wash', 'W2').records;
  assert.equal(k.keyStanding(other, 'wash', 'W2'), 'changed');

  // Unverifying.
  let u = k.markVerified(k.emptyKeyRecords(), 'kaylee', 'K1', '2026-11-23T09:00:00Z');
  u = k.unmarkVerified(u, 'kaylee', '2026-11-23T09:30:00Z');
  assert.equal(k.keyStanding(u, 'kaylee', 'K1'), 'seen');
});

test('two devices: the later of a verification and an unverification wins', async () => {
  const k = await loadRecords();
  const base = k.noteKey(k.emptyKeyRecords(), 'zoe', 'KEY-A', '2026-11-23T10:00:00Z').records;
  const phone = k.markVerified(base, 'zoe', 'KEY-A', '2026-11-23T10:05:00Z');
  const laptop = k.unmarkVerified(k.markVerified(base, 'zoe', 'KEY-A', '2026-11-23T10:01:00Z'), 'zoe', '2026-11-23T10:02:00Z');
  assert.equal(k.keyStanding(k.mergeKeyRecords(phone, laptop), 'zoe', 'KEY-A'), 'verified');
  assert.equal(k.keyStanding(k.mergeKeyRecords(laptop, phone), 'zoe', 'KEY-A'), 'verified');
  const later = k.unmarkVerified(phone, 'zoe', '2026-11-23T10:09:00Z');
  assert.equal(k.keyStanding(k.mergeKeyRecords(phone, later), 'zoe', 'KEY-A'), 'seen');
});

test('the server keeps each ping and wrapped key format, refuses unknown ones, and names the device in a seal', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fmt2-'));
  const password = 'Format2pass!';
  let child;
  try {
    const serverDir = path.join(temp, 'server');
    fs.mkdirSync(serverDir);
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));
    fs.appendFileSync(path.join(serverDir, 'server.js'), "\nserver.on('listening', () => console.log('FMT2_PORT=' + server.address().port));\n");
    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-format-two-000000000000',
        SEED_DEMO_DATA: 'false', FEDERATION_NODE_NAME: 'fmt2.example.test',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/FMT2_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/FMT2_PORT=(\d+)/)[1]}`;
    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, body: json };
    };
    const b64 = (n) => nodeCrypto.randomBytes(n).toString('base64');
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      const user = { handle, token: login.body.token, id: login.body.user.id, publicKey: b64(120) };
      const reg = await api('POST', '/api/e2ee/keys/register', { token: user.token, body: { publicKey: user.publicKey, encryptedPrivateKey: b64(200), salt: b64(16) } });
      assert.ok(reg.status < 300, JSON.stringify(reg.body));
      return user;
    };
    const wrapped = () => `${b64(48)}:${b64(12)}`;

    await makeUser('fadmin');
    const owner = await makeUser('fowner');
    const member = await makeUser('fmember');

    // Who the device is in a seal.
    const status = await api('GET', '/api/e2ee/status', { token: owner.token });
    assert.equal(status.body.userId, owner.id);
    assert.equal(status.body.nodeName, 'fmt2.example.test');

    // A wave whose keys are given in format 2 (owner) and format 1 (member).
    const created = await api('POST', '/api/waves', {
      token: owner.token,
      body: {
        title: 'Bound', privacy: 'private', participants: [member.id], encrypted: true,
        keyDistribution: [
          { userId: null, encryptedWaveKey: wrapped(), senderPublicKey: owner.publicKey, format: 2 },
          { userId: member.id, encryptedWaveKey: wrapped(), senderPublicKey: owner.publicKey },
        ],
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const waveId = created.body.id;
    for (const i of ((await api('GET', '/api/wave-invitations', { token: member.token })).body?.invitations || [])) {
      await api('POST', `/api/wave-invitations/${i.id}/accept`, { token: member.token });
    }
    assert.equal((await api('GET', `/api/waves/${waveId}/key`, { token: owner.token })).body.format, 2);
    assert.equal((await api('GET', `/api/waves/${waveId}/key`, { token: member.token })).body.format, 1);
    assert.deepEqual((await api('GET', `/api/waves/${waveId}/keys/all`, { token: owner.token })).body.keys.map(k => k.format), [2]);

    // Rotation carries each entry's format; an unknown one is refused.
    const badRot = await api('POST', `/api/waves/${waveId}/key/rotate`, { token: owner.token, body: { keyDistribution: [
      { userId: null, encryptedWaveKey: wrapped(), senderPublicKey: owner.publicKey, format: 3 },
      { userId: member.id, encryptedWaveKey: wrapped(), senderPublicKey: owner.publicKey },
    ] } });
    assert.equal(badRot.status, 400);
    const rot = await api('POST', `/api/waves/${waveId}/key/rotate`, { token: owner.token, body: { keyDistribution: [
      { userId: null, encryptedWaveKey: wrapped(), senderPublicKey: owner.publicKey },
      { userId: member.id, encryptedWaveKey: wrapped(), senderPublicKey: owner.publicKey, format: 2 },
    ] } });
    assert.equal(rot.status, 200, JSON.stringify(rot.body));
    assert.deepEqual((await api('GET', `/api/waves/${waveId}/keys/all`, { token: member.token })).body.keys.map(k => [k.keyVersion, k.format]), [[1, 1], [2, 2]]);

    // Pings keep their format; an unknown one is refused.
    const send = (format) => api('POST', '/api/pings', { token: owner.token, body: {
      wave_id: waveId, content: b64(40), encrypted: true, nonce: b64(12), keyVersion: 2, ...(format !== undefined ? { format } : {}),
    } });
    const one = await send(undefined);
    const two = await send(2);
    const three = await send(3);
    assert.equal(one.status, 201, JSON.stringify(one.body));
    assert.equal(two.status, 201, JSON.stringify(two.body));
    assert.equal(three.status, 400);
    assert.equal(three.body.code, 'ENCRYPTION_REQUIRED');
    const pingOne = one.body.ping || one.body;
    const pingTwo = two.body.ping || two.body;
    assert.equal(pingOne.format, 1);
    assert.equal(pingTwo.format, 2);
    const listed = (await api('GET', `/api/waves/${waveId}/pings`, { token: member.token })).body;
    const pings = Array.isArray(listed) ? listed : (listed.pings || listed.messages || []);
    const byId = Object.fromEntries(pings.map(p => [p.id, p.format]));
    assert.equal(byId[pingOne.id], 1);
    assert.equal(byId[pingTwo.id], 2);
    const minimal = (await api('GET', `/api/waves/${waveId}/pings?fields=minimal`, { token: member.token })).body;
    const minPings = Array.isArray(minimal) ? minimal : (minimal.pings || minimal.messages || []);
    assert.equal(minPings.find(p => p.id === pingTwo.id)?.format, 2);
    // The notification preview gets what a format-2 ping needs: its author and format.
    const preview = (await api('GET', `/api/pings/${pingTwo.id}`, { token: member.token })).body;
    assert.equal(preview.format, 2);
    assert.equal(preview.authorId, owner.id);

    // An edit says its own format: one sealed as format 1 is format 1 again.
    const edit = await api('PUT', `/api/pings/${pingTwo.id}`, { token: owner.token, body: { content: b64(40), encrypted: true, nonce: b64(12), keyVersion: 2 } });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    assert.equal((edit.body.ping || edit.body).format, 1);
    const badEdit = await api('PUT', `/api/pings/${pingTwo.id}`, { token: owner.token, body: { content: b64(40), encrypted: true, nonce: b64(12), keyVersion: 2, format: 'x' } });
    assert.equal(badEdit.status, 400);
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
