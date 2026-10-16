'use strict';

// tools/offsite-backup.sh: an encrypted, verified backup sent to S3 storage.
//
// Runs the real script against a throwaway node and a fake S3 endpoint, then
// decrypts what arrived with a key the "node" never held.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const Database = createRequire(path.join(root, 'server/package.json'))('better-sqlite3');
const script = path.join(root, 'tools/offsite-backup.sh');

const have = (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0;
const skip = !(have('gpg') && have('zstd')) && 'needs gpg and zstd';

function fakeS3({ lieAboutSize = false } = {}) {
  const objects = new Map();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const key = req.url.split('?')[0]; // the SDK adds ?x-id=PutObject
      if (req.method === 'PUT') {
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { ETag: '"x"' }).end();
      } else if (req.method === 'HEAD' && objects.has(key)) {
        const len = objects.get(key).length + (lieAboutSize ? 1 : 0);
        res.writeHead(200, { 'Content-Length': len, 'Content-Type': 'application/pgp-encrypted' }).end();
      } else {
        res.writeHead(404).end();
      }
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, objects, port: server.address().port })));
}

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-offsite-'));
  const serverDir = path.join(home, 'cortex/server');
  fs.mkdirSync(path.join(serverDir, 'data'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server/package.json'), path.join(serverDir, 'package.json'));
  fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
  const db = new Database(path.join(serverDir, 'data/farhold.db'));
  db.exec("CREATE TABLE users (id TEXT); CREATE TABLE pings (id TEXT); INSERT INTO users VALUES ('u1'),('u2'); INSERT INTO pings VALUES ('p1');");
  db.close();
  fs.writeFileSync(path.join(serverDir, '.env'), 'EMAIL_ENCRYPTION_KEY=field-key-marker\n', { mode: 0o600 });
  fs.writeFileSync(path.join(home, 'cortex/ecosystem.config.cjs'), 'module.exports = {};\n');

  // The keypair: the node gets only the public half.
  const gnupg = path.join(home, 'restore-gnupg');
  fs.mkdirSync(gnupg, { mode: 0o700 });
  const g = (...a) => execFileSync('gpg', ['--homedir', gnupg, '--batch', '--quiet', '--passphrase', '', ...a], { stdio: ['ignore', 'pipe', 'pipe'] });
  g('--quick-gen-key', 'Test <t@example.test>', 'ed25519', 'sign', 'never');
  const fpr = execFileSync('gpg', ['--homedir', gnupg, '--list-keys', '--with-colons']).toString().match(/^fpr:+([0-9A-F]+):/m)[1];
  g('--quick-add-key', fpr, 'cv25519', 'encr', 'never');
  const pub = path.join(home, 'backup.pub.asc');
  fs.writeFileSync(pub, g('--armor', '--export', fpr));
  return { home, serverDir, gnupg, pub };
}

function writeConfig(home, port, pub, mode = 0o600) {
  const file = path.join(home, 'offsite.env');
  fs.writeFileSync(file, [
    `OFFSITE_S3_ENDPOINT=http://127.0.0.1:${port}`, 'OFFSITE_S3_REGION=us-east-005',
    'OFFSITE_S3_BUCKET=backups', 'OFFSITE_S3_ACCESS_KEY=id', 'OFFSITE_S3_SECRET_KEY=secret',
    `OFFSITE_RECIPIENT=${pub}`, 'OFFSITE_PREFIX=testnode', '',
  ].join('\n'));
  fs.chmodSync(file, mode);
  return file;
}

// Async: the fake S3 server answers on this process's event loop, which a
// spawnSync would block for the whole run.
const run = (env) => new Promise((resolve) => {
  const child = spawn('bash', [script], { env: { PATH: process.env.PATH, ...env } });
  let stdout = '', stderr = '';
  child.stdout.on('data', b => { stdout += b; });
  child.stderr.on('data', b => { stderr += b; });
  child.on('close', status => resolve({ status, stdout, stderr }));
});

test('the backup arrives encrypted, verified, and restorable with the off-box key', { skip, timeout: 60000 }, async () => {
  const t = setup();
  const s3 = await fakeS3();
  try {
    const r = await run({ HOME: t.home, SERVER_DIR: t.serverDir, OFFSITE_CONFIG: writeConfig(t.home, s3.port, t.pub), TMPDIR: t.home });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /verified\./);

    assert.equal(s3.objects.size, 1);
    const [[url, body]] = s3.objects;
    assert.match(url, /^\/backups\/testnode\/testnode-\d{8}-\d{6}\.tar\.zst\.gpg$/);
    assert.ok(!body.includes('field-key-marker'), 'the .env must not travel in clear');
    assert.ok(fs.existsSync(path.join(t.home, '.offsite-backup-last-ok')));

    const out = path.join(t.home, 'restored');
    fs.mkdirSync(out);
    const plain = execFileSync('gpg', ['--homedir', t.gnupg, '--batch', '--quiet', '--decrypt'], { input: body });
    execFileSync('sh', ['-c', `zstd -dq | tar -x -C "${out}"`], { input: plain });
    assert.equal(fs.readFileSync(path.join(out, 'server/.env'), 'utf8'), 'EMAIL_ENCRYPTION_KEY=field-key-marker\n');
    assert.ok(fs.existsSync(path.join(out, 'ecosystem.config.cjs')));
    const restored = new Database(path.join(out, 'server/data/farhold.db'), { readonly: true });
    assert.equal(restored.prepare('SELECT COUNT(*) c FROM users').get().c, 2);
    restored.close();

    const left = fs.readdirSync(t.home).filter(n => n.startsWith('cortex-offsite.'));
    assert.deepEqual(left, [], 'the plaintext work directory is removed');
  } finally {
    s3.server.close();
    fs.rmSync(t.home, { recursive: true, force: true });
  }
});

