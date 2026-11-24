'use strict';

// A server's federation key is replaced by handshake (v2.147.0).
//
// Replacing the key used to take effect at once. Every allied server went on
// checking our signatures against the key it had saved, refused everything,
// and the queue dropped what it couldn't deliver after five refusals. Now the
// next key waits beside the current one; each ally is told and counts as having
// it only when it answers; we sign to an ally with the new key only after that;
// the ally switches when it first sees it; and the old private key is deleted
// only when every active ally has confirmed.
//
// Three real servers: A replaces its key; B is reachable; C is reached through
// a proxy that can lose A's announcements or C's answers, as a network does.
//
// Counterfactual: a copy of server.js in which A signs with the new key whether
// or not the ally confirmed. C, which never received the key, then refuses A —
// the failure this release exists to prevent.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'KeyHandshake123!';
const Sqlite = require(path.join(root, 'server/node_modules/better-sqlite3'));

const rsa = () => crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const keyId = (pem) => crypto.createHash('sha256')
  .update(crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 32);

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

function signedHeaders({ method, url, body, privateKey, nodeName }) {
  const u = new URL(url);
  const date = new Date().toUTCString();
  const parts = [`(request-target): ${method.toLowerCase()} ${u.pathname}`, `host: ${u.host}`, `date: ${date}`];
  const names = ['(request-target)', 'host', 'date'];
  const headers = { 'Content-Type': 'application/json', Date: date };
  if (body) {
    headers.Digest = `SHA-256=${crypto.createHash('sha256').update(body).digest('base64')}`;
    parts.push(`digest: ${headers.Digest}`);
    names.push('digest');
  }
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(parts.join('\n'));
  headers.Signature = `keyId="https://${nodeName}/api/federation/identity#main-key",algorithm="rsa-sha256",` +
    `headers="${names.join(' ')}",signature="${signer.sign(privateKey, 'base64')}"`;
  return headers;
}

/** A proxy in front of C: 'pass', 'drop' (A's announcement never arrives) or 'swallow' (C's answer is lost). */
async function lossyProxy(targetPort) {
  const proxy = { mode: 'pass', seen: [] };
  proxy.srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const rotation = req.url.startsWith('/api/federation/key-rotation');
      if (rotation) proxy.seen.push(req.url);
      if (rotation && proxy.mode === 'drop') { res.statusCode = 503; return res.end('{"error":"unreachable"}'); }
      const fwd = http.request({ host: '127.0.0.1', port: targetPort, path: req.url, method: req.method, headers: req.headers }, (up) => {
        const out = [];
        up.on('data', c => out.push(c));
        up.on('end', () => {
          if (rotation && proxy.mode === 'swallow') { res.statusCode = 503; return res.end('{"error":"answer lost"}'); }
          res.writeHead(up.statusCode, up.headers);
          res.end(Buffer.concat(out));
        });
      });
      fwd.on('error', () => { res.statusCode = 502; res.end(); });
      fwd.end(Buffer.concat(chunks));
    });
  });
  await new Promise(r => proxy.srv.listen(0, '127.0.0.1', r));
  proxy.port = proxy.srv.address().port;
  return proxy;
}

