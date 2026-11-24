'use strict';

// Identity keys, phase 1b (v2.150.0, docs/federated-e2ee/02-identity-keys.md).
//
// 1. A fingerprint is of the identity key: SHA-256 over "cortex-id-v1" ‖ SPKI,
//    first 16 bytes, and never equal to a v2.149.0 key fingerprint.
// 2. A key statement signed on a device checks on the server (the two build
//    the same bytes) and fails for any other person, seq, key or time.
// 3. A format-2 ping is signed by its author. A member holding the wave key
//    can seal a ping in someone else's name that opens; only the signature
//    stops it (the counterfactual inside the test).
// 4. Verification is of the identity: renewed keys keep it, an older statement
//    is refused, a new identity loses it, unsigned keys are flagged, and a
//    v2.149.0 verification becomes "compare once more".
// 5. The server: stores only statements its identity signed, in order;
//    replacing keys keeps the identity; signed keys can't be overwritten
//    unsigned; a new recovery key must carry the identity; a reset keeps it.
//    Counterfactual: a copy of server.js without the signature check stores
//    a statement signed by someone else's identity.

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
const loadStatements = () => import(path.join(root, 'server/lib/key-statements.js'));

test('an identity fingerprint is SHA-256 over cortex-id-v1 and the key, unlike a key fingerprint', async () => {
  const c = await loadCrypto();
  const id = await c.exportPublicKey((await c.generateSigningKeypair()).publicKey);
  const expected = nodeCrypto.createHash('sha256')
    .update(Buffer.concat([Buffer.from('cortex-id-v1'), Buffer.from(id, 'base64')]))
    .digest().subarray(0, 16).toString('hex').toUpperCase().match(/.{4}/g).join(' ');
  assert.equal(await c.identityFingerprint(id), expected);
  assert.notEqual(await c.identityFingerprint(id), await c.keyFingerprint(id));
});

test('a statement signed on a device checks on the server, and for nothing else', async () => {
  const c = await loadCrypto();
  const lib = await loadStatements();
  const identity = await c.generateSigningKeypair();
  const identityKey = await c.exportPublicKey(identity.publicKey);
  const enc = await c.exportPublicKey((await c.generateUserKeypair()).publicKey);
  const signing = await c.exportPublicKey((await c.generateSigningKeypair()).publicKey);
  const fields = { userId: 'user-zoe', seq: 3, encryptionKey: enc, signingKey: signing, issuedAt: '2026-11-24T10:00:00.000Z' };
  const signature = await c.signKeyStatement(identity.privateKey, fields);

  assert.equal(lib.verifyStatement(identityKey, fields, signature), true, 'server reads the device bytes');
  for (const change of [{ userId: 'user-wash' }, { seq: 4 }, { encryptionKey: signing }, { signingKey: enc }, { issuedAt: '2026-11-24T10:00:01.000Z' }]) {
    assert.equal(lib.verifyStatement(identityKey, { ...fields, ...change }, signature), false, JSON.stringify(Object.keys(change)));
  }
  const other = await c.exportPublicKey((await c.generateSigningKeypair()).publicKey);
  assert.equal(lib.verifyStatement(other, fields, signature), false, 'another identity');

  // The device check: names this person and this key.
  const st = { seq: 3, encryptionKey: enc, signingKey: signing, issuedAt: fields.issuedAt, signature };
  assert.equal(await c.verifyKeyStatement(identityKey, 'user-zoe', st, enc), true);
  assert.equal(await c.verifyKeyStatement(identityKey, 'user-wash', st, enc), false);
  assert.equal(await c.verifyKeyStatement(identityKey, 'user-zoe', st, signing), false, 'served with another key');
  assert.equal(await c.verifyKeyStatement(identityKey, 'user-zoe', null, enc), false);
});

