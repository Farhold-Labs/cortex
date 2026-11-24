'use strict';

// Signed pings, phase 1c (v2.151.0, docs/federated-e2ee/02-identity-keys.md).
//
// A signed (format-2) ping is bound to its author's address,
// <user id>@<server name>. The server tells devices that name
// (/api/e2ee/status). If it followed a rename, or a first name given when
// federation is turned on, every signed ping already sent would stop opening.
// So the name is fixed when the first signed ping arrives.
//
// The test sends a signed ping, renames the server (restart with another
// name), and checks devices are still told the first name; before any signed
// ping the name still follows the server. Counterfactual: without the pin,
// the name follows the rename.
//
// Sealing, opening and signature checks themselves: e2ee-identity.test.cjs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const nodeCrypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const loadCrypto = () => import(path.join(root, 'client/crypto.js'));
const PIN = '  if (body.format === 2) db.pinSealNodeName(currentNodeName());\n';

function prepare(temp, stripPin) {
  const serverDir = path.join(temp, 'server');
  fs.mkdirSync(serverDir);
  for (const name of fs.readdirSync(path.join(root, 'server'))) {
    if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
  }
  fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
  fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(serverDir, 'data'));
  const file = path.join(serverDir, 'server.js');
  let src = fs.readFileSync(file, 'utf8');
  if (stripPin) {
    assert.ok(src.includes(PIN), 'pin not found in server.js');
    src = src.split(PIN).join('');
  }
  fs.writeFileSync(file, src + "\nserver.on('listening', () => console.log('SIGNED_PORT=' + server.address().port));\n");
  return serverDir;
}

async function start(serverDir, nodeName) {
  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-signed-pings-00000000000',
      SEED_DEMO_DATA: 'false', FEDERATION_NODE_NAME: nodeName,
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 25000;
  while (!/SIGNED_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const base = `http://127.0.0.1:${output.match(/SIGNED_PORT=(\d+)/)[1]}`;
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
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise(r => child.once('exit', r));
  };
  return { api, stop, output: () => output };
}

async function scenario({ stripPin = false, sendSigned = true }) {
  const c = await loadCrypto();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-signed-'));
  let srv;
  try {
    const dir = prepare(temp, stripPin);
    srv = await start(dir, 'first.example.test');
    const password = 'Signed-pings-1!';
    await srv.api('POST', '/api/auth/register', { body: { handle: 'sadmin', email: 'sadmin@example.test', password, displayName: 'sadmin' } });
    await srv.api('POST', '/api/auth/register', { body: { handle: 'sauthor', email: 'sauthor@example.test', password, displayName: 'sauthor' } });
    const login = async () => (await srv.api('POST', '/api/auth/login', { body: { handle: 'sauthor', password } })).body;
    const me = await login();
    const enc = await c.setupUserE2EE(password);
    await srv.api('POST', '/api/e2ee/keys/register', { token: me.token, body: { publicKey: enc.publicKey, encryptedPrivateKey: enc.encryptedPrivateKey, salt: enc.salt } });
    const before = (await srv.api('GET', '/api/e2ee/status', { token: me.token })).body.nodeName;

    const created = await srv.api('POST', '/api/waves', { token: me.token, body: {
      title: 'Signed', privacy: 'private', participants: [], encrypted: true,
      keyDistribution: [{ userId: null, encryptedWaveKey: 'QUJD:REVG', senderPublicKey: enc.publicKey }],
    } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const b64 = (n) => nodeCrypto.randomBytes(n).toString('base64');
    const sent = await srv.api('POST', '/api/pings', { token: me.token, body: {
      wave_id: created.body.id, content: b64(160), encrypted: true, nonce: b64(12), keyVersion: 1, ...(sendSigned ? { format: 2 } : {}),
    } });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    await srv.stop();

    // The server is renamed.
    srv = await start(dir, 'second.example.test');
    const after = (await srv.api('GET', '/api/e2ee/status', { token: (await login()).token })).body.nodeName;
    return { before, after, warned: /signed encrypted pings name it "first\.example\.test"/.test(srv.output()) };
  } finally {
    if (srv) await srv.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('the server name in signed pings is fixed by the first one, through a rename', { timeout: 120000 }, async () => {
  const r = await scenario({});
  assert.equal(r.before, 'first.example.test');
  assert.equal(r.after, 'first.example.test', 'devices must keep sealing with the name the first signed ping used');
  assert.equal(r.warned, true, 'the operator is told at boot');
});

test('before any signed ping the name follows the server', { timeout: 120000 }, async () => {
  const r = await scenario({ sendSigned: false });
  assert.equal(r.after, 'second.example.test');
  assert.equal(r.warned, false);
});

test('counterfactual: without the pin, a rename changes the name devices seal with', { timeout: 120000 }, async () => {
  const r = await scenario({ stripPin: true });
  assert.equal(r.after, 'second.example.test', 'with the pin stripped, every signed ping already sent would stop opening');
});
