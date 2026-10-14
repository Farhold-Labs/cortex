'use strict';

// Uploads in S3-compatible storage, served through Cortex (v2.117.0).
//
// S3 mode used to hand out the bucket's own links. With a private bucket those
// links simply failed; with a public one they worked for anyone, skipping the
// wave check that /uploads applies (v2.104.0) — so a node could not move its
// files to Backblaze B2 without either breaking them or publishing them.
//
// Now every URL is a Cortex URL. A file not on disk is fetched from the bucket
// by Cortex, after the same check. These tests run a real Cortex against a
// small in-process S3 (path style, as B2 and MinIO speak it).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const password = 'Review123!';
const BUCKET = 'cortex-test';

/** Undo the SDK's aws-chunked framing (`size\r\ndata\r\n … 0\r\ntrailers`), when it is used. */
function decodeBody(req, raw) {
  if (!/aws-chunked/.test(req.headers['content-encoding'] || '') && !/STREAMING/.test(req.headers['x-amz-content-sha256'] || '')) return raw;
  const parts = [];
  let i = 0;
  while (i < raw.length) {
    const eol = raw.indexOf('\r\n', i);
    const size = parseInt(raw.subarray(i, eol).toString().split(';')[0], 16);
    if (!size) break;
    parts.push(raw.subarray(eol + 2, eol + 2 + size));
    i = eol + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

/**
 * A minimal private bucket: PUT, GET (with Range and If-None-Match), HEAD,
 * DELETE — versioned the way B2 is, so a plain DELETE only hides the file.
 */
function fakeS3() {
  const objects = new Map(); // '/bucket/key' -> { body, etag } — the visible version
  const versions = new Map(); // '/bucket/key' -> [{ id, marker }] — everything stored
  let nextVersion = 1;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const key = decodeURIComponent(url.pathname);
      // Every request is signed by the SDK. An unsigned one is a browser
      // following a bucket link, which a private bucket refuses.
      if (!/^AWS4-HMAC-SHA256 /.test(req.headers.authorization || '') && !/X-Amz-Signature=/.test(req.url)) {
        res.writeHead(401); return res.end();
      }
      if (req.method === 'PUT') {
        const body = decodeBody(req, Buffer.concat(chunks));
        const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`;
        objects.set(key, { body, etag });
        versions.set(key, [...(versions.get(key) || []), { id: `v${nextVersion++}`, marker: false }]);
        res.writeHead(200, { ETag: etag }); return res.end();
      }
      if (req.method === 'DELETE') {
        const versionId = url.searchParams.get('versionId');
        if (versionId) {
          versions.set(key, (versions.get(key) || []).filter(v => v.id !== versionId));
          if (!versions.get(key).length) versions.delete(key);
        } else {
          versions.set(key, [...(versions.get(key) || []), { id: `v${nextVersion++}`, marker: true }]);
        }
        objects.delete(key);
        res.writeHead(204); return res.end();
      }
      if (req.method === 'GET' && url.searchParams.has('versions')) {
        const prefix = `${key.replace(/\/$/, '')}/${url.searchParams.get('prefix') || ''}`;
        const items = [...versions].filter(([k]) => k.startsWith(prefix)).flatMap(([k, vs]) => vs.map(v => {
          const name = k.slice(key.replace(/\/$/, '').length + 1);
          return v.marker
            ? `<DeleteMarker><Key>${name}</Key><VersionId>${v.id}</VersionId><IsLatest>false</IsLatest></DeleteMarker>`
            : `<Version><Key>${name}</Key><VersionId>${v.id}</VersionId><IsLatest>false</IsLatest><Size>1</Size></Version>`;
        }));
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(`<?xml version="1.0" encoding="UTF-8"?><ListVersionsResult><Name>${BUCKET}</Name><IsTruncated>false</IsTruncated>${items.join('')}</ListVersionsResult>`);
      }
      const obj = objects.get(key);
      if (!obj) {
        res.writeHead(404, { 'Content-Type': 'application/xml' });
        return res.end(req.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>');
      }
      if (req.headers['if-none-match'] === obj.etag) { res.writeHead(304, { ETag: obj.etag }); return res.end(); }
      const headers = { 'Content-Type': 'text/html', ETag: obj.etag, 'Last-Modified': new Date(0).toUTCString() };
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (m) {
        const start = +m[1], end = m[2] ? Math.min(+m[2], obj.body.length - 1) : obj.body.length - 1;
        res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${obj.body.length}` });
        return res.end(req.method === 'HEAD' ? undefined : obj.body.subarray(start, end + 1));
      }
      res.writeHead(200, { ...headers, 'Content-Length': obj.body.length });
      res.end(req.method === 'HEAD' ? undefined : obj.body);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, objects, versions, url: `http://127.0.0.1:${server.address().port}` })));
}