test('a format-2 ping is signed by its author; a member can forge the seal but not the signature', async () => {
  const c = await loadCrypto();
  const waveKey = await c.generateWaveKey();
  const alice = await c.generateSigningKeypair();
  const aliceKey = await c.exportPublicKey(alice.publicKey);
  const mallory = await c.generateSigningKeypair();
  const ctx = { originWaveId: 'wave-1', authorAddress: c.personAddress('user-alice', 'dev.farhold.com') };

  const sealed = await c.sealSignedPing('meet at nine', waveKey, { ...ctx, seq: 2, signingPrivateKey: alice.privateKey });
  const opened = await c.openSignedPing(sealed.ciphertext, sealed.nonce, waveKey, ctx);
  assert.equal(opened.text, 'meet at nine');
  assert.equal(opened.seq, 2);
  assert.equal(opened.messageId, sealed.messageId);
  assert.equal(await c.verifyPingSignature(aliceKey, opened, ctx), true);

  // Moved to another wave, or put to another author: the seal fails.
  await assert.rejects(c.openSignedPing(sealed.ciphertext, sealed.nonce, waveKey, { ...ctx, originWaveId: 'wave-2' }));
  await assert.rejects(c.openSignedPing(sealed.ciphertext, sealed.nonce, waveKey, { ...ctx, authorAddress: 'user-wash@dev.farhold.com' }));

  // Mallory is in the wave: she holds the wave key and can seal a ping in
  // Alice's name that opens. Counterfactual: the seal alone lets it through.
  const forged = await c.sealSignedPing('meet at ten', waveKey, { ...ctx, seq: 2, signingPrivateKey: mallory.privateKey });
  const forgedOpen = await c.openSignedPing(forged.ciphertext, forged.nonce, waveKey, ctx);
  assert.equal(forgedOpen.text, 'meet at ten', 'without a signature check the forgery would be shown');
  assert.equal(await c.verifyPingSignature(aliceKey, forgedOpen, ctx), false, 'the signature stops it');

  // The signature covers the text and the message id.
  assert.equal(await c.verifyPingSignature(aliceKey, { ...opened, textBytes: new TextEncoder().encode('meet at noon') }, ctx), false);
  assert.equal(await c.verifyPingSignature(aliceKey, { ...opened, messageId: '00'.repeat(16) }, ctx), false);
  assert.equal(await c.verifyPingSignature(aliceKey, { ...opened, seq: 3 }, ctx), false);
});

