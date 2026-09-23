'use strict';

// Private attachments (v2.104.0, CORTEX-COMM-009).
//
// Before this, anything under /uploads was served to anyone who asked. A URL
// lifted out of a private wave — forwarded, pasted, or scraped out of a
// browser cache — kept working forever, for everyone, with no session at all.
//
// The fix is a per-request check: a file the server knows belongs to a wave is
// served only to people who can read that wave. These tests exercise it over
// real HTTP against a disposable server, because the interesting parts (the
// multipart field that names the wave, the cookie an <img> can actually send)
// only exist at the transport level.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const password = 'Review123!';
const jwtSecret = 'isolated-attachment-test-signing-key';

/** Stand up a throwaway Cortex with three users, a private wave and a public one. */
async function startServer(temp, { disableGate = false } = {}) {
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
    // The counterfactual: the same server with the access check removed, to
    // show these tests fail without it rather than passing for some unrelated
    // reason (a 404 from a missing file would look just like a refusal).
    const gate = source.match(/\n    if \(attachment && attachment\.wave_id\) \{[\s\S]*?\n    \}\n/);
    assert.ok(gate, 'could not find the attachment gate to disable');
    source = source.replace(gate[0], '\n');
  }
  source += "\nserver.on('listening', () => console.log('ATTACH_TEST_PORT=' + server.address().port));\n";
  fs.writeFileSync(path.join(serverDir, 'server.js'), source);

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: jwtSecret, FEDERATION_ENABLED: 'false',
      SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });

  const deadline = Date.now() + 20000;
  while (!/ATTACH_TEST_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error('startup failed: ' + output.slice(-4000));
    }
    await new Promise(r => setTimeout(r, 50));
  }
  const base = `http://127.0.0.1:${output.match(/ATTACH_TEST_PORT=(\d+)/)[1]}`;

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

  /** The cookie an <img> tag would be carrying for this user. */
  const cookieFor = async (user) => {
    const res = await fetch(`${base}/api/attachments/session`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}` },
    });
    assert.equal(res.status, 200);
    const setCookie = res.headers.getSetCookie?.()[0] || res.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i, 'the attachment cookie must be unreadable from script');
    assert.match(setCookie, /SameSite=Strict/i);
    assert.match(setCookie, /Path=\/uploads/i, 'scope the cookie to the files it unlocks');
    return setCookie.split(';')[0];
  };

  const upload = async (user, { waveId, name = 'note.txt', body = 'attachment body' } = {}) => {
    const form = new FormData();
    form.append('file', new Blob([body], { type: 'text/plain' }), name);
    if (waveId) form.append('waveId', waveId);
    const res = await fetch(`${base}/api/uploads/file`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokens[user]}` }, body: form,
    });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    return data.url;
  };

  const get = (url, cookie) => fetch(base + url, cookie ? { headers: { Cookie: cookie } } : undefined);

  return { base, child, serverDir, tokens, privateWave, publicWave, cookieFor, upload, get };
}