async function startServer(temp, s3, { disableGate = false } = {}) {
  const serverDir = path.join(temp, 'server');
  fs.mkdirSync(serverDir, { recursive: true });
  for (const name of fs.readdirSync(path.join(root, 'server'))) {
    if (/\.(js|sql)$/.test(name) || name === 'package.json') {
      fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
    }
  }
  fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
  fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(serverDir, 'data'));

  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const db = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
  const hash = serverRequire('bcryptjs').hashSync(password, 4);
  for (const id of ['owner', 'member', 'outsider']) {
    db.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: hash, displayName: id });
  }
  const privateWave = db.createWave({ title: 'Private', createdBy: 'owner', participants: ['member'], privacy: 'private' });
  const publicWave = db.createWave({ title: 'Public', createdBy: 'owner', privacy: 'public' });
  db.db.close();

  let source = fs.readFileSync(path.join(serverDir, 'server.js'), 'utf8');
  if (disableGate) {
    const gate = source.match(/\n  if \(attachment && attachment\.wave_id\) \{[\s\S]*?\n  \}\n/);
    assert.ok(gate, 'could not find the attachment gate to disable');
    source = source.replace(gate[0], '\n');
  }
  source += "\nserver.on('listening', () => console.log('S3_TEST_PORT=' + server.address().port));\n";
  fs.writeFileSync(path.join(serverDir, 'server.js'), source);

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'isolated-s3-test-signing-key', FEDERATION_ENABLED: 'false',
      SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
      STORAGE_PROVIDER: 's3', S3_ENDPOINT: s3.url, S3_REGION: 'us-test-1', S3_BUCKET: BUCKET,
      S3_ACCESS_KEY: 'testaccess', S3_SECRET_KEY: 'testsecret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });

  const deadline = Date.now() + 20000;
  while (!/S3_TEST_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error('startup failed: ' + output.slice(-4000));
    }
    await new Promise(r => setTimeout(r, 50));
  }
  const base = `http://127.0.0.1:${output.match(/S3_TEST_PORT=(\d+)/)[1]}`;

  const tokens = {};
  for (const user of ['owner', 'member', 'outsider']) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: user, password }),
    });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    tokens[user] = data.token;
  }
  const cookieFor = async (user) => {
    const res = await fetch(`${base}/api/attachments/session`, { method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}` } });
    assert.equal(res.status, 200);
    return (res.headers.getSetCookie?.()[0] || res.headers.get('set-cookie')).split(';')[0];
  };
  const upload = async (user, { waveId, name, body, type = 'text/plain' }) => {
    const form = new FormData();
    form.append('file', new Blob([body], { type }), name);
    if (waveId) form.append('waveId', waveId);
    const res = await fetch(`${base}/api/uploads/file`, { method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}` }, body: form });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    return data.url;
  };
  const get = (url, headers = {}) => fetch(base + url, { headers });
  return { base, child, serverDir, tokens, privateWave, publicWave, cookieFor, upload, get };
}

