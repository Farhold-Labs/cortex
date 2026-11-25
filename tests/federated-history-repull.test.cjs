'use strict';

// Older copies get the history they missed (v2.155.2).
//
// Until v2.155.0 a copy pulled its history only from pings posted on the
// wave's own server, so a copy made before then lacks the earlier pings of
// the wave's people on other servers. Shortly after start, each copy not yet
// pulled in full is pulled once more, adding only what it lacks.
//
// One real server (host.example) holding copies of fake allies' waves:
//   - old-peer, from peer.example (protocol 4): pulled; a missing ping is
//     added, one held is left as it is, a deleted one stays deleted, one
//     claiming an author here is dropped; then recorded as pulled;
//   - old-third, from third.example (protocol 3, which doesn't send other
//     servers' pings): not asked, not recorded, so a later run tries again;
//   - done-peer, already recorded: not asked;
//   - old-up, from up.example, recorded at protocol 3 but upgraded since
//     (its identity page says 4): its protocol is refreshed and it is pulled.
// A copy pulled at acceptance is recorded too.
//
// Counterfactual: without the only-missing check, the held ping is overwritten.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'Repull-1!';
const ONLY_MISSING = 'if (onlyMissing && db.getRemotePing(d.id)) continue;';

const rsa = () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const at = (m) => new Date(Date.UTC(2026, 10, 1, 12, m)).toISOString();
const author = (id, handle, nodeName) => ({ id, handle, displayName: handle, avatar: handle[0].toUpperCase(), ...(nodeName ? { nodeName } : {}) });

async function fakeServer(histories, identity = null) {
  const peer = { got: [], histories, identity };
  peer.srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(body || '{}'); } catch { /* ignore */ }
      peer.got.push({ path: req.url, body: json });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/federation/identity' && peer.identity) return res.end(JSON.stringify(peer.identity));
      if (req.url === '/api/federation/wave-backfill') {
        return res.end(JSON.stringify({ pings: peer.histories[json.originWaveId] || [], hasMore: false }));
      }
      res.end('{"success":true}');
    });
  });
  await new Promise(r => peer.srv.listen(0, '127.0.0.1', r));
  peer.base = `http://127.0.0.1:${peer.srv.address().port}`;
  return peer;
}

