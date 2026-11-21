'use strict';

// Encryption on one server, phase 0 (v2.143.0; docs/federated-e2ee/01-design.md).
//
// What the server can enforce, each with a counterfactual that takes the fix
// out of a copy of the server and sees the old behaviour come back:
//
// - plain text is refused in an encrypted wave, on send and on edit (the focus
//   view and thread panel sent plain text for years);
// - a wave key is given only to someone in the wave, once per version, wrapped
//   with the sender's own key (any member could overwrite another's);
// - the key is renewed by the wave's owner, admins or moderators, and must
//   reach exactly the people still in it; the server says when it is needed;
// - /encrypt-pings touches only plain pings of its own wave (it could
//   overwrite any ping anywhere);
// - deleting an account that held a wave key marks the wave for a new key;
// - each person's record of keys seen saves only over the version it read.
//
// The device side (giving a key only to one looked up, flagging a change) is
// in e2ee-key-records.test.cjs and checked in a browser.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));

function copyServer(temp, edit) {
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
  if (edit) edit(serverDir);
  return serverDir;
}

function editFile(dir, file, pairs) {
  const p = path.join(dir, file);
  let src = fs.readFileSync(p, 'utf8');
  for (const [from, to] of pairs) {
    assert.ok(src.includes(from), `could not find: ${from.slice(0, 80)}`);
    src = src.split(from).join(to);
  }
  fs.writeFileSync(p, src);
}

// The fixes, taken out (the counterfactual).
function withoutFixes(dir) {
  editFile(dir, 'server.js', [
    ['  if (plainRefusal) return res.status(400).json(plainRefusal);', '  if (false && plainRefusal) return res.status(400).json(plainRefusal);'],
    ['    if (db.hasWaveKeyRow(waveId, userId, currentVersion)) {', '    if (false && db.hasWaveKeyRow(waveId, userId, currentVersion)) {'],
    ['    if (!canAccessWaveFromCache(waveId, userId)) {\n      return res.status(403).json({ error: `They are not in this', '    if (false) {\n      return res.status(403).json({ error: `They are not in this'],
    ['    if (seen.size !== expected.size || [...seen].some(uid => !expected.has(uid))) {', '    if (false) {'],
  ]);
  editFile(dir, 'database-sqlite.js', [
    ['      WHERE id = ? AND wave_id = ? AND COALESCE(encrypted, 0) = 0\n    `).run(encryptedContent, nonce, keyVersion, pingId, waveId).changes;',
      '      WHERE id = ? AND ? IS NOT NULL\n    `).run(encryptedContent, nonce, keyVersion, pingId, waveId).changes;'],
  ]);
}

const b64 = (n) => crypto.randomBytes(n).toString('base64');
const cipher = () => ({ content: b64(48), encrypted: true, nonce: b64(12), keyVersion: 1 });