async function withServer(options, fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-s3-'));
  const s3 = await fakeS3();
  let srv;
  try {
    srv = await startServer(temp, s3, options);
    await fn(srv, s3);
  } finally {
    srv?.child.kill('SIGKILL');
    s3.server.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const PICTURE = crypto.randomBytes(2048);

test('S3 uploads are served through Cortex, behind the wave check', { timeout: 90000 }, async (t) => {
  await withServer({}, async (srv, s3) => {
    const { privateWave, publicWave, cookieFor, upload, get, serverDir } = srv;
    const url = await upload('owner', { waveId: privateWave.id, name: 'photo.png', body: PICTURE, type: 'image/png' });
    const key = url.replace(/^\/uploads\//, '');

    await t.test('the URL is a Cortex URL, and the file is in the bucket, not on disk', () => {
      assert.match(url, /^\/uploads\/files\/owner-\d+-photo\.png$/);
      assert.ok(s3.objects.has(`/${BUCKET}/${key}`), 'stored in the bucket');
      assert.ok(!fs.existsSync(path.join(serverDir, 'uploads', key)), 'not on local disk');
    });

    await t.test('a member gets the file, with an image type decided by Cortex', async () => {
      const res = await get(url, { Cookie: await cookieFor('member') });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png', 'not the type the bucket reports');
      assert.match(res.headers.get('cache-control'), /private/);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), PICTURE);
    });

    await t.test('an outsider is refused, and no session asks who is looking', async () => {
      assert.equal((await get(url, { Cookie: await cookieFor('outsider') })).status, 404);
      assert.equal((await get(url)).status, 401);
    });

    await t.test('players can seek, and caches revalidate', async () => {
      const cookie = await cookieFor('member');
      const part = await get(url, { Cookie: cookie, Range: 'bytes=10-19' });
      assert.equal(part.status, 206);
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), PICTURE.subarray(10, 20));
      const etag = (await get(url, { Cookie: cookie })).headers.get('etag');
      assert.ok(etag);
      assert.equal((await get(url, { Cookie: cookie, 'If-None-Match': etag })).status, 304);
    });

    await t.test('an HTML upload is never served as HTML', async () => {
      const html = await upload('owner', { waveId: publicWave.id, name: 'page.html', body: '<script>alert(1)</script>', type: 'text/html' });
      const res = await get(html);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/octet-stream');
      assert.equal(res.headers.get('content-disposition'), 'attachment');
      assert.match(res.headers.get('content-security-policy'), /sandbox/);
    });

    await t.test('a public wave\'s file needs no session', async () => {
      const pub = await upload('owner', { waveId: publicWave.id, name: 'pub.png', body: PICTURE, type: 'image/png' });
      assert.equal((await get(pub)).status, 200);
    });

    await t.test('a file stored before the switch to S3 is still served from disk', async () => {
      fs.mkdirSync(path.join(serverDir, 'uploads/files'), { recursive: true });
      fs.writeFileSync(path.join(serverDir, 'uploads/files/owner-1-old.png'), PICTURE);
      const res = await get('/uploads/files/owner-1-old.png');
      assert.equal(res.status, 200);
      assert.deepEqual(Buffer.from(await res.arrayBuffer()), PICTURE);
    });

    await t.test('a path the bucket does not have is a 404, and traversal is refused', async () => {
      assert.equal((await get('/uploads/files/nobody-1-missing.png')).status, 404);
      assert.equal((await get('/uploads/files/%2e%2e/%2e%2e/data/farhold.db')).status, 404);
      // Encoded slashes survive URL parsing and reach the handler as '..' segments.
      const sneaky = await get('/uploads/files/..%2f..%2fdata%2ffarhold.db');
      assert.ok([400, 404].includes(sneaky.status), `got ${sneaky.status}`);
      assert.ok(!(await sneaky.text()).includes('SQLite format'), 'never the database');
    });

    await t.test('a voice message plays from the bucket for members only', async () => {
      const form = new FormData();
      form.append('media', new Blob(['opus-ish'], { type: 'audio/webm' }), 'recording.webm');
      form.append('waveId', privateWave.id);
      const up = await fetch(`${srv.base}/api/uploads/media`, { method: 'POST', headers: { Authorization: `Bearer ${srv.tokens.owner}` }, body: form });
      const { url: media } = await up.json();
      assert.match(media, /^\/api\/media\/owner-\d+\.webm$/);
      assert.ok(s3.objects.has(`/${BUCKET}/media/${media.split('/').pop()}`));
      const play = (u) => get(media, { Authorization: `Bearer ${srv.tokens[u]}` });
      const ok = await play('member');
      assert.equal(ok.status, 200);
      assert.equal(await ok.text(), 'opus-ish');
      assert.equal((await play('outsider')).status, 404);
    });
  });
});