test('a config others can read is refused before anything is sent', { skip, timeout: 60000 }, async () => {
  const t = setup();
  const s3 = await fakeS3();
  try {
    const r = await run({ HOME: t.home, SERVER_DIR: t.serverDir, OFFSITE_CONFIG: writeConfig(t.home, s3.port, t.pub, 0o644), TMPDIR: t.home });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /readable by others/);
    assert.equal(s3.objects.size, 0);
  } finally {
    s3.server.close();
    fs.rmSync(t.home, { recursive: true, force: true });
  }
});

test('an upload the bucket does not confirm is a failure, and is not recorded as good', { skip, timeout: 60000 }, async () => {
  const t = setup();
  const s3 = await fakeS3({ lieAboutSize: true });
  try {
    const r = await run({ HOME: t.home, SERVER_DIR: t.serverDir, OFFSITE_CONFIG: writeConfig(t.home, s3.port, t.pub), TMPDIR: t.home });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /upload did not verify/);
    assert.ok(!fs.existsSync(path.join(t.home, '.offsite-backup-last-ok')));
  } finally {
    s3.server.close();
    fs.rmSync(t.home, { recursive: true, force: true });
  }
});

test('a database that is not a Cortex database is not sent', { skip, timeout: 60000 }, async () => {
  const t = setup();
  const s3 = await fakeS3();
  try {
    fs.rmSync(path.join(t.serverDir, 'data/farhold.db'));
    new Database(path.join(t.serverDir, 'data/farhold.db')).exec('CREATE TABLE other (x)');
    const r = await run({ HOME: t.home, SERVER_DIR: t.serverDir, OFFSITE_CONFIG: writeConfig(t.home, s3.port, t.pub), TMPDIR: t.home });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /did not verify/);
    assert.equal(s3.objects.size, 0);
  } finally {
    s3.server.close();
    fs.rmSync(t.home, { recursive: true, force: true });
  }
});
