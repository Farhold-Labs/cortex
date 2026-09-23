'use strict';

// Federated message authority (CORTEX-COMM-006 and 007, both High).
//
// Cortex trusts a peer's signature to prove WHO is speaking. It was then
// letting that peer decide WHAT it was speaking about:
//
//   006  A paired node could post into any wave whose id it could name, even
//        one it had never joined — and, because the origin relays, have the
//        origin sign that post onward to every other member. It could also
//        attribute the message to a user on a third node.
//
//   007  Edits and deletions were looked up by ping id across the whole
//        database. A peer with one legitimate wave of its own could rewrite or
//        tombstone any federated message cached anywhere on the node.
//
// Every test here signs with a key the server genuinely accepts, so a refusal
// means the authorization check refused it — not that the request was
// malformed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

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
      'Content-Type': 'application/json',
      Date: date,
      Digest: digest,
      Signature: `keyId="https://${nodeName}/api/federation/identity#main-key",` +
                 `algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signature}"`,
    },
    bodyString,
  };
}

test('a peer may only speak about waves it has joined, and only for its own users', { timeout: 90000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fedscope-'));
  let child, relayServer;
  const relayed = [];

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

    // A third peer that only counts what it is sent, so relay fan-out is
    // observable rather than inferred from logs.
    relayServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        relayed.push(JSON.parse(body || '{}'));
        res.setHeader('Content-Type', 'application/json');
        res.end('{"success":true}');
      });
    });
    await new Promise(r => relayServer.listen(0, '127.0.0.1', r));
    const relayBase = `http://127.0.0.1:${relayServer.address().port}`;

    const keys = {};
    for (const node of ['member.example', 'stranger.example', 'relay.example']) {
      keys[node] = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });
    }

    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const setup = new DatabaseSQLite({ dbPath });
    const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync('Review123!', 4);
    setup.createUser({ id: 'host-user', handle: 'host', email: 'host@example.test', passwordHash: hash, displayName: 'Host' });

    // This node's own federation identity, so relays can be signed. It is set
    // through an admin route in normal use, not from the environment.
    const ours = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    setup.setServerIdentity({ nodeName: 'host.example', publicKey: ours.publicKey, privateKey: ours.privateKey });

    const now = new Date().toISOString();
    for (const [node, base] of [['member.example', 'https://member.example'], ['stranger.example', 'https://stranger.example'], ['relay.example', relayBase]]) {
      setup.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                        VALUES (?, ?, ?, ?, 'active', ?)`)
        .run(`fed-${node}`, node, base, keys[node].publicKey, now);
    }

    // W: our wave. member.example and relay.example are in it; stranger is not.
    const hosted = setup.createWave({ title: 'Hosted here', createdBy: 'host-user', privacy: 'private' });
    setup.db.prepare("UPDATE waves SET federation_state = 'origin' WHERE id = ?").run(hosted.id);
    setup.addWaveFederationNode(hosted.id, 'member.example');
    setup.addWaveFederationNode(hosted.id, 'relay.example');

    // W2: member.example's own wave, which we merely participate in. This is
    // the "one legitimate wave" an attacker uses as a foothold in 007.
    const theirs = setup.createWave({ title: 'Theirs', createdBy: 'host-user', privacy: 'private' });
    setup.db.prepare("UPDATE waves SET federation_state = 'participant', origin_node = ?, origin_wave_id = ? WHERE id = ?")
      .run('member.example', 'remote-wave-2', theirs.id);
    setup.db.close();

    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('FEDSCOPE_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-federation-scope-key',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'host.example', SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 20000;
    while (!/FEDSCOPE_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }
    const port = output.match(/FEDSCOPE_PORT=(\d+)/)[1];
    const host = `127.0.0.1:${port}`;
    const INBOX = '/api/federation/inbox';

    const send = async (nodeName, type, payload) => {
      const body = { id: `env-${crypto.randomUUID()}`, type, payload };
      const { headers, bodyString } = signedRequest({
        method: 'POST', pathname: INBOX, host, body,
        privateKey: keys[nodeName].privateKey, nodeName,
      });
      const res = await fetch(`http://${host}${INBOX}`, { method: 'POST', headers, body: bodyString });
      // The inbox answers 200 for anything it accepted for processing; what a
      // refusal looks like is the absence of an effect, so every assertion
      // below reads the database rather than the status code.
      assert.notEqual(res.status, 401, 'signature rejected — the fixture is wrong, not the server');
      return res;
    };

    const open = () => new (require(path.join(root, 'server/node_modules/better-sqlite3')))(dbPath, { readonly: true });
    const pingRow = (id) => { const d = open(); try { return d.prepare('SELECT * FROM remote_pings WHERE id = ?').get(id); } finally { d.close(); } };

    const ping = (id, extra = {}) => ({
      ping: { id, authorId: 'them-1', content: 'hello from a peer', createdAt: new Date().toISOString(), ...extra },
      originWaveId: hosted.id,
      author: { id: 'them-1', nodeName: 'member.example', handle: 'them', displayName: 'Them' },
    });

    await t.test('a paired node that never joined the wave cannot post into it', async () => {
      const id = 'ping-from-stranger';
      await send('stranger.example', 'new_ping', {
        ...ping(id),
        author: { id: 'str-1', nodeName: 'stranger.example', handle: 'str', displayName: 'Stranger' },
      });
      assert.equal(pingRow(id), undefined, 'a wave is not joinable by naming its id');
    });

    await t.test('a member of the wave posts normally', async () => {
      const id = 'ping-from-member';
      await send('member.example', 'new_ping', ping(id));
      const row = pingRow(id);
      assert.ok(row, 'a genuine member was refused — the check is too tight');
      assert.equal(row.wave_id, hosted.id);
    });

    await t.test('a member cannot attribute its message to a third node', async () => {
      const id = 'ping-forged-author';
      await send('member.example', 'new_ping', {
        ...ping(id),
        author: { id: 'str-1', nodeName: 'stranger.example', handle: 'str', displayName: 'Stranger' },
      });
      assert.equal(pingRow(id), undefined, 'the origin would have relayed that forgery under its own signature');
    });

    await t.test('the origin relays a new message once, and a repeat not at all', async () => {
      // Relay is fire-and-forget over HTTP, so count what arrived FOR THIS PING
      // rather than how many requests the fake peer has seen in total: a relay
      // from an earlier subtest can land at any moment, and a timing artefact
      // here would read as a security regression. Then wait on the condition
      // rather than a fixed interval, because a loaded machine is slower.
      const id = 'ping-relayed';
      const relaysForThisPing = () =>
        relayed.filter(env => env?.payload?.ping?.id === id).length;
      const settle = async (want, ms = 5000) => {
        const deadline = Date.now() + ms;
        while (relaysForThisPing() < want && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
        await new Promise(r => setTimeout(r, 400));  // and a moment for any extra to arrive
      };

      await send('member.example', 'new_ping', ping(id));
      await settle(1);
      assert.equal(relaysForThisPing(), 1, 'the wave\'s other node should have received it exactly once');

      // Same ping, fresh envelope id — the inbox dedup does not catch this.
      await send('member.example', 'new_ping', ping(id));
      await settle(2);
      assert.equal(relaysForThisPing(), 1, 'a message we already hold is not new, and must not be amplified');
    });

    await t.test('an edit cannot reach a message in another wave', async () => {
      // member.example is the origin of W2, so this request is authorized for
      // W2 — and names a ping that lives in W.
      const before = pingRow('ping-from-member');
      await send('member.example', 'ping_edited', {
        pingId: 'ping-from-member',
        originWaveId: 'remote-wave-2',
        content: 'REWRITTEN BY A PEER',
        editedAt: new Date().toISOString(),
      });
      const after = pingRow('ping-from-member');
      assert.equal(after.content, before.content, 'a foothold in one wave rewrote a message in another');
    });

    await t.test('a delete cannot reach a message in another wave', async () => {
      await send('member.example', 'ping_deleted', {
        pingId: 'ping-from-member',
        originWaveId: 'remote-wave-2',
      });
      assert.equal(pingRow('ping-from-member').deleted, 0, 'the cheapest destructive act federation offers');
    });

    await t.test('the wave that owns a message can still edit and delete it', async () => {
      // The control: same peer, same routes, its own wave. If this fails the
      // fix has broken federation rather than scoped it.
      const id = 'ping-in-their-wave';
      await send('member.example', 'new_ping', {
        ping: { id, authorId: 'them-1', content: 'original', createdAt: new Date().toISOString() },
        originWaveId: 'remote-wave-2',
        author: { id: 'them-1', nodeName: 'member.example', handle: 'them', displayName: 'Them' },
      });
      assert.ok(pingRow(id), 'participant-side delivery broke');

      await send('member.example', 'ping_edited', {
        pingId: id, originWaveId: 'remote-wave-2',
        content: 'edited by its own origin', editedAt: new Date().toISOString(),
      });
      assert.equal(pingRow(id).content, 'edited by its own origin');

      await send('member.example', 'ping_deleted', { pingId: id, originWaveId: 'remote-wave-2' });
      assert.equal(pingRow(id).deleted, 1);
    });

    await t.test('an id already cached for one wave cannot be re-homed by a new_ping', async () => {
      // member.example is authorized for W2, and names an id that already
      // exists in W. Wave scope alone would let the content through.
      const before = pingRow('ping-relayed');
      await send('member.example', 'new_ping', {
        ping: { id: 'ping-relayed', authorId: 'them-1', content: 'OVERWRITTEN', createdAt: new Date().toISOString() },
        originWaveId: 'remote-wave-2',
        author: { id: 'them-1', nodeName: 'member.example', handle: 'them', displayName: 'Them' },
      });
      const after = pingRow('ping-relayed');
      assert.equal(after.content, before.content);
      assert.equal(after.wave_id, before.wave_id, 'a cached ping must not change waves');
    });
  } finally {
    if (child) child.kill('SIGKILL');
    if (relayServer) await new Promise(r => relayServer.close(r));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('remote object caches are scoped by the node that owns them', async () => {
  // Unit-level companions to the HTTP tests above: the guards live in the
  // storage layer, so they hold for every caller rather than the handlers that
  // happen to have been patched.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fedcache-'));
  try {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const db = new DatabaseSQLite({ dbPath: path.join(temp, 'test.db') });
    const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync('Review123!', 4);
    db.createUser({ id: 'u-host', handle: 'host', email: 'h@example.test', passwordHash: hash, displayName: 'Host' });
    // remote_pings.wave_id is a real foreign key, so the waves have to exist.
    const waveA = db.createWave({ title: 'A', createdBy: 'u-host' });
    const waveB = db.createWave({ title: 'B', createdBy: 'u-host' });

    db.cacheRemotePing({
      id: 'shared-id', waveId: waveA.id, originWaveId: 'origin-a', originNode: 'a.example',
      authorId: 'u1', authorNode: 'a.example', content: 'original', createdAt: new Date().toISOString(),
    });

    const refusedWave = db.cacheRemotePing({
      id: 'shared-id', waveId: waveB.id, originWaveId: 'origin-b', originNode: 'a.example',
      authorId: 'u1', authorNode: 'a.example', content: 'rewritten', createdAt: new Date().toISOString(),
    });
    assert.equal(refusedWave.applied, false);
    assert.equal(db.getRemotePing('shared-id').content, 'original');

    const refusedNode = db.cacheRemotePing({
      id: 'shared-id', waveId: waveA.id, originWaveId: 'origin-a', originNode: 'b.example',
      authorId: 'u2', authorNode: 'b.example', content: 'rewritten', createdAt: new Date().toISOString(),
    });
    assert.equal(refusedNode.applied, false);
    assert.equal(db.getRemotePing('shared-id').content, 'original');

    const allowed = db.cacheRemotePing({
      id: 'shared-id', waveId: waveA.id, originWaveId: 'origin-a', originNode: 'a.example',
      authorId: 'u1', authorNode: 'a.example', content: 'edited by its owner', createdAt: new Date().toISOString(),
    });
    assert.equal(allowed.applied, true);
    assert.equal(db.getRemotePing('shared-id').content, 'edited by its owner');

    // Deleting by id alone is what the old handler did; naming the wave is
    // what the new one does.
    assert.equal(db.markRemotePingDeleted('shared-id', waveB.id), false);
    assert.equal(db.getRemotePing('shared-id').deleted, false);
    assert.equal(db.markRemotePingDeleted('shared-id', waveA.id), true);

    // A cached user belongs to the node that vouched for them.
    db.cacheRemoteUser({ id: 'user-x', nodeName: 'a.example', handle: 'alice', displayName: 'Alice' });
    db.cacheRemoteUser({ id: 'user-x', nodeName: 'b.example', handle: 'mallory', displayName: 'Mallory' });
    const cached = db.getRemoteUser('user-x');
    assert.equal(cached.nodeName, 'a.example', 'one peer rewrote another peer\'s cached user');
    assert.equal(cached.displayName, 'Alice');

    db.db.close();
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