async function run({ noOnlyMissing = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-repull-'));
  const peer = await fakeServer({
    'their-old': [
      { id: 'rp-zed-1', content: 'zed as the origin has it', createdAt: at(4), reactions: {}, author: author('u-zed', 'zed') },
      { id: 'rp-yan-1', content: 'yan from third', createdAt: at(3), reactions: {}, author: author('u-yan', 'yan', 'third.example') },
      { id: 'rp-gone', content: 'deleted here', createdAt: at(2), reactions: {}, author: author('u-zed', 'zed') },
      { id: 'rp-forged', content: 'not really cy', createdAt: at(1), reactions: {}, author: author('u-cy', 'cy', 'host.example') },
    ],
    'their-done': [
      { id: 'rp-done-1', content: 'never asked', createdAt: at(1), reactions: {}, author: author('u-zed', 'zed') },
    ],
  });
  const third = await fakeServer({ 'third-old': [] });
  const up = await fakeServer({ 'up-old': [
    { id: 'rp-up-1', content: 'from the upgraded server', createdAt: at(1), reactions: {}, author: author('u-uma', 'uma') },
  ] }, { nodeName: 'up.example', protocolVersion: 4 });
  const fakes = { 'peer.example': [peer, 4], 'third.example': [third, 3], 'up.example': [up, 3] };
  let child, output = '';
  try {
    const serverDir = path.join(temp, 'server');
    fs.mkdirSync(serverDir);
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));
    const f = path.join(serverDir, 'server.js');
    let src = fs.readFileSync(f, 'utf8');
    if (noOnlyMissing) {
      assert.ok(src.includes(ONLY_MISSING), 'counterfactual: only-missing check not found');
      src = src.split(ONLY_MISSING).join('');
    }
    fs.writeFileSync(f, src);

    const keys = { 'peer.example': rsa(), 'third.example': rsa(), 'up.example': rsa() };
    const dbPath = path.join(serverDir, 'data/farhold.db');
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const setup = new DatabaseSQLite({ dbPath });
    const hash = require(path.join(root, 'server/node_modules/bcryptjs')).hashSync(password, 4);
    for (const [id, handle] of [['u-admin', 'xadmin'], ['u-cy', 'cy']]) {
      setup.createUser({ id, handle, email: `${handle}@example.test`, passwordHash: hash, displayName: handle });
    }
    const ours = rsa();
    setup.setServerIdentity({ nodeName: 'host.example', publicKey: ours.publicKey, privateKey: ours.privateKey });
    const now = new Date().toISOString();
    for (const [node, [fake, protocol]] of Object.entries(fakes)) {
      setup.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at, protocol_version)
                        VALUES (?, ?, ?, ?, 'active', ?, ?)`).run(`fed-${node}`, node, fake.base, keys[node].publicKey, now, protocol);
    }
    // Copies made before v2.155.0.
    const copy = setup.db.prepare(`INSERT INTO waves (id, title, privacy, created_by, created_at, updated_at, federation_state, origin_node, origin_wave_id)
                                   VALUES (?, ?, 'private', 'u-cy', ?, ?, 'participant', ?, ?)`);
    copy.run('old-peer', 'Old copy', now, now, 'peer.example', 'their-old');
    copy.run('old-third', 'Old copy of third', now, now, 'third.example', 'third-old');
    copy.run('done-peer', 'Pulled already', now, now, 'peer.example', 'their-done');
    copy.run('old-up', 'Old copy of up', now, now, 'up.example', 'up-old');
    const held = setup.db.prepare(`INSERT INTO remote_pings (id, wave_id, origin_wave_id, origin_node, author_id, author_node, content, created_at, cached_at, updated_at, deleted)
                                   VALUES (?, 'old-peer', 'their-old', 'peer.example', 'u-zed', 'peer.example', ?, ?, ?, ?, ?)`);
    held.run('rp-zed-1', 'zed as held here', at(4), now, now, 0);
    held.run('rp-gone', '', at(2), now, now, 1);
    setup.markFederatedHistoryPulled('done-peer');
    setup.db.close();

    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'isolated-repull-key-00000000000000000',
        FEDERATION_ENABLED: 'true', FEDERATION_NODE_NAME: 'host.example', SEED_DEMO_DATA: 'false',
        HISTORY_PULL_DELAY_MS: '300',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/Older copies' history: \d+ pulled/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('no history run: ' + output.slice(-4000));
      await new Promise(r => setTimeout(r, 50));
    }

    const raw = (sql, ...args) => {
      const d = new (require(path.join(root, 'server/node_modules/better-sqlite3')))(dbPath, { readonly: true });
      try { return d.prepare(sql).all(...args); } finally { d.close(); }
    };
    return {
      asked: [...peer.got, ...third.got, ...up.got].filter(m => m.path === '/api/federation/wave-backfill').map(m => `${m.body.originWaveId}:${m.body.travellers}`).sort(),
      copy: raw("SELECT id, content, deleted, author_node n FROM remote_pings WHERE wave_id = 'old-peer' ORDER BY id").map(x => `${x.id}|${x.content}|${x.deleted}|${x.n}`),
      pulled: raw('SELECT wave_id FROM federated_history_pulls ORDER BY wave_id').map(x => x.wave_id),
      upCopy: raw("SELECT id FROM remote_pings WHERE wave_id = 'old-up'").map(x => x.id),
      protocols: raw('SELECT node_name, protocol_version p FROM federation_nodes ORDER BY node_name').map(x => `${x.node_name}:${x.p}`),
      log: output.match(/Older copies' history: .*/)[0],
    };
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
    for (const [p] of Object.values(fakes)) p.srv.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

let fixed;
const fixedRun = () => (fixed ||= run());

test('an older copy is pulled once more, asking for other servers\' pings; one already pulled is not', async () => {
  const r = await fixedRun();
  assert.deepEqual(r.asked, ['their-old:true', 'up-old:true']);
  assert.equal(r.log, "Older copies' history: 2 pulled, 1 waiting");
});

test('only missing pings are added: held, deleted and forged ones are left out', async () => {
  const r = await fixedRun();
  assert.deepEqual(r.copy, [
    'rp-gone||1|peer.example',
    'rp-yan-1|yan from third|0|third.example',
    'rp-zed-1|zed as held here|0|peer.example',
  ]);
});

test('the copy is recorded as pulled; one whose server is below protocol 4 waits', async () => {
  const r = await fixedRun();
  assert.deepEqual(r.pulled, ['done-peer', 'old-peer', 'old-up']);
});

test('a server recorded at an older protocol is asked again, and pulled once it has upgraded', async () => {
  const r = await fixedRun();
  assert.deepEqual(r.protocols, ['peer.example:4', 'third.example:3', 'up.example:4']);
  assert.deepEqual(r.upCopy, ['rp-up-1']);
});

test('counterfactual: without the only-missing check, a held ping is overwritten', async () => {
  const r = await run({ noOnlyMissing: true });
  assert.ok(r.copy.includes('rp-zed-1|zed as the origin has it|0|peer.example'), JSON.stringify(r.copy));
});
