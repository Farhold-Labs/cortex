'use strict';

// Recorded voice and video messages (v2.116.2).
//
// Recordings are served from /api/media, which checked only that the caller
// was signed in — not that they could read the wave the recording was posted
// to. And the video upload never recorded which wave its file belonged to at
// all, so even the /uploads gate (v2.104.0) treated it as a public legacy file.
// Any account on a node could play a private wave's video messages.
//
// Each test has a counterfactual: the same scenario against a copy of the
// server with the fix removed, asserting the leak comes back. A refusal that
// came from a missing file or a bad filename would otherwise look identical.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const password = 'Review123!';
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

/**
 * A throwaway Cortex with three users and a private wave.
 *
 * `seed(db, uploadsDir, ids)` runs against the database before the server first
 * boots — that is where recordings from before the fix are planted, so the
 * start-up repair is what has to find them.
 */
async function startServer(temp, { ungateMedia = false, unbindVideo = false, noRepair = false, seed } = {}) {
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
  const mediaDir = path.join(serverDir, 'uploads/media');
  fs.mkdirSync(mediaDir, { recursive: true });

  let dbSource = fs.readFileSync(path.join(serverDir, 'database-sqlite.js'), 'utf8');
  if (noRepair) {
    const repair = '    if (hasMediaUrl && ';
    assert.ok(dbSource.includes(repair), 'could not find the recording repair to disable');
    dbSource = dbSource.replace(repair, '    if (false && hasMediaUrl && ');
    fs.writeFileSync(path.join(serverDir, 'database-sqlite.js'), dbSource);
  }

  const { DatabaseSQLite } = await import(path.join(serverDir, 'database-sqlite.js'));
  const db = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
  const hash = serverRequire('bcryptjs').hashSync(password, 4);
  for (const id of ['owner', 'member', 'outsider']) {
    db.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: hash, displayName: id });
  }
  const privateWave = db.createWave({ title: 'Private', createdBy: 'owner', participants: ['member'], privacy: 'private' });
  if (seed) seed(db, mediaDir, { privateWave });
  db.db.close();

  let source = fs.readFileSync(path.join(serverDir, 'server.js'), 'utf8');
  if (ungateMedia) {
    const gate = "    const refusal = attachmentRefusal(`media/${filename}`, () => req.user.userId);\n    if (refusal) return res.status(refusal[0]).json(refusal[1]);\n";
    assert.ok(source.includes(gate), 'could not find the /api/media gate to disable');
    source = source.replace(gate, '');
  }
  if (unbindVideo) {
    const bind = '      await bindUploadToWave(storageKey, req.body?.waveId, user.id);\n';
    assert.ok(source.includes(bind), 'could not find the video binding to disable');
    source = source.replace(bind, '');
  }
  source += "\nserver.on('listening', () => console.log('MEDIA_TEST_PORT=' + server.address().port));\n";
  fs.writeFileSync(path.join(serverDir, 'server.js'), source);

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'isolated-media-test-signing-key', FEDERATION_ENABLED: 'false',
      SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });

  const deadline = Date.now() + 20000;
  while (!/MEDIA_TEST_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error('startup failed: ' + output.slice(-4000));
    }
    await new Promise(r => setTimeout(r, 50));
  }
  const base = `http://127.0.0.1:${output.match(/MEDIA_TEST_PORT=(\d+)/)[1]}`;

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

  /** Record a message the way WaveView does: multipart 'media', naming the wave. */
  const uploadMedia = async (user, { waveId, type, body, name }) => {
    const form = new FormData();
    form.append('media', new Blob([body], { type }), name);
    if (waveId) form.append('waveId', waveId);
    form.append('duration', '1000');
    const res = await fetch(`${base}/api/uploads/media`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}` }, body: form,
    });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    return data.url;
  };

  /** Play it as `user` would: /api/media takes the session token. */
  const play = (url, user) => fetch(base + url, { headers: { Authorization: `Bearer ${tokens[user]}` } });

  return { base, child, tokens, privateWave, uploadMedia, play, output: () => output };
}

async function withServer(options, fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-media-'));
  let srv;
  try {
    srv = await startServer(temp, options);
    await fn(srv);
  } finally {
    srv?.child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const voice = { type: 'audio/webm', body: 'not really opus, but stored as given', name: 'recording.webm' };

test('a private wave\'s voice message plays for its members only', { timeout: 90000 }, async () => {
  await withServer({}, async ({ privateWave, uploadMedia, play }) => {
    const url = await uploadMedia('owner', { ...voice, waveId: privateWave.id });
    assert.match(url, /^\/api\/media\//);
    assert.equal((await play(url, 'owner')).status, 200);
    assert.equal((await play(url, 'member')).status, 200);
    assert.equal((await play(url, 'outsider')).status, 404, 'an account outside the wave is refused');
  });
});

test('without the /api/media check, any account plays it — the check is what refuses it', { timeout: 90000 }, async () => {
  await withServer({ ungateMedia: true }, async ({ privateWave, uploadMedia, play }) => {
    const url = await uploadMedia('owner', { ...voice, waveId: privateWave.id });
    assert.equal((await play(url, 'outsider')).status, 200);
  });
});

/** A one-second WebM, as a phone's recorder would produce. */
function makeWebm(dir) {
  const file = path.join(dir, 'clip.webm');
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10',
    '-t', '1', '-c:v', 'libvpx', '-y', file]);
  assert.equal(r.status, 0, String(r.stderr));
  return fs.readFileSync(file);
}

test('a private wave\'s video message is bound to the wave and gated', { timeout: 120000, skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const clip = makeWebm(fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-clip-')));
  await withServer({}, async ({ base, privateWave, uploadMedia, play }) => {
    const url = await uploadMedia('owner', { type: 'video/webm', body: clip, name: 'recording.webm', waveId: privateWave.id });
    assert.match(url, /^\/api\/media\/.+\.mp4$/);
    assert.equal((await play(url, 'member')).status, 200);
    assert.equal((await play(url, 'outsider')).status, 404);
    // The same file is also reachable under /uploads; with no binding it was public there too.
    const direct = await fetch(base + url.replace('/api/media/', '/uploads/media/'));
    assert.equal(direct.status, 401, 'the /uploads copy asks who is looking');
  });
});

test('without the binding, the same video is public under /uploads — the binding is what protects it', { timeout: 120000, skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const clip = makeWebm(fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-clip-')));
  await withServer({ unbindVideo: true }, async ({ base, privateWave, uploadMedia, play }) => {
    const url = await uploadMedia('owner', { type: 'video/webm', body: clip, name: 'recording.webm', waveId: privateWave.id });
    assert.equal((await play(url, 'outsider')).status, 200);
    assert.equal((await fetch(base + url.replace('/api/media/', '/uploads/media/'))).status, 200);
  });
});

test('a profile video names no wave and stays public', { timeout: 120000, skip: !hasFfmpeg && 'ffmpeg is not installed' }, async () => {
  const clip = makeWebm(fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-clip-')));
  await withServer({}, async ({ uploadMedia, play }) => {
    const url = await uploadMedia('owner', { type: 'video/webm', body: clip, name: 'profile.webm' });
    assert.equal((await play(url, 'outsider')).status, 200);
  });
});

/** Recordings posted before the fix: a ping pointing at a file with no attachments row. */
function seedOldRecordings(db, mediaDir, { privateWave }) {
  for (const [file, author, mediaType] of [
    ['owner-1700000000000.mp4', 'owner', 'video'],
    ['owner-1700000000001.webm', 'owner', 'audio'],
    // Someone else's file quoted in a ping: binding it into this wave would
    // hide it from everyone else, so the repair must leave it alone.
    ['outsider-1700000000002.mp4', 'member', 'video'],
  ]) {
    fs.writeFileSync(path.join(mediaDir, file), 'recorded before v2.116.2');
    db.createPing({ waveId: privateWave.id, authorId: author, content: '', mediaType, mediaUrl: `/api/media/${file}` });
  }
}

test('recordings from before the fix are bound to their waves at start-up', { timeout: 90000 }, async () => {
  await withServer({ seed: seedOldRecordings }, async ({ play, output }) => {
    assert.equal((await play('/api/media/owner-1700000000000.mp4', 'member')).status, 200);
    assert.equal((await play('/api/media/owner-1700000000000.mp4', 'outsider')).status, 404);
    assert.equal((await play('/api/media/owner-1700000000001.webm', 'outsider')).status, 404);
    assert.equal((await play('/api/media/outsider-1700000000002.mp4', 'outsider')).status, 200,
      'a file not named for the ping\'s author is not bound to that wave');
    assert.match(output(), /Bound 2 recorded message file\(s\)/);
  });
});

test('without the repair, those recordings stay open to every account', { timeout: 90000 }, async () => {
  await withServer({ seed: seedOldRecordings, noRepair: true }, async ({ play }) => {
    assert.equal((await play('/api/media/owner-1700000000000.mp4', 'outsider')).status, 200);
  });
});
