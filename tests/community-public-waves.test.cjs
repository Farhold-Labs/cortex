'use strict';

// [SECURITY] v2.128.0 — a public wave inside a Community channel.
//
// `privacy` is read relative to its container (Communities plan §2b): a public
// wave filed in a channel means "visible to whoever may see that channel".
// Until v2.128.0 nothing read it that way. A private Community's public waves
// were listed to every account on the node, readable, searchable, pushed live
// to every open socket, and their files served to anyone; and reading or
// posting in one made the reader a participant, so participant rows cannot be
// what decides it afterwards.
//
// Run against a disposable server. The counterfactual runs the same scenario
// with the rule stripped out of a copy of the server and asserts the leak
// comes back, so the main test is known to fail for the right reason.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'PublicWaves123!';
const SECRET = 'zanzibarquokka';

async function startServer(temp, { stripFix = false } = {}) {
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

  if (stripFix) {
    // The rule, removed: "not applicable" for every wave, and no audience.
    const dbFile = path.join(serverDir, 'database-sqlite.js');
    let src = fs.readFileSync(dbFile, 'utf8');
    const a = '  channelPublicWaveVisible(wave, userId, memo = null) {\n';
    const b = '  channelPublicWaveAudience(waveId) {\n';
    assert.ok(src.includes(a) && src.includes(b), 'counterfactual: could not find the rule to strip');
    src = src.replace(a, a + '    return null;\n').replace(b, b + '    return null;\n');
    fs.writeFileSync(dbFile, src);
    const srvFile = path.join(serverDir, 'server.js');
    let s = fs.readFileSync(srvFile, 'utf8');
    const gate = "    const nodePublic = wave.privacy === 'public' && !wave.channelId;";
    assert.ok(s.includes(gate), 'counterfactual: could not find the attachment gate');
    s = s.replace(gate, "    const nodePublic = wave.privacy === 'public';");
    fs.writeFileSync(srvFile, s);
  }

  {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    seed.updateInstanceConfig({ features: { communities: true } });
    seed.db.close();
  }
  fs.appendFileSync(path.join(serverDir, 'server.js'),
    "\nserver.on('listening', () => console.log('PUBWAVE_PORT=' + server.address().port));\n");

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-public-waves-0000000000',
      SEED_DEMO_DATA: 'false',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 25000;
  while (!/PUBWAVE_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const port = output.match(/PUBWAVE_PORT=(\d+)/)[1];
  const base = `http://127.0.0.1:${port}`;

  const api = async (method, urlPath, { token, body } = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: json };
  };
  const makeUser = async (handle) => {
    await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
    const login = await api('POST', '/api/auth/login', { body: { handle, password } });
    assert.equal(login.status, 200, `login failed for ${handle}: ${JSON.stringify(login.body)}`);
    return { handle, token: login.body.token, id: login.body.user.id };
  };
  const upload = async (user, waveId) => {
    const form = new FormData();
    form.append('file', new Blob(['channel file'], { type: 'text/plain' }), 'notes.txt');
    form.append('waveId', waveId);
    const res = await fetch(`${base}/api/uploads/file`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}` }, body: form });
    const data = await res.json();
    assert.equal(res.status, 200, JSON.stringify(data));
    return data.url;
  };
  /** Collect every message an authenticated socket receives. */
  const listen = async (user) => {
    const { default: WebSocket } = await import(path.join(root, 'server/node_modules/ws/index.js'));
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const seen = [];
    await new Promise((resolve, reject) => {
      ws.on('error', reject);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: user.token })));
      ws.on('message', raw => {
        const m = JSON.parse(raw);
        seen.push(m);
        if (m.type === 'auth_success') resolve();
      });
    });
    return { seen, close: () => ws.close() };
  };

  return { child, base, api, makeUser, upload, listen };
}

/** One scenario, returning what an outsider could reach. */
async function scenario(srv) {
  const { api, makeUser, upload, listen, base } = srv;
  const admin = await makeUser('nodeadmin'); // first account: node admin
  const founder = await makeUser('founder');
  const member = await makeUser('member');
  const outsider = await makeUser('outsider');
  const leaver = await makeUser('leaver');

  const community = (await api('POST', '/api/communities', {
    token: founder.token, body: { name: 'Hidden', slug: 'hidden', visibility: 'private' },
  })).body.community;
  for (const handle of ['member', 'leaver']) {
    const r = await api('POST', `/api/communities/${community.id}/members`, { token: founder.token, body: { handle } });
    assert.ok(r.status < 300, `add ${handle}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const channel = (await api('POST', `/api/communities/${community.id}/channels`, {
    token: founder.token, body: { name: 'General', slug: 'general' },
  })).body.channel;
  assert.ok(channel?.id, 'channel created');

  const created = await api('POST', '/api/waves', {
    token: founder.token, body: { title: 'Channel announcements', privacy: 'public', channelId: channel.id },
  });
  assert.ok(created.status < 300, `create channel wave: ${created.status} ${JSON.stringify(created.body)}`);
  const wave = created.body.wave || created.body;
  const nodeWave = await api('POST', '/api/waves', { token: admin.token, body: { title: 'Node notices', privacy: 'public' } });
  const nodeWaveId = (nodeWave.body.wave || nodeWave.body).id;

  // The leaver reads (and so joins) while still a member, then is removed.
  assert.equal((await api('GET', `/api/waves/${wave.id}`, { token: leaver.token })).status, 200);
  await api('POST', `/api/waves/${wave.id}/read`, { token: leaver.token });
  const inside = await api('POST', '/api/pings', { token: leaver.token, body: { wave_id: wave.id, content: 'hello from inside' } });
  assert.ok(inside.status < 300, `leaver post: ${inside.status} ${JSON.stringify(inside.body)}`);
  const removed = await api('DELETE', `/api/communities/${community.id}/members/${leaver.id}`, { token: founder.token });
  assert.ok(removed.status < 300, `remove leaver: ${removed.status} ${JSON.stringify(removed.body)}`);

  const fileUrl = await upload(founder, wave.id);
  const outSock = await listen(outsider);
  const leaverSock = await listen(leaver);
  const memberSock = await listen(member);
  const post = await api('POST', '/api/pings', { token: founder.token, body: { wave_id: wave.id, content: `the word is ${SECRET} @leaver @everyone` } });
  assert.ok(post.status < 300, `founder post: ${post.status} ${JSON.stringify(post.body)}`);
  await new Promise(r => setTimeout(r, 600));
  outSock.close(); leaverSock.close(); memberSock.close();

  const listed = async (user) => ((await api('GET', '/api/waves', { token: user.token })).body || []).map(w => w.id);
  const searchHits = async (user) => ((await api('GET', `/api/search?q=${SECRET}`, { token: user.token })).body?.results || []).length;
  const heard = (sock) => sock.seen.some(m => JSON.stringify(m).includes(SECRET));
  const notified = async (user) => JSON.stringify((await api('GET', '/api/notifications', { token: user.token })).body || '').includes(SECRET);

  return {
    wave, nodeWaveId,
    outsider: {
      listed: (await listed(outsider)).includes(wave.id),
      read: (await api('GET', `/api/waves/${wave.id}`, { token: outsider.token })).status,
      pings: (await api('GET', `/api/waves/${wave.id}/pings`, { token: outsider.token })).status,
      search: await searchHits(outsider),
      heard: heard(outSock),
      post: (await api('POST', '/api/pings', { token: outsider.token, body: { wave_id: wave.id, content: 'can I?' } })).status,
      file: (await fetch(base + fileUrl)).status,
      nodeWaveListed: (await listed(outsider)).includes(nodeWaveId),
      nodeWaveRead: (await api('GET', `/api/waves/${nodeWaveId}`, { token: outsider.token })).status,
    },
    leaver: {
      listed: (await listed(leaver)).includes(wave.id),
      read: (await api('GET', `/api/waves/${wave.id}`, { token: leaver.token })).status,
      search: await searchHits(leaver),
      heard: heard(leaverSock),
      notified: await notified(leaver),
    },
    member: {
      listed: (await listed(member)).includes(wave.id),
      read: (await api('GET', `/api/waves/${wave.id}`, { token: member.token })).status,
      search: await searchHits(member),
      heard: heard(memberSock),
    },
  };
}

test('[SECURITY] a public wave in a private Community stays inside the Community', { timeout: 120000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-pubwave-'));
  let srv;
  try {
    srv = await startServer(temp);
    const r = await scenario(srv);

    await t.test('an outsider cannot list, read, search, hear, post in or fetch files from it', () => {
      assert.equal(r.outsider.listed, false, 'listed in the outsider\'s waves');
      assert.equal(r.outsider.read, 403);
      assert.equal(r.outsider.pings, 403);
      assert.equal(r.outsider.search, 0, 'its messages were searchable');
      assert.equal(r.outsider.heard, false, 'its messages were pushed to the outsider\'s socket');
      assert.equal(r.outsider.post, 403, 'posting would have auto-joined');
      assert.notEqual(r.outsider.file, 200, 'its file was served without a session');
    });

    await t.test('someone removed from the Community loses it, participant row or not', () => {
      assert.equal(r.leaver.listed, false);
      assert.equal(r.leaver.read, 403);
      assert.equal(r.leaver.search, 0);
      assert.equal(r.leaver.heard, false);
      assert.equal(r.leaver.notified, false, '@mention / @everyone reached someone outside');
    });

    await t.test('a member still has all of it', () => {
      assert.equal(r.member.listed, true);
      assert.equal(r.member.read, 200);
      assert.ok(r.member.search > 0);
      assert.equal(r.member.heard, true);
    });

    await t.test('a public wave outside any Community is public to the node, as before', () => {
      assert.equal(r.outsider.nodeWaveListed, true);
      assert.equal(r.outsider.nodeWaveRead, 200);
    });
  } finally {
    srv?.child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('[SECURITY] counterfactual: without the rule the leak comes back', { timeout: 120000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-pubwave-cf-'));
  let srv;
  try {
    srv = await startServer(temp, { stripFix: true });
    const r = await scenario(srv);
    assert.equal(r.outsider.listed, true, 'the stripped server should list it to an outsider');
    assert.equal(r.outsider.read, 200);
    assert.ok(r.outsider.search > 0);
    assert.equal(r.outsider.heard, true);
    assert.equal(r.outsider.file, 200);
    assert.equal(r.leaver.read, 200, 'and the participant row would keep a removed member in');
  } finally {
    srv?.child.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