async function startServer({ temp, name, port, keys, allies, signNextAlways = false }) {
  const serverDir = path.join(temp, name);
  fs.mkdirSync(serverDir);
  for (const f of fs.readdirSync(path.join(root, 'server'))) {
    if (/\.(js|sql)$/.test(f) || f === 'package.json') fs.copyFileSync(path.join(root, 'server', f), path.join(serverDir, f));
  }
  fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
  fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(serverDir, 'data'));

  const file = path.join(serverDir, 'server.js');
  let src = fs.readFileSync(file, 'utf8');
  // The queue runs every 20-40 s; a test can't wait that long.
  const jitter = 'const jitter = 20000 + Math.floor(Math.random() * 20000);';
  assert.ok(src.includes(jitter), 'could not find the queue interval');
  src = src.replace(jitter, 'const jitter = 300;');
  if (signNextAlways) {
    const check = "if (h?.action === 'announce' && h.confirmedAt && h.keyId === federationKeyId(identity.nextPublicKey)) {";
    assert.ok(src.includes(check), 'counterfactual: could not find the confirmation check in signingKeyFor');
    src = src.replace(check, 'if (true) {');
  }
  fs.writeFileSync(file, src);

  const dbPath = path.join(serverDir, 'data/farhold.db');
  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const setup = new DatabaseSQLite({ dbPath });
  const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync(password, 4);
  setup.createUser({ id: `u-admin-${name}`, handle: 'admin', email: `admin@${name}.test`, passwordHash: hash, displayName: 'Admin' });
  setup.setServerIdentity({ nodeName: `${name}.example`, publicKey: keys.publicKey, privateKey: keys.privateKey });
  const now = new Date().toISOString();
  for (const a of allies) {
    setup.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                      VALUES (?, ?, ?, ?, 'active', ?)`).run(`fed-${a.name}`, `${a.name}.example`, a.baseUrl, a.publicKey, now);
  }
  setup.db.close();

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
      USE_SQLITE: 'true', JWT_SECRET: `isolated-key-handshake-${name}`,
      FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: `${name}.example`, SEED_DEMO_DATA: 'false',
      FEDERATION_KEY_RETRY_MS: '1000',
      RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25000;
  for (;;) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`${name} failed to start: ${output.slice(-3000)}`);
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 100));
  }

  const api = async (method, urlPath, { token, body, stepUp } = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(stepUp ? { 'X-Step-Up-Token': stepUp } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, body: json };
  };
  const token = (await api('POST', '/api/auth/login', { body: { handle: 'admin', password } })).body?.token;
  assert.ok(token, `${name}: admin login failed: ${output.slice(-1500)}`);
  const stepUp = (await api('POST', '/api/auth/step-up', { token, body: { password } })).body?.stepUpToken;
  assert.ok(stepUp, `${name}: step-up failed`);
  const sql = (q, ...args) => {
    const d = new Sqlite(dbPath);
    try { return /^\s*select/i.test(q) ? d.prepare(q).all(...args) : d.prepare(q).run(...args); } finally { d.close(); }
  };
  return { name, base, child, api, token, stepUp, sql, output: () => output };
}

async function eventually(fn, what, ms = 10000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function run({ signNextAlways = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-keyhandshake-'));
  const servers = [];
  let proxy, proxyB;
  try {
    const [pa, pb, pc] = [await freePort(), await freePort(), await freePort()];
    const keys = { a: rsa(), b: rsa(), c: rsa() };
    proxy = await lossyProxy(pc);
    proxyB = await lossyProxy(pb);
    const A = await startServer({ temp, name: 'a', port: pa, keys: keys.a, signNextAlways, allies: [
      { name: 'b', baseUrl: `http://127.0.0.1:${proxyB.port}`, publicKey: keys.b.publicKey },
      { name: 'c', baseUrl: `http://127.0.0.1:${proxy.port}`, publicKey: keys.c.publicKey },
    ] });
    const B = await startServer({ temp, name: 'b', port: pb, keys: keys.b, allies: [{ name: 'a', baseUrl: A.base, publicKey: keys.a.publicKey }] });
    const C = await startServer({ temp, name: 'c', port: pc, keys: keys.c, allies: [{ name: 'a', baseUrl: A.base, publicKey: keys.a.publicKey }] });
    servers.push(A, B, C);

    // A asks an ally about someone, signed by A. 404 = the ally accepted the
    // signature (no such person); 502 = it refused it (A reports the 401).
    let n = 0;
    const lookUp = async (ally) => (await A.api('GET', `/api/users/resolve/${encodeURIComponent(`@nobody${++n}@${ally}.example`)}`, { token: A.token })).status;
    assert.equal(await lookUp('b'), 404, 'before any change, B accepts A');
    assert.equal(await lookUp('c'), 404, 'before any change, C accepts A');

    // C misses every announcement while it is "offline".
    proxy.mode = 'drop';
    const start = await A.api('POST', '/api/admin/federation/key-rotation', { token: A.token, stepUp: A.stepUp });
    assert.equal(start.status, 200, JSON.stringify(start.body));
    const rot = start.body.keyRotation;
    assert.equal(rot.inProgress, true);
    const byName = Object.fromEntries(rot.allies.map(x => [x.nodeName, x.state]));
    assert.equal(byName['b.example'], 'confirmed', 'B answered, so B is confirmed');
    assert.equal(byName['c.example'], 'waiting', 'C never answered, so C is still waiting');
    const nextKey = A.sql('SELECT next_public_key FROM server_identity')[0].next_public_key;
    assert.equal(rot.nextKeyId, keyId(nextKey));
    assert.equal(A.sql('SELECT public_key FROM server_identity')[0].public_key, keys.a.publicKey, 'A still holds its current key');

    if (signNextAlways) {
      // The bug: A signs with a key C was never given.
      assert.equal(await lookUp('c'), 502, 'counterfactual: C refuses A once A signs with a key C never received');
      return;
    }

    // A signs to C, which has no new key, with the old one; to B with the new.
    assert.equal(await lookUp('c'), 404, 'C, which never got the new key, still accepts A');
    assert.equal(await lookUp('b'), 404, 'B accepts A signing with the new key');
    let bRow = B.sql("SELECT public_key, next_public_key, previous_public_key FROM federation_nodes WHERE node_name = 'a.example'")[0];
    assert.equal(bRow.public_key, nextKey, 'B switched on the first request signed with the new key');
    assert.equal(bRow.previous_public_key, keys.a.publicKey);
    assert.equal(bRow.next_public_key, null);

    // Requests in flight: the old key is still accepted for a few minutes, then not.
    const probe = async (privateKey) => {
      const url = `${B.base}/api/federation/users/nobody-${crypto.randomUUID()}`;
      return (await fetch(url, { headers: signedHeaders({ method: 'GET', url, privateKey, nodeName: 'a.example' }) })).status;
    };
    assert.equal(await probe(keys.a.privateKey), 404, 'old key accepted just after the switch');
    B.sql("UPDATE federation_nodes SET previous_key_until = '2000-01-01T00:00:00.000Z' WHERE node_name = 'a.example'");
    assert.equal(await probe(keys.a.privateKey), 401, 'old key refused once its few minutes are over');

    // C comes back, but its answer is lost: it stored the key, A doesn't know.
    proxy.mode = 'swallow';
    await A.api('POST', '/api/admin/federation/key-rotation/retry', { token: A.token });
    assert.equal(C.sql("SELECT next_public_key FROM federation_nodes WHERE node_name = 'a.example'")[0].next_public_key, nextKey,
      'C stored the key before answering');
    assert.ok(A.sql('SELECT next_private_key FROM server_identity')[0].next_private_key, 'A keeps both keys: no answer, no change');
    assert.equal(await lookUp('c'), 404, 'C still accepts A on the old key');

    // The answer gets through on a resend; nothing is duplicated; A finishes.
    proxy.mode = 'pass';
    const retried = await A.api('POST', '/api/admin/federation/key-rotation/retry', { token: A.token });
    assert.equal(retried.body.keyRotation, null, 'every active ally confirmed: the change is over');
    const ident = A.sql('SELECT public_key, next_public_key, next_private_key FROM server_identity')[0];
    assert.equal(ident.public_key, nextKey, 'the next key is now the key');
    assert.equal(ident.next_private_key, null, 'and the old private key is gone');
    assert.equal(A.sql('SELECT COUNT(*) AS n FROM federation_key_handovers')[0].n, 0);
    assert.equal(await lookUp('c'), 404, 'C accepts the new key and switches');
    assert.equal(C.sql("SELECT public_key FROM federation_nodes WHERE node_name = 'a.example'")[0].public_key, nextKey);
    assert.equal((await fetch(`${A.base}/api/federation/identity`).then(r => r.json())).keyId, keyId(nextKey));

    // Forged announcements to B.
    const currentA = A.sql('SELECT private_key FROM server_identity')[0].private_key;
    const announce = async ({ signWith = currentA, newKeys = rsa(), proofKey } = {}) => {
      const date = new Date().toUTCString();
      const kid = keyId(newKeys.publicKey);
      const s = crypto.createSign('RSA-SHA256');
      s.update(`cortex-key-rotation\na.example\nb.example\n${kid}\n${date}`);
      const body = JSON.stringify({ nodeName: 'a.example', newPublicKey: newKeys.publicKey, newKeyId: kid, proofDate: date,
        proof: s.sign((proofKey || newKeys).privateKey, 'base64') });
      const url = `${B.base}/api/federation/key-rotation`;
      const res = await fetch(url, { method: 'POST', body, headers: signedHeaders({ method: 'POST', url, body, privateKey: signWith, nodeName: 'a.example' }) });
      return res.status;
    };
    assert.equal(await announce({ signWith: rsa().privateKey }), 401, 'an announcement not signed by A is refused');
    assert.equal(await announce({ proofKey: rsa() }), 401, "a proof not signed by the announced key is refused");
    assert.equal(await announce(), 409, "a key A's own identity page does not list is refused");
    assert.equal(B.sql("SELECT next_public_key FROM federation_nodes WHERE node_name = 'a.example'")[0].next_public_key, null,
      'B stored none of them');

    // A refused signature doesn't use up a queued message's attempts.
    C.sql("UPDATE federation_nodes SET public_key = ?, previous_public_key = NULL WHERE node_name = 'a.example'", rsa().publicKey);
    A.sql(`INSERT INTO federation_queue (id, target_node, message_type, payload, status, attempts, max_attempts, created_at)
           VALUES ('q-1', 'c.example', 'decoy', ?, 'pending', 0, 5, ?)`,
      JSON.stringify({ id: 'env-q-1', type: 'decoy', payload: { nonce: 'x' } }), new Date().toISOString());
    const queued = await eventually(() => {
      const r = A.sql("SELECT attempts, status, last_error FROM federation_queue WHERE id = 'q-1'")[0];
      return r?.last_error ? r : null;
    }, 'the queue to try the message');
    assert.match(queued.last_error, /401/);
    assert.equal(queued.attempts, 0, 'a refused signature does not use up an attempt');
    assert.equal(queued.status, 'pending', 'the message is kept');
    C.sql("UPDATE federation_nodes SET public_key = ? WHERE node_name = 'a.example'", nextKey);

    // A name change or an instant key change is refused while allies exist.
    const rename = await A.api('POST', '/api/admin/federation/identity', { token: A.token, body: { nodeName: 'renamed.example' } });
    assert.equal(rename.status, 409);
    assert.equal(rename.body.code, 'NAME_CHANGE_WITH_ALLIES');
    const regen = await A.api('POST', '/api/admin/federation/identity', { token: A.token, body: { nodeName: 'a.example', regenerateKeys: true } });
    assert.equal(regen.status, 409);
    assert.equal(regen.body.code, 'USE_KEY_ROTATION');

    // A pairing in progress refuses a change.
    A.sql(`INSERT INTO federation_nodes (id, node_name, base_url, status, created_at) VALUES ('fed-d', 'd.example', 'http://127.0.0.1:9', 'outbound_pending', ?)`, new Date().toISOString());
    const pairing = await A.api('POST', '/api/admin/federation/key-rotation', { token: A.token, stepUp: A.stepUp });
    assert.equal(pairing.status, 409);
    assert.equal(pairing.body.code, 'PAIRING_IN_PROGRESS');
    A.sql("DELETE FROM federation_nodes WHERE id = 'fed-d'");

    // Cancel: too late once an ally confirmed. C is unreachable this time.
    proxy.mode = 'drop';
    const second = await A.api('POST', '/api/admin/federation/key-rotation', { token: A.token, stepUp: A.stepUp });
    assert.equal(second.status, 200);
    assert.equal(second.body.keyRotation.inProgress, true, 'C has not answered: the change stays open');
    const late = await A.api('POST', '/api/admin/federation/key-rotation/cancel', { token: A.token, stepUp: A.stepUp });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, 'KEY_ROTATION_CONFIRMED');
    proxy.mode = 'pass';
    await eventually(async () => (await A.api('POST', '/api/admin/federation/key-rotation/retry', { token: A.token })).body.keyRotation === null, 'second change to finish');

    // v2.147.1 — back to back, with no traffic between: the next announcement
    // is the first request each ally sees signed with the key it just learned,
    // and that switch makes it the current key. QA found this refused once
    // ("must be signed with the current key"), costing a 10-minute retry.
    const backToBack = await A.api('POST', '/api/admin/federation/key-rotation', { token: A.token, stepUp: A.stepUp });
    assert.equal(backToBack.status, 200, JSON.stringify(backToBack.body));
    assert.equal(backToBack.body.keyRotation, null,
      `a change straight after another is confirmed at once: ${JSON.stringify(backToBack.body.keyRotation)}`);
    const keyAfterSecond = A.sql('SELECT public_key FROM server_identity')[0].public_key;
    assert.equal(await lookUp('b'), 404);
    assert.equal(await lookUp('c'), 404);

    // Cancel before anyone confirmed: B unreachable, C's answer lost. C kept
    // the key; the withdrawal reaches it once the path is back.
    proxyB.mode = 'drop';
    proxy.mode = 'swallow';
    const third = await A.api('POST', '/api/admin/federation/key-rotation', { token: A.token, stepUp: A.stepUp });
    assert.equal(third.status, 200);
    const thirdKey = A.sql('SELECT next_public_key FROM server_identity')[0].next_public_key;
    assert.equal(C.sql("SELECT next_public_key FROM federation_nodes WHERE node_name = 'a.example'")[0].next_public_key, thirdKey);
    const cancel = await A.api('POST', '/api/admin/federation/key-rotation/cancel', { token: A.token, stepUp: A.stepUp });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(A.sql('SELECT next_private_key FROM server_identity')[0].next_private_key, null, 'the cancelled private key is gone at once');
    assert.equal(A.sql('SELECT public_key FROM server_identity')[0].public_key, keyAfterSecond, 'the current key is unchanged');
    proxy.mode = 'pass';
    proxyB.mode = 'pass';
    await A.api('POST', '/api/admin/federation/key-rotation/retry', { token: A.token });
    assert.equal(C.sql("SELECT next_public_key FROM federation_nodes WHERE node_name = 'a.example'")[0].next_public_key, null,
      'C dropped the withdrawn key');
    assert.equal(A.sql('SELECT COUNT(*) AS n FROM federation_key_handovers')[0].n, 0, 'no withdrawal owed');

    // A suspended ally is told, but does not hold the change open.
    await A.api('PUT', '/api/admin/federation/nodes/fed-b', { token: A.token, body: { status: 'suspended' } });
    const fourth = await A.api('POST', '/api/admin/federation/key-rotation', { token: A.token, stepUp: A.stepUp });
    assert.equal(fourth.status, 200);
    assert.equal(fourth.body.keyRotation, null, 'C confirmed; suspended B does not hold the change open');
    const fourthKey = A.sql('SELECT public_key FROM server_identity')[0].public_key;
    assert.equal(B.sql("SELECT next_public_key FROM federation_nodes WHERE node_name = 'a.example'")[0].next_public_key, fourthKey,
      'suspended B was still told');
    await A.api('PUT', '/api/admin/federation/nodes/fed-b', { token: A.token, body: { status: 'active' } });
    assert.equal(await lookUp('b'), 404, 'reactivated B accepts the key it was told of');

    // Exposed key: replaced at once, after typing the name. Allies refuse A
    // until their admin pairs again, and are told the fingerprint changed.
    const wrong = await A.api('POST', '/api/admin/federation/identity/replace-now', { token: A.token, stepUp: A.stepUp, body: { confirm: 'nope' } });
    assert.equal(wrong.status, 400);
    const now = await A.api('POST', '/api/admin/federation/identity/replace-now', { token: A.token, stepUp: A.stepUp, body: { confirm: 'a.example' } });
    assert.equal(now.status, 200);
    assert.deepEqual(now.body.cutOff.sort(), ['b.example', 'c.example']);
    assert.equal(await lookUp('b'), 502, 'B refuses A until it pairs again');
    const repair = await B.api('POST', '/api/admin/federation/nodes/fed-a/handshake', { token: B.token });
    assert.equal(repair.status, 200, JSON.stringify(repair.body));
    assert.equal(repair.body.keyChanged, true);
    assert.equal(repair.body.keyId, now.body.keyId, "B shows the fingerprint A's admin sees");
    assert.equal(await lookUp('b'), 404, 'paired again');
  } finally {
    for (const s of servers) s.child.kill('SIGTERM');
    if (proxy) proxy.srv.close();
    if (proxyB) proxyB.srv.close();
    await new Promise(r => setTimeout(r, 200));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('a federation key is replaced only once each ally has it', { timeout: 120000 }, async () => {
  await run();
});

test('counterfactual: signing with the new key before the ally confirmed it breaks the ally', { timeout: 120000 }, async () => {
  await run({ signNextAlways: true });
});
