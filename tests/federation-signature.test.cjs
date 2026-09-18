'use strict';

// Federation HTTP signature hardening (v2.93.1).
//
// Finding F-1 from the Communities Phase 0 threat model. The verifier rebuilt
// its signing string from the header list inside the sender's own Signature
// header, with no floor on what that list had to contain. A peer could sign
// `(request-target)` alone, and then:
//
//   * no signed date  -> `new Date(undefined)` -> NaN -> `NaN > 5` is false,
//                        so the 5-minute freshness window passed and the
//                        request was replayable forever;
//   * no signed digest -> the body was outside the signature, so the digest
//                        header could be rewritten along with the body.
//
// These tests sign with a REAL key the server accepts, and vary only which
// headers the signature covers — so a pass means the floor is doing the work,
// not that the request was rejected for some unrelated reason.

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

/** Sign exactly the headers named — the whole point is to vary this. */
function sign({ method, pathname, host, body, privateKey, nodeName, headers, date }) {
  const bodyString = body === null || body === undefined ? '' : JSON.stringify(body);
  const digest = bodyString
    ? `SHA-256=${crypto.createHash('sha256').update(bodyString).digest('base64')}`
    : '';
  const when = date === undefined ? new Date().toUTCString() : date;

  const parts = headers.map(h => {
    if (h === '(request-target)') return `(request-target): ${method.toLowerCase()} ${pathname}`;
    if (h === 'host') return `host: ${host}`;
    if (h === 'date') return `date: ${when}`;
    if (h === 'digest') return `digest: ${digest}`;
    throw new Error(`unhandled header ${h}`);
  });

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(parts.join('\n'));
  const signature = signer.sign(privateKey, 'base64');

  const out = {
    'Content-Type': 'application/json',
    'Signature': `keyId="https://${nodeName}/api/federation/identity#main-key",` +
                 `algorithm="rsa-sha256",headers="${headers.join(' ')}",signature="${signature}"`,
  };
  if (headers.includes('date')) out['Date'] = when;
  if (digest) out['Digest'] = digest;
  return { headers: out, bodyString };
}

test('federation signatures must cover the date and the body', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fedsig-'));
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

    // A peer whose key this server genuinely trusts.
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const peerNode = 'peer.example';

    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const db = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    db.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                   VALUES (?, ?, ?, ?, 'active', ?)`)
      .run('fed-peer', peerNode, `https://${peerNode}`, publicKey, new Date().toISOString());
    db.db.close();

    fs.appendFileSync(
      path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('SIG_TEST_PORT=' + server.address().port));\n"
    );

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-federation-signature-000',
        FEDERATION_ENABLED: 'true', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 20000;
    while (!/SIG_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) {
        throw new Error('startup failed: ' + output.slice(-4000));
      }
      await new Promise(r => setTimeout(r, 50));
    }
    const port = output.match(/SIG_TEST_PORT=(\d+)/)[1];
    const host = `127.0.0.1:${port}`;
    const INBOX = '/api/federation/inbox';

    const send = async ({ headers: signedHeaders, body, date, overrideBody }) => {
      const { headers, bodyString } = sign({
        method: 'POST', pathname: INBOX, host, body,
        privateKey, nodeName: peerNode, headers: signedHeaders, date,
      });
      return fetch(`http://${host}${INBOX}`, {
        method: 'POST',
        headers,
        // overrideBody lets a test send something other than what was signed.
        body: overrideBody !== undefined ? overrideBody : bodyString,
      });
    };

    const payload = { id: `msg-${crypto.randomUUID()}`, type: 'ping', payload: {} };

    await t.test('a properly signed request is still accepted', async () => {
      // The control. Every Cortex node signs exactly this set, so if this
      // fails the fix has broken real federation rather than hardened it.
      const res = await send({ headers: ['(request-target)', 'host', 'date', 'digest'], body: payload });
      assert.notEqual(res.status, 401, `well-formed request rejected: ${await res.text()}`);
    });

    await t.test('a signature that does not cover the date is refused', async () => {
      // This is F-1. Before the fix the freshness check received
      // `new Date(undefined)`, produced NaN, and NaN > 5 is false — so it passed.
      const res = await send({ headers: ['(request-target)', 'host'], body: payload });
      assert.equal(res.status, 401);
    });

    await t.test('a signature that does not cover the body digest is refused', async () => {
      // A digest outside the signature can be rewritten with the body it
      // describes, so comparing it proves nothing.
      const res = await send({ headers: ['(request-target)', 'host', 'date'], body: payload });
      assert.equal(res.status, 401);
    });

    await t.test('a signature missing host is refused', async () => {
      const res = await send({ headers: ['(request-target)', 'date', 'digest'], body: payload });
      assert.equal(res.status, 401);
    });

    await t.test('an unparseable Date is refused rather than evaluating to NaN', async () => {
      const res = await send({
        headers: ['(request-target)', 'host', 'date', 'digest'],
        body: payload,
        date: 'not-a-date',
      });
      assert.equal(res.status, 401);
    });

    await t.test('a stale request is still refused', async () => {
      const old = new Date(Date.now() - 20 * 60 * 1000).toUTCString();
      const res = await send({
        headers: ['(request-target)', 'host', 'date', 'digest'],
        body: payload,
        date: old,
      });
      assert.equal(res.status, 401);
    });

    await t.test('a body swapped after signing is refused', async () => {
      const res = await send({
        headers: ['(request-target)', 'host', 'date', 'digest'],
        body: payload,
        overrideBody: JSON.stringify({ id: 'msg-evil', type: 'ping', payload: { tampered: true } }),
      });
      assert.equal(res.status, 401, 'digest mismatch must reject');
    });

    await t.test('an unknown node is refused whatever it signs', async () => {
      const other = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
      const { headers, bodyString } = sign({
        method: 'POST', pathname: INBOX, host, body: payload,
        privateKey: other.privateKey, nodeName: 'stranger.example',
        headers: ['(request-target)', 'host', 'date', 'digest'],
      });
      const res = await fetch(`http://${host}${INBOX}`, { method: 'POST', headers, body: bodyString });
      assert.equal(res.status, 403);
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
