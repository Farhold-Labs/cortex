'use strict';

// Encryption across servers, phase 1 (v2.149.0, docs/federated-e2ee/).
//
// 1. Encryption-key fingerprints: SHA-256 over "cortex-fp-v1" ‖ SPKI, first
//    16 bytes, as 8 groups of 4 upper-case hex. Checked against node:crypto.
//    (Since v2.150.0 people compare identity fingerprints:
//    tests/e2ee-identity.test.cjs.)
// 2. Format 2: a wrapped wave key bound to its wave, version and recipient.
//    A key moved to another place must not open, and format 2 must never
//    open as format 1. Counterfactual: the same crypto.js with the binding
//    stripped opens a key handed over as another wave's. (A format-2 ping is
//    signed since v2.150.0; see e2ee-identity.)
// 3. The server stores and returns each ping's and wrapped key's format,
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
  return {
    keyOpens: await open(ctx('wave-1', 3, bobAddress)),
    keyOtherWave: await open(ctx('wave-2', 3, bobAddress)),
    keyOtherVersion: await open(ctx('wave-1', 2, bobAddress)),
    keyOtherRecipient: await open(ctx('wave-1', 3, c.personAddress('user-carol', 'dev.farhold.com'))),
    keyOtherServer: await open(ctx('wave-1', 3, c.personAddress('user-bob', 'qa.farhold.com'))),
    keyAsFormatOne: await open(null, { format: 1 }),
  };
}

test('format 2 binds a wrapped key to its wave, version and recipient', async () => {
  const c = await loadCrypto();
  const r = await formatTwo(c);
  assert.deepEqual(r, {
    keyOpens: true, keyOtherWave: false, keyOtherVersion: false, keyOtherRecipient: false, keyOtherServer: false, keyAsFormatOne: false,
  });

  // Format 1 is unchanged: everything written so far still opens.
  const a = await c.generateUserKeypair();
  const b = await c.generateUserKeypair();
  const wk = await c.generateWaveKey();
  const w1 = await c.encryptWaveKey(wk, b.publicKey, a.privateKey);
  const k1 = await c.decryptWaveKey(w1.encryptedKey, w1.nonce, a.publicKey, b.privateKey);
  const p1 = await c.encryptPing('old', wk);
  assert.equal(await c.decryptPing(p1.ciphertext, p1.nonce, k1), 'old');

  // A format-2 ping isn't read as format 1, or by the format-1 reader at all.
  await assert.rejects(c.decryptPing(p1.ciphertext, p1.nonce, k1, { format: 2 }), /openSignedPing/);
  // No field may contain the separator, so two lists can't give the same bytes.
  assert.throws(() => c.pingContext('wave\u00001', 'x@y'), /Invalid seal context/);
  assert.throws(() => c.waveKeyContext('wave-1', 0, 'x@y'), /Invalid seal context/);
  assert.notDeepEqual(c.pingContext('ab', 'c@d'), c.pingContext('a', 'bc@d'));
});

test('counterfactual: without the binding, a wrapped key handed over as another wave\'s opens', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fmt2-cf-'));
  try {
    let src = fs.readFileSync(path.join(root, 'client/crypto.js'), 'utf8');
    // The wrap's context is both the HKDF info and the associated data; make it constant.
    const from = 'async function deriveBoundWrapKey(privateKey, publicKey, context) {';
    assert.ok(src.includes(from), 'binding not found in crypto.js');
    src = src.split(from).join(from + "\n  context = new TextEncoder().encode('fixed');");
    assert.ok(src.includes('additionalData: context }'), 'associated data not found in crypto.js');
    src = src.split('additionalData: context }').join("additionalData: new TextEncoder().encode('fixed') }");
    const copy = path.join(temp, 'crypto.mjs');
    fs.writeFileSync(copy, src);
    const r = await formatTwo(await import(copy));
    assert.equal(r.keyOtherWave, true, 'with the binding stripped, the moved key should open');
    assert.equal(r.keyOtherRecipient, true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
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