async function scenario({ fixed }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-e2ee-p0-'));
  const password = 'PhaseZero123!';
  let child;
  try {
    const serverDir = copyServer(temp, fixed ? null : withoutFixes);
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('E2EE_P0_PORT=' + server.address().port));\n");
    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-e2ee-phase-zero-000000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/E2EE_P0_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/E2EE_P0_PORT=(\d+)/)[1]}`;
    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, body: json };
    };
    const outcome = (r) => `${r.status}${r.body?.code ? ' ' + r.body.code : ''}`;
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      const user = { handle, token: login.body.token, id: login.body.user.id, publicKey: b64(120) };
      const reg = await api('POST', '/api/e2ee/keys/register', { token: user.token, body: { publicKey: user.publicKey, encryptedPrivateKey: b64(200), salt: b64(16) } });
      assert.ok(reg.status < 300, JSON.stringify(reg.body));
      return user;
    };
    const Database = serverRequire('better-sqlite3');
    const raw = (fn) => { const d = new Database(path.join(serverDir, 'data/farhold.db')); try { return fn(d); } finally { d.close(); } };
    const acceptAll = async (user) => {
      for (const i of ((await api('GET', '/api/wave-invitations', { token: user.token })).body?.invitations || [])) {
        await api('POST', `/api/wave-invitations/${i.id}/accept`, { token: user.token });
      }
    };
    const keyFor = (from, to) => ({ userId: to.id === from.id ? null : to.id, encryptedWaveKey: `${b64(48)}:${b64(12)}`, senderPublicKey: from.publicKey });

    await makeUser('nodeadmin');
    const owner = await makeUser('wowner');
    const mod = await makeUser('wmod');
    const member = await makeUser('wmember');
    const leaver = await makeUser('wleaver');
    const outsider = await makeUser('woutsider');
    const people = [owner, mod, member, leaver];

    // An encrypted wave, everyone given the key at creation.
    const created = await api('POST', '/api/waves', {
      token: owner.token,
      body: { title: 'Sealed', privacy: 'private', participants: [mod.id, member.id, leaver.id], encrypted: true, keyDistribution: people.map(p => keyFor(owner, p)) },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const waveId = created.body.id;
    for (const p of [mod, member, leaver]) await acceptAll(p);
    assert.equal((await api('PUT', `/api/waves/${waveId}/roles/${mod.id}`, { token: owner.token, body: { role: 'moderator' } })).status, 200);

    const result = {};
    const wave = async (user) => (await api('GET', `/api/waves/${waveId}`, { token: user.token })).body;
    result.freshNeedsRekey = (await wave(owner)).rekeyNeeded;

    // --- plain text in an encrypted wave
    result.plainSend = outcome(await api('POST', '/api/pings', { token: member.token, body: { wave_id: waveId, content: 'meet at the docks' } }));
    result.plainReply = outcome(await api('POST', '/api/pings', { token: member.token, body: { wave_id: waveId, content: 'thread reply', isThreadReply: true } }));
    const sealed = await api('POST', '/api/pings', { token: member.token, body: { wave_id: waveId, ...cipher() } });
    result.sealedSend = sealed.status;
    result.plainEdit = outcome(await api('PUT', `/api/pings/${sealed.body.id}`, { token: member.token, body: { content: 'now in the clear' } }));
    result.unknownVersion = outcome(await api('POST', '/api/pings', { token: member.token, body: { wave_id: waveId, ...cipher(), keyVersion: 9 } }));
    result.storedPlain = raw(d => d.prepare("SELECT COUNT(*) n FROM pings WHERE wave_id = ? AND encrypted = 0 AND bot_id IS NULL").get(waveId).n);

    // --- giving someone the key
    result.overwrite = outcome(await api('POST', `/api/waves/${waveId}/key/distribute`, { token: member.token, body: keyFor(member, mod) }));
    result.toOutsider = outcome(await api('POST', `/api/waves/${waveId}/key/distribute`, { token: member.token, body: keyFor(member, outsider) }));
    result.wrongSender = outcome(await api('POST', `/api/waves/${waveId}/key/distribute`, { token: member.token, body: { ...keyFor(member, mod), senderPublicKey: b64(120) } }));

    // --- someone leaves: the wave needs a new key, and who may give it
    assert.ok((await api('DELETE', `/api/waves/${waveId}/participants/${leaver.id}`, { token: leaver.token })).status < 300);
    result.afterLeave = { owner: (await wave(owner)).rekeyNeeded, canRotate: { owner: (await wave(owner)).canRotateKey, mod: (await wave(mod)).canRotateKey, member: (await wave(member)).canRotateKey } };
    result.listed = {
      owner: (await api('GET', '/api/e2ee/rekey-needed', { token: owner.token })).body.waves.map(w => w.id).includes(waveId),
      member: (await api('GET', '/api/e2ee/rekey-needed', { token: member.token })).body.waves.map(w => w.id).includes(waveId),
    };
    const stay = [owner, mod, member];
    result.memberRotates = outcome(await api('POST', `/api/waves/${waveId}/key/rotate`, { token: member.token, body: { keyDistribution: stay.map(p => keyFor(member, p)) } }));
    result.rotateIncludingLeaver = outcome(await api('POST', `/api/waves/${waveId}/key/rotate`, { token: mod.token, body: { keyDistribution: [...stay, leaver].map(p => keyFor(mod, p)) } }));
    const rotated = await api('POST', `/api/waves/${waveId}/key/rotate`, { token: mod.token, body: { keyDistribution: stay.map(p => keyFor(mod, p)) } });
    result.modRotates = outcome(rotated);
    result.afterRotate = (await wave(owner)).rekeyNeeded;
    result.leaverHoldsNewKey = raw(d => !!d.prepare('SELECT 1 FROM wave_encryption_keys WHERE wave_id = ? AND user_id = ? AND key_version = (SELECT current_key_version FROM wave_key_metadata WHERE wave_id = ?)').get(waveId, leaver.id, waveId));

    // --- /encrypt-pings across waves
    const other = await api('POST', '/api/waves', { token: member.token, body: { title: 'Elsewhere', privacy: 'private' } });
    const victim = await api('POST', '/api/pings', { token: member.token, body: { wave_id: other.body.id, content: 'my own words' } });
    const ownWave = await api('POST', '/api/waves', { token: owner.token, body: { title: 'Mine', privacy: 'private', encrypted: true, keyDistribution: [keyFor(owner, owner)] } });
    raw(d => d.prepare('UPDATE waves SET encrypted = 2 WHERE id = ?').run(ownWave.body.id));
    await api('POST', `/api/waves/${ownWave.body.id}/encrypt-pings`, { token: owner.token, body: { pings: [{ id: victim.body.id, content: b64(48), nonce: b64(12) }] } });
    result.victimRewritten = raw(d => d.prepare('SELECT content FROM pings WHERE id = ?').get(victim.body.id).content) !== 'my own words';

    // --- key records save only over what was read
    const rec1 = await api('PUT', '/api/e2ee/key-records', { token: member.token, body: { encryptedData: b64(64), nonce: b64(12), expectedVersion: 0 } });
    const stale = await api('PUT', '/api/e2ee/key-records', { token: member.token, body: { encryptedData: b64(64), nonce: b64(12), expectedVersion: 0 } });
    result.records = { first: rec1.body?.version, stale: outcome(stale), staleCarries: stale.body?.version, read: (await api('GET', '/api/e2ee/key-records', { token: member.token })).body.version, others: (await api('GET', '/api/e2ee/key-records', { token: owner.token })).body.version };

    // --- deleting an account that held the key marks the wave
    const nowRotated = (await wave(owner)).rekeyNeeded;
    assert.equal(raw(d => d.prepare('SELECT COUNT(*) n FROM wave_encryption_keys WHERE wave_id = ? AND user_id = ?').get(waveId, member.id).n) > 0, true);
    const del = await api('POST', `/api/admin/users/${member.id}/delete`, { token: (await api('POST', '/api/auth/login', { body: { handle: 'nodeadmin', password } })).body.token, body: { confirm: true, reason: 'test' } });
    result.deletion = { before: nowRotated, status: del.status, after: (await wave(owner)).rekeyNeeded };
    return result;
  } finally {
    if (child) child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('encryption on one server: what the server enforces', { timeout: 240000 }, async () => {
  const r = await scenario({ fixed: true });
  assert.equal(r.freshNeedsRekey, false, 'a new wave needs no new key');

  assert.equal(r.plainSend, '400 ENCRYPTION_REQUIRED');
  assert.equal(r.plainReply, '400 ENCRYPTION_REQUIRED', 'a thread reply too');
  assert.equal(r.sealedSend, 201);
  assert.equal(r.plainEdit, '400 ENCRYPTION_REQUIRED');
  assert.equal(r.unknownVersion, '400 ENCRYPTION_REQUIRED');
  assert.equal(r.storedPlain, 0, 'no plain text stored');

  assert.equal(r.overwrite, '409 KEY_EXISTS', 'a member cannot replace another member\'s key');
  assert.equal(r.toOutsider, '403 NOT_A_MEMBER');
  assert.equal(r.wrongSender, '400 SENDER_KEY_MISMATCH');

  assert.equal(r.afterLeave.owner, true, 'someone who held the key left');
  assert.deepEqual(r.afterLeave.canRotate, { owner: true, mod: true, member: false });
  assert.deepEqual(r.listed, { owner: true, member: false });
  assert.equal(r.memberRotates, '403 NOT_WAVE_STAFF');
  assert.equal(r.rotateIncludingLeaver, '409 KEY_MEMBERS_CHANGED', 'the new key cannot go to someone who left');
  assert.equal(r.modRotates, '200');
  assert.equal(r.afterRotate, false);
  assert.equal(r.leaverHoldsNewKey, false);

  assert.equal(r.victimRewritten, false, 'another wave\'s ping is untouched');

  assert.deepEqual(r.records, { first: 1, stale: '409 KEY_RECORDS_STALE', staleCarries: 1, read: 1, others: 0 });

  assert.equal(r.deletion.before, false);
  assert.equal(r.deletion.status, 200);
  assert.equal(r.deletion.after, true, 'a deleted holder still has the key on their devices');
});

test('counterfactual: without the fixes the old behaviour returns', { timeout: 240000 }, async () => {
  const r = await scenario({ fixed: false });
  assert.equal(r.plainSend, '201', 'plain text accepted into an encrypted wave');
  assert.equal(r.plainReply, '201');
  assert.equal(r.plainEdit, '200');
  assert.ok(r.storedPlain >= 2);
  assert.equal(r.overwrite, '200', 'a member overwrites another member\'s key');
  assert.equal(r.toOutsider, '200');
  assert.equal(r.rotateIncludingLeaver, '200', 'the new key goes to someone who left');
  assert.equal(r.victimRewritten, true, 'another wave\'s ping is overwritten');
});