test('verification is of the identity: renewed keys keep it, a new identity loses it', async () => {
  const k = await loadRecords();
  let r = k.emptyKeyRecords();
  let out = k.noteIdentity(r, 'zoe', { identity: 'ID-A', seq: 1, key: 'K1' }, 't1');
  assert.equal(out.status, 'new');
  r = out.records;
  assert.equal(k.keyStanding(r, 'zoe', 'ID-A'), 'seen');

  assert.equal(k.markVerified(r, 'zoe', 'ID-OTHER'), r, 'only the identity on record');
  r = k.markVerified(r, 'zoe', 'ID-A', 't2');
  assert.equal(k.keyStanding(r, 'zoe', 'ID-A'), 'verified');

  // Zoe replaces her keys: same identity, later statement. Nothing flagged.
  out = k.noteIdentity(r, 'zoe', { identity: 'ID-A', seq: 2, key: 'K2' }, 't3');
  assert.equal(out.status, 'renewed');
  r = out.records;
  assert.equal(r.people.zoe.key, 'K2');
  assert.equal(k.keyStanding(r, 'zoe', 'ID-A'), 'verified', 'verification survives a key change');
  assert.deepEqual(k.unacknowledgedChanges(r), []);

  // The server hands out her older statement, or another key under seq 2.
  assert.equal(k.noteIdentity(r, 'zoe', { identity: 'ID-A', seq: 1, key: 'K1' }).status, 'rollback');
  assert.equal(k.noteIdentity(r, 'zoe', { identity: 'ID-A', seq: 2, key: 'K9' }).status, 'rollback');
  assert.equal(k.noteIdentity(r, 'zoe', { identity: 'ID-A', seq: 2, key: 'K2' }).status, 'same');

  // A new identity: the verification goes, and says so until compared again.
  out = k.noteIdentity(r, 'zoe', { identity: 'ID-B', seq: 3, key: 'K3' }, 't4');
  assert.equal(out.status, 'changed');
  r = out.records;
  assert.equal(k.keyStanding(r, 'zoe', 'ID-B'), 'lost');
  assert.deepEqual(k.unacknowledgedChanges(r), [{ personId: 'zoe', changedAt: 't4', verificationLost: true, unsigned: false }]);
  r = k.acknowledgeKeyChange(r, 'zoe');
  assert.equal(k.keyStanding(r, 'zoe', 'ID-B'), 'lost', 'seeing the flag verifies nothing');
  r = k.markVerified(r, 'zoe', 'ID-B', 't5');
  assert.equal(k.keyStanding(r, 'zoe', 'ID-B'), 'verified');

  // Keys not signed by her identity: flagged, can't be verified, settled by a valid statement.
  r = k.markUnsigned(r, 'zoe', 't6');
  assert.equal(k.keyStanding(r, 'zoe', 'ID-B'), 'unsigned');
  assert.equal(k.markVerified(r, 'zoe', 'ID-B'), r);
  assert.deepEqual(k.unacknowledgedChanges(r), [{ personId: 'zoe', changedAt: 't6', verificationLost: false, unsigned: true }]);
  r = k.noteIdentity(r, 'zoe', { identity: 'ID-B', seq: 3, key: 'K3' }, 't7').records;
  assert.equal(k.keyStanding(r, 'zoe', 'ID-B'), 'verified');
  assert.deepEqual(k.unacknowledgedChanges(r), []);

  // Someone who had an identity, served without one: a downgrade, not a legacy person.
  assert.equal(k.noteKey(r, 'zoe', 'K3').status, 'downgrade');
  assert.equal(k.keyStanding(r, 'zoe', null), 'unsigned');

  // Someone without an identity yet: judged by key, as before.
  let w = k.noteKey(k.emptyKeyRecords(), 'wash', 'W1').records;
  assert.equal(k.keyStanding(w, 'wash', null), 'legacy');
  w = k.noteKey(w, 'wash', 'W2').records;
  assert.equal(k.unacknowledgedChanges(w).length, 1);
});

test('a v2.149.0 verification becomes "compare once more" when the identity appears', async () => {
  const k = await loadRecords();
  // As v2.149.0 stored it.
  const old = { v: 1, people: { zoe: { key: 'K1', seenAt: 't0', verifiedKey: 'K1', verifiedAt: 't1' } } };
  const r = k.noteIdentity(old, 'zoe', { identity: 'ID-A', seq: 1, key: 'K1' }, 't2').records;
  assert.equal(k.keyStanding(r, 'zoe', 'ID-A'), 'recheck');
  assert.equal(r.people.zoe.verifiedKey, undefined);
  assert.equal(k.keyStanding(k.markVerified(r, 'zoe', 'ID-A', 't3'), 'zoe', 'ID-A'), 'verified');
  // Not verified before: just seen.
  const plain = k.noteIdentity({ v: 1, people: { wash: { key: 'W1', seenAt: 't0' } } }, 'wash', { identity: 'ID-W', seq: 1, key: 'W1' }).records;
  assert.equal(k.keyStanding(plain, 'wash', 'ID-W'), 'seen');
});

test('two devices: the later statement and the later verification decision both win', async () => {
  const k = await loadRecords();
  const base = k.noteIdentity(k.emptyKeyRecords(), 'zoe', { identity: 'ID-A', seq: 1, key: 'K1' }, 't1').records;
  const phone = k.markVerified(base, 'zoe', 'ID-A', 't5');                                     // verified later
  const laptop = k.noteIdentity(base, 'zoe', { identity: 'ID-A', seq: 2, key: 'K2' }, 't3').records; // saw renewal
  for (const merged of [k.mergeKeyRecords(phone, laptop), k.mergeKeyRecords(laptop, phone)]) {
    assert.equal(merged.people.zoe.seq, 2);
    assert.equal(merged.people.zoe.key, 'K2');
    assert.equal(k.keyStanding(merged, 'zoe', 'ID-A'), 'verified');
  }
  const unverified = k.unmarkVerified(phone, 'zoe', 't9');
  assert.equal(k.keyStanding(k.mergeKeyRecords(phone, unverified), 'zoe', 'ID-A'), 'seen');
});