test('attachments in a private wave are readable only by that wave', { timeout: 90000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-attach-'));
  let srv;
  try {
    srv = await startServer(temp);
    const { privateWave, publicWave, tokens, cookieFor, upload, get, base } = srv;

    const privateUrl = await upload('owner', { waveId: privateWave.id, name: 'secret.txt' });
    const publicUrl = await upload('owner', { waveId: publicWave.id, name: 'open.txt' });
    const looseUrl = await upload('owner', { name: 'avatar.txt' });

    await t.test('a forwarded URL is worth nothing on its own', async () => {
      const res = await get(privateUrl);
      assert.equal(res.status, 401, 'no session, no file');
    });

    await t.test('a signed-in stranger still cannot read it', async () => {
      const res = await get(privateUrl, await cookieFor('outsider'));
      // 404, not 403: a refusal that confirms the file exists has already told
      // the holder of a leaked URL most of what they wanted.
      assert.equal(res.status, 404);
    });

    await t.test('the people in the wave read it normally', async () => {
      for (const user of ['owner', 'member']) {
        const res = await get(privateUrl, await cookieFor(user));
        assert.equal(res.status, 200, `${user} was locked out of their own wave`);
        assert.equal(await res.text(), 'attachment body');
      }
    });

    await t.test('a public wave stays public, session or not', async () => {
      // The portal renders published waves to visitors who have no account.
      // Gating their images would break those pages to protect content that
      // was deliberately published.
      assert.equal((await get(publicUrl)).status, 200);
      assert.equal((await get(publicUrl, await cookieFor('outsider'))).status, 200);
    });

    await t.test('files belonging to no conversation are untouched', async () => {
      // Avatars, profile media, and every upload that predates the attachments
      // table. Withdrawing these would break images in old conversations to
      // close a gap on URLs that have already travelled.
      assert.equal((await get(looseUrl)).status, 200);
    });

    await t.test('an expired or forged cookie is not a session', async () => {
      const jwt = serverRequire('jsonwebtoken');
      const stale = jwt.sign({ userId: 'member', purpose: 'attachment' }, jwtSecret, { expiresIn: -60 });
      const wrongPurpose = jwt.sign({ userId: 'member', purpose: 'access' }, jwtSecret, { expiresIn: 900 });
      const wrongKey = jwt.sign({ userId: 'member', purpose: 'attachment' }, 'not-the-secret', { expiresIn: 900 });
      for (const value of [stale, wrongPurpose, wrongKey, 'garbage']) {
        assert.equal((await get(privateUrl, `cortex_att=${value}`)).status, 401);
      }
    });

    await t.test('only the uploader may say where a file belongs', async () => {
      const orphan = await upload('outsider', { name: 'theirs.txt' });
      const bind = (user, body) => fetch(`${base}/api/attachments/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[user]}` },
        body: JSON.stringify(body),
      });

      // The denial-of-service shape: claim someone else's public file into a
      // wave they are not in, and it disappears for them.
      assert.equal((await bind('owner', { path: orphan, waveId: privateWave.id })).status, 403);
      assert.equal((await get(orphan)).status, 200, 'the refused claim must not have stuck');

      assert.equal((await bind('owner', { path: '/uploads/files/nothing.txt', waveId: privateWave.id })).status, 404);
      assert.equal((await bind('owner', { path: '/uploads/../../etc/passwd', waveId: privateWave.id })).status, 400);
      assert.equal((await bind('outsider', { path: orphan, waveId: privateWave.id })).status, 403,
        'uploading a file does not grant a way into a wave');
    });

    await t.test('the client can file its own attachment after the fact', async () => {
      // The encrypted case: the server never sees the message, so the client
      // has to say which wave the file went to.
      const later = await upload('owner', { name: 'after.txt' });
      assert.equal((await get(later)).status, 200, 'unbound until filed');

      const res = await fetch(`${base}/api/attachments/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.owner}` },
        body: JSON.stringify({ path: later, waveId: privateWave.id }),
      });
      assert.equal(res.status, 200, await res.text());

      assert.equal((await get(later)).status, 401, 'filing it must actually restrict it');
      assert.equal((await get(later, await cookieFor('outsider'))).status, 404);
      assert.equal((await get(later, await cookieFor('member'))).status, 200,
        'the rest of the wave must still be able to read it');

      const second = await fetch(`${base}/api/attachments/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.owner}` },
        body: JSON.stringify({ path: later, waveId: publicWave.id }),
      });
      // The uploader is in both waves, so this is refused for being a second
      // home rather than for being out of reach.
      assert.equal(second.status, 409, 'a file cannot be re-homed into a second wave');
    });

    await t.test('an upload naming a wave the uploader is not in is left public, not stolen', async () => {
      const url = await upload('outsider', { waveId: privateWave.id, name: 'gatecrash.txt' });
      assert.equal((await get(url)).status, 200);
      assert.equal((await get(url, await cookieFor('outsider'))).status, 200);
    });
  } finally {
    if (srv?.child) srv.child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('without the gate the same request succeeds — the check is what refuses it', { timeout: 90000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-attach-nogate-'));
  let srv;
  try {
    srv = await startServer(temp, { disableGate: true });
    const url = await srv.upload('owner', { waveId: srv.privateWave.id, name: 'secret.txt' });
    const res = await srv.get(url);
    assert.equal(res.status, 200, 'expected the unpatched server to leak');
    assert.equal(await res.text(), 'attachment body');
  } finally {
    if (srv?.child) srv.child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