test('without the wave check, the same S3 file reaches an outsider — the check is what refuses it', { timeout: 90000 }, async () => {
  await withServer({ disableGate: true }, async ({ privateWave, cookieFor, upload, get }) => {
    const url = await upload('owner', { waveId: privateWave.id, name: 'photo.png', body: PICTURE, type: 'image/png' });
    assert.equal((await get(url, { Cookie: await cookieFor('outsider') })).status, 200);
  });
});

/**
 * Put a hook in front of the fake bucket. Return true from it to take the
 * request over — answer it yourself, or call `pass()` later to hand it on.
 */
function intercept(s3, hook) {
  const handler = s3.server.listeners('request')[0];
  s3.server.removeAllListeners('request');
  s3.server.on('request', (req, res) => { if (!hook(req, res, () => handler(req, res))) handler(req, res); });
}

const waitFor = async (cond, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  return cond();
};

test('a wave deleted while a sweep is running still has its files removed', { timeout: 90000 }, async () => {
  await withServer({}, async ({ privateWave, publicWave, upload, base, tokens }, s3) => {
    const a = await upload('owner', { waveId: privateWave.id, name: 'a.png', body: PICTURE, type: 'image/png' });
    const b = await upload('owner', { waveId: publicWave.id, name: 'b.png', body: PICTURE, type: 'image/png' });
    const inBucket = (u) => s3.objects.has(`/${BUCKET}/${u.replace(/^\/uploads\//, '')}`);

    // a's delete is slow, so the first sweep is still running when the second wave goes.
    intercept(s3, (req, res, pass) => {
      if (req.method !== 'DELETE' || !req.url.includes('a.png')) return false;
      setTimeout(pass, 800);
      return true;
    });
    const del = (id) => fetch(`${base}/api/waves/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokens.owner}` } });
    assert.equal((await del(privateWave.id)).status, 200);
    assert.equal((await del(publicWave.id)).status, 200);
    assert.ok(await waitFor(() => !inBucket(a) && !inBucket(b)),
      `both removed (a: ${inBucket(a) ? 'still there' : 'gone'}, b: ${inBucket(b) ? 'still there' : 'gone'})`);
    // Removed, not hidden: no version of either file is left in the bucket.
    assert.ok(await waitFor(() => s3.versions.size === 0), `versions left: ${JSON.stringify([...s3.versions])}`);
  });
});

test('a delete the bucket refuses is retried by the next sweep, not marked done', { timeout: 90000 }, async () => {
  await withServer({}, async ({ privateWave, publicWave, upload, base, tokens }, s3) => {
    const b = await upload('owner', { waveId: publicWave.id, name: 'b.png', body: PICTURE, type: 'image/png' });
    const inBucket = (u) => s3.objects.has(`/${BUCKET}/${u.replace(/^\/uploads\//, '')}`);

    // Refuse every delete of b — more than the SDK's own retries — until told otherwise.
    let refusing = true, refused = 0;
    intercept(s3, (req, res) => {
      if (refusing && req.method === 'DELETE' && req.url.includes('b.png')) { refused++; res.writeHead(500); res.end(); return true; }
      return false;
    });
    const del = (id) => fetch(`${base}/api/waves/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${tokens.owner}` } });
    assert.equal((await del(publicWave.id)).status, 200);
    assert.ok(await waitFor(() => refused > 0), 'the sweep tried');
    await new Promise(r => setTimeout(r, 1500)); // let the SDK's retries finish
    assert.ok(inBucket(b));

    // The bucket recovers; the next sweep (another wave deleted) must try b again.
    refusing = false;
    assert.equal((await del(privateWave.id)).status, 200);
    assert.ok(await waitFor(() => !inBucket(b)), 'retried and removed');
  });
});