// ============ Server ============

async function startServer(temp, patch = null) {
  const serverDir = path.join(temp, 'server');
  fs.mkdirSync(serverDir);
  for (const name of fs.readdirSync(path.join(root, 'server'))) {
    if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
  }
  fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
  fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(serverDir, 'data'));
  if (patch) {
    const file = path.join(serverDir, 'server.js');
    fs.writeFileSync(file, patch(fs.readFileSync(file, 'utf8')));
  }
  fs.appendFileSync(path.join(serverDir, 'server.js'), "\nserver.on('listening', () => console.log('ID_PORT=' + server.address().port));\n");
  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-identity-keys-0000000000',
      SEED_DEMO_DATA: 'false', FEDERATION_NODE_NAME: 'id.example.test',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 25000;
  while (!/ID_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const base = `http://127.0.0.1:${output.match(/ID_PORT=(\d+)/)[1]}`;
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
  return { child, api };
}

/** A person as a device sets them up: real keys, as the app makes them. */
async function person(c, api, handle) {
  const password = 'Identity-pass-1!';
  await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
  const login = await api('POST', '/api/auth/login', { body: { handle, password } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const enc = await c.setupUserE2EE(password);
  const reg = await api('POST', '/api/e2ee/keys/register', { token: login.body.token, body: { publicKey: enc.publicKey, encryptedPrivateKey: enc.encryptedPrivateKey, salt: enc.salt } });
  assert.ok(reg.status < 300, JSON.stringify(reg.body));
  return { handle, password, token: login.body.token, id: login.body.user.id, enc };
}

/** The body a device sends to make, keep or replace an identity. */
async function identityBody(c, p, { mode = 'create', identity, recoveryKey, seq, encKeys = p.enc.keyPair, encKey = p.enc.publicKey, signWith = null, recovery = false }) {
  const signing = await c.generateSigningKeypair();
  const signingKey = await c.exportPublicKey(signing.publicKey);
  const issuedAt = new Date().toISOString();
  const signature = await c.signKeyStatement((signWith || identity).privateKey, { userId: p.id, seq, encryptionKey: encKey, signingKey, issuedAt });
  return {
    mode,
    identityKey: await c.exportPublicKey(identity.publicKey),
    ...(await c.wrapIdentity(identity.privateKey, recoveryKey)),
    signingKey,
    encryptedSigningKey: await c.wrapSigningKey(signing.privateKey, encKeys.privateKey, encKeys.publicKey, p.id),
    statement: { seq, issuedAt, signature },
    ...(recovery ? { recovery: await c.wrapWithRecoveryKey(encKeys.privateKey, recoveryKey) } : {}),
  };
}

test('the server keeps only statements its person\'s identity signed, and the identity outlives keys', async () => {
  const c = await loadCrypto();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-identity-'));
  let child;
  try {
    const srv = await startServer(temp);
    child = srv.child;
    const { api } = srv;
    await person(c, api, 'idadmin');
    const zoe = await person(c, api, 'idzoe');
    const mal = await person(c, api, 'idmal');
    const recoveryKey = c.generateRecoveryKey();
    const recovery = await c.createRecoveryBackup(zoe.enc.keyPair.privateKey);
    await api('POST', '/api/e2ee/recovery/setup', { token: zoe.token, body: { encryptedPrivateKey: recovery.encryptedPrivateKey, recoverySalt: recovery.recoverySalt } });

    // No identity yet: a lookup says so, and a device judges her by key.
    assert.equal((await api('GET', '/api/e2ee/identity', { token: zoe.token })).status, 404);
    let look = (await api('GET', `/api/e2ee/keys/user/${zoe.id}`, { token: mal.token })).body;
    assert.equal(look.identityKey, null);

    const identity = await c.generateSigningKeypair();
    const identityKey = await c.exportPublicKey(identity.publicKey);

    // Refused: signed by another identity, out of order, naming another key.
    const stranger = await c.generateSigningKeypair();
    let res = await api('POST', '/api/e2ee/identity', { token: zoe.token, body: await identityBody(c, zoe, { identity, recoveryKey: recovery.recoveryKey, seq: 1, signWith: stranger }) });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'BAD_STATEMENT');
    res = await api('POST', '/api/e2ee/identity', { token: zoe.token, body: await identityBody(c, zoe, { identity, recoveryKey: recovery.recoveryKey, seq: 2 }) });
    assert.equal(res.status, 409);
    const otherKey = await c.exportPublicKey((await c.generateUserKeypair()).publicKey);
    res = await api('POST', '/api/e2ee/identity', { token: zoe.token, body: await identityBody(c, zoe, { identity, recoveryKey: recovery.recoveryKey, seq: 1, encKey: otherKey }) });
    assert.equal(res.status, 400, 'a statement for a key she does not have');

    // Made.
    res = await api('POST', '/api/e2ee/identity', { token: zoe.token, body: await identityBody(c, zoe, { identity, recoveryKey: recovery.recoveryKey, seq: 1 }) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    res = await api('POST', '/api/e2ee/identity', { token: zoe.token, body: await identityBody(c, zoe, { identity, recoveryKey: recovery.recoveryKey, seq: 2 }) });
    assert.equal(res.status, 409, 'create once');
    assert.equal(res.body.code, 'IDENTITY_EXISTS');

    look = (await api('GET', `/api/e2ee/keys/user/${zoe.id}`, { token: mal.token })).body;
    assert.equal(look.identityKey, identityKey);
    assert.equal(await c.verifyKeyStatement(look.identityKey, zoe.id, look.statement, look.publicKey), true, 'what others are served checks');
    const own = (await api('GET', '/api/e2ee/identity', { token: zoe.token })).body;
    assert.equal(own.current, true);
    const opened = await c.unwrapIdentity(own.wrappedIdentity, own.identitySalt, recovery.recoveryKey);
    const probe = new TextEncoder().encode('probe');
    assert.equal(await c.verifyBytes(identityKey, probe, await c.signBytes(opened, probe)), true, 'the recovery key opens it');
    await assert.rejects(c.unwrapIdentity(own.wrappedIdentity, own.identitySalt, c.generateRecoveryKey()), 'another recovery key does not');
    const mine = (await api('GET', '/api/e2ee/keys/me', { token: zoe.token })).body;
    const signingPriv = await c.unwrapSigningKey(mine.encryptedSigningKey, zoe.enc.keyPair.privateKey, zoe.enc.keyPair.publicKey, zoe.id);
    assert.equal(await c.verifyBytes(mine.signingKey, probe, await c.signBytes(signingPriv, probe)), true, 'her signing key opens with her encryption key');

    // Signed keys can't be overwritten without a statement.
    const plain = await c.setupUserE2EE(zoe.password);
    res = await api('POST', '/api/e2ee/keys/register', { token: zoe.token, body: { publicKey: plain.publicKey, encryptedPrivateKey: plain.encryptedPrivateKey, salt: plain.salt } });
    assert.equal(res.status, 409);
    res = await api('POST', '/api/e2ee/keys/rotate', { token: zoe.token, body: { publicKey: plain.publicKey, encryptedPrivateKey: plain.encryptedPrivateKey, salt: plain.salt } });
    assert.equal(res.status, 409);

    // A wave key she holds, which replacing her keys must carry along.
    const created = await api('POST', '/api/waves', { token: zoe.token, body: {
      title: 'Held', privacy: 'private', participants: [], encrypted: true,
      keyDistribution: [{ userId: null, encryptedWaveKey: 'QUJD:REVG', senderPublicKey: zoe.enc.publicKey }],
    } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const held = (await api('GET', '/api/e2ee/wave-keys', { token: zoe.token })).body.keys;
    assert.equal(held.length, 1);

    // Replace my keys: new keypair, same identity, statement 2.
    const next = await c.generateUserKeypair();
    const nextKey = await c.exportPublicKey(next.publicKey);
    const salt = c.generateSalt();
    const replaceBody = async (waveKeys) => {
      const b = await identityBody(c, zoe, { identity, recoveryKey: recovery.recoveryKey, seq: 2, encKeys: next, encKey: nextKey });
      return {
        publicKey: nextKey, encryptedPrivateKey: await c.wrapPrivateKey(next.privateKey, await c.deriveKeyFromPassphrase(zoe.password, salt)), salt,
        recovery: await c.wrapWithRecoveryKey(next.privateKey, recovery.recoveryKey),
        waveKeys, keyRecords: null, contacts: null,
        signingKey: b.signingKey, encryptedSigningKey: b.encryptedSigningKey, statement: b.statement,
      };
    };
    res = await api('POST', '/api/e2ee/keys/replace', { token: zoe.token, body: await replaceBody([]) });
    assert.equal(res.status, 409, 'every wave key she holds must come along');
    assert.equal(res.body.code, 'WAVE_KEYS_CHANGED');
    res = await api('POST', '/api/e2ee/keys/replace', { token: zoe.token, body: await replaceBody([
      { waveId: held[0].waveId, keyVersion: held[0].keyVersion, encryptedWaveKey: 'R0hJ:SktM', senderPublicKey: nextKey, format: 1 },
    ]) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    look = (await api('GET', `/api/e2ee/keys/user/${zoe.id}`, { token: mal.token })).body;
    assert.equal(look.publicKey, nextKey);
    assert.equal(look.identityKey, identityKey, 'same identity, same fingerprint');
    assert.equal(look.statement.seq, 2);
    assert.equal(await c.verifyKeyStatement(look.identityKey, zoe.id, look.statement, look.publicKey), true);
    assert.equal((await api('GET', '/api/e2ee/wave-keys', { token: zoe.token })).body.keys[0].encryptedWaveKey, 'R0hJ:SktM');
    const history = (await api('GET', `/api/e2ee/keys/user/${zoe.id}/statements`, { token: mal.token })).body.statements;
    assert.deepEqual(history.map(s => s.seq), [1, 2], 'earlier statements stay, for pings signed under them');

    // A new recovery key must carry the identity: refused without proof.
    const fresh = await c.createRecoveryBackup(next.privateKey);
    res = await api('POST', '/api/e2ee/recovery/regenerate', { token: zoe.token, body: { encryptedPrivateKey: fresh.encryptedPrivateKey, recoverySalt: fresh.recoverySalt } });
    assert.equal(res.status, 403);
    const rewrap = await c.wrapIdentity(identity.privateKey, fresh.recoveryKey);
    const forgedProof = await c.signIdentityRewrap(stranger.privateKey, { userId: zoe.id, ...rewrap });
    res = await api('POST', '/api/e2ee/recovery/regenerate', { token: zoe.token, body: { encryptedPrivateKey: fresh.encryptedPrivateKey, recoverySalt: fresh.recoverySalt, ...rewrap, identityProof: forgedProof } });
    assert.equal(res.status, 403, 'a proof by another identity');
    const proof = await c.signIdentityRewrap(identity.privateKey, { userId: zoe.id, ...rewrap });
    res = await api('POST', '/api/e2ee/recovery/regenerate', { token: zoe.token, body: { encryptedPrivateKey: fresh.encryptedPrivateKey, recoverySalt: fresh.recoverySalt, ...rewrap, identityProof: proof } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Waiting: both recovery keys open it until confirmed.
    let wrapNow = (await api('GET', '/api/e2ee/identity', { token: zoe.token })).body;
    await c.unwrapIdentity(wrapNow.wrappedIdentity, wrapNow.identitySalt, recovery.recoveryKey);
    await c.unwrapIdentity(wrapNow.pending.wrappedIdentity, wrapNow.pending.identitySalt, fresh.recoveryKey);
    await api('POST', '/api/e2ee/recovery/confirm', { token: zoe.token });
    wrapNow = (await api('GET', '/api/e2ee/identity', { token: zoe.token })).body;
    await c.unwrapIdentity(wrapNow.wrappedIdentity, wrapNow.identitySalt, fresh.recoveryKey);

    // A reset keeps the identity; it no longer names her keys, and she can keep it.
    await api('POST', '/api/e2ee/keys/reset', { token: zoe.token });
    const after = await c.setupUserE2EE(zoe.password);
    await api('POST', '/api/e2ee/keys/register', { token: zoe.token, body: { publicKey: after.publicKey, encryptedPrivateKey: after.encryptedPrivateKey, salt: after.salt } });
    wrapNow = (await api('GET', '/api/e2ee/identity', { token: zoe.token })).body;
    assert.equal(wrapNow.identityKey, identityKey, 'kept through the reset');
    assert.equal(wrapNow.current, false);
    look = (await api('GET', `/api/e2ee/keys/user/${zoe.id}`, { token: mal.token })).body;
    assert.equal(await c.verifyKeyStatement(look.identityKey, zoe.id, look.statement, look.publicKey), false, 'others see unsigned keys and give her nothing');
    const kept = await c.unwrapIdentity(wrapNow.wrappedIdentity, wrapNow.identitySalt, fresh.recoveryKey);
    const third = c.generateRecoveryKey();
    res = await api('POST', '/api/e2ee/identity', { token: zoe.token, body: await identityBody(c, { ...zoe, enc: after }, {
      mode: 'keep', identity: { privateKey: kept, publicKey: identity.publicKey }, recoveryKey: third, seq: 3, recovery: true,
    }) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    look = (await api('GET', `/api/e2ee/keys/user/${zoe.id}`, { token: mal.token })).body;
    assert.equal(look.identityKey, identityKey);
    assert.equal(await c.verifyKeyStatement(look.identityKey, zoe.id, look.statement, look.publicKey), true, 'signed again, same fingerprint');

    // Replacing the identity is allowed (it's visible), with a new recovery key.
    const newer = await c.generateSigningKeypair();
    res = await api('POST', '/api/e2ee/identity', { token: zoe.token, body: await identityBody(c, { ...zoe, enc: after }, { mode: 'replace', identity: newer, recoveryKey: c.generateRecoveryKey(), seq: 4 }) });
    assert.equal(res.status, 400, 'a replaced identity needs a new recovery key');
    res = await api('POST', '/api/e2ee/identity', { token: zoe.token, body: await identityBody(c, { ...zoe, enc: after }, { mode: 'replace', identity: newer, recoveryKey: c.generateRecoveryKey(), seq: 4, recovery: true }) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    look = (await api('GET', `/api/e2ee/keys/user/${zoe.id}`, { token: mal.token })).body;
    assert.equal(look.identityKey, await c.exportPublicKey(newer.publicKey));
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('counterfactual: without the signature check the server stores a statement by another identity', async () => {
  const c = await loadCrypto();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-identity-cf-'));
  let child;
  try {
    const check = "  if (!keyStatements.verifyStatement(identityKey, fields, statement.signature)) return { error: 'Key statement signature does not check', code: 'BAD_STATEMENT' };\n";
    const srv = await startServer(temp, (src) => {
      assert.ok(src.includes(check), 'signature check not found in server.js');
      return src.split(check).join('');
    });
    child = srv.child;
    await person(c, srv.api, 'cfadmin');
    const zoe = await person(c, srv.api, 'cfzoe');
    const identity = await c.generateSigningKeypair();
    const stranger = await c.generateSigningKeypair();
    const res = await srv.api('POST', '/api/e2ee/identity', { token: zoe.token, body: await identityBody(c, zoe, { identity, recoveryKey: c.generateRecoveryKey(), seq: 1, signWith: stranger }) });
    assert.equal(res.status, 200, 'with the check stripped, the forged statement is stored');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
