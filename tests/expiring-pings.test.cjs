'use strict';

// Expiring pings (v2.122.0).
//
// A ping can be sent with a timer, and a wave can have one that every new
// ping gets. The wave's timer is a ceiling: a sender may choose less, never
// more and never none. When the time comes the ping is erased — content,
// reactions, read receipts, history, the notifications that quoted it and
// the files it carried — leaving a placeholder so replies keep their parent.
//
// The parts that matter for privacy each get their own assertion: nothing is
// readable between the expiry and the sweep, the files really go, a federated
// copy cannot be revived, and naming someone else's upload does not get it
// erased (with a counterfactual for that last one).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));

// A copy of the server directory, so a test can edit its source.
function copyServer(temp, edit) {
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
  if (edit) edit(serverDir);
  return serverDir;
}

async function openDb(serverDir) {
  const { DatabaseSQLite } = await import(path.join(serverDir, 'database-sqlite.js'));
  return new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
}

function seedTwoUsers(db) {
  const now = new Date().toISOString();
  for (const id of ['user-a', 'user-b']) {
    db.db.prepare(`INSERT INTO users (id, handle, email, password_hash, display_name, avatar, created_at)
      VALUES (?, ?, ?, 'x', ?, '?', ?)`).run(id, id, `${id}@example.test`, id, now);
  }
  db.db.prepare(`INSERT INTO waves (id, title, privacy, created_by, created_at, updated_at)
    VALUES ('wave-1', 'W', 'private', 'user-a', ?, ?)`).run(now, now);
}

const past = (ms = 1000) => new Date(Date.now() - ms).toISOString();
const future = (ms = 3600_000) => new Date(Date.now() + ms).toISOString();

test('an expired ping reads as gone before the sweep reaches it', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-expiry-unit-'));
  try {
    const db = await openDb(copyServer(temp));
    seedTwoUsers(db);
    const lapsed = db.createPing({ waveId: 'wave-1', authorId: 'user-a', content: 'secret words', expiresAt: past() });
    const live = db.createPing({ waveId: 'wave-1', authorId: 'user-a', content: 'still here', expiresAt: future() });
    db.db.prepare(`UPDATE pings SET reactions = '{"👍":["user-b"]}', pinned_at = ? WHERE id = ?`).run(new Date().toISOString(), lapsed.id);

    for (const pings of [db.getPingsForWave('wave-1', 'user-b'), db.getPingsForWaveMinimal('wave-1', 'user-b')]) {
      const gone = pings.find(p => p.id === lapsed.id);
      assert.equal(gone.content, '', 'no content in the gap before the sweep');
      assert.equal(gone.expired, true);
      assert.equal(gone.deleted, true);
      assert.ok(!gone.reactions || Object.keys(gone.reactions).length === 0);
      assert.equal(pings.find(p => p.id === live.id).content.includes('still here'), true);
      assert.equal(pings.find(p => p.id === live.id).expiresAt, live.expiresAt);
    }
    assert.equal(db.getPing(lapsed.id).content, '');
    assert.equal(db.getPinnedPings('wave-1').some(p => p.id === lapsed.id), false, 'not listed as pinned');
    assert.equal(db.searchPings('secret').length, 0, 'not found by search');
    assert.equal(db.searchPingsLike('secret').length, 0, 'not found by the fallback search');
    assert.equal(db.getWavePingsForFederation('wave-1').some(p => p.id === lapsed.id), false, 'not handed to other ports');
    assert.equal(db.getUnencryptedPings('wave-1').some(p => p.id === lapsed.id), false);

    // The sweep then erases the row itself.
    const swept = db.expireDuePings();
    assert.deepEqual(swept.pings.map(p => p.id), [lapsed.id]);
    const row = db.db.prepare('SELECT * FROM pings WHERE id = ?').get(lapsed.id);
    assert.equal(row.content, '');
    assert.equal(row.reactions, '{}');
    assert.equal(row.pinned_at, null);
    assert.equal(row.deleted, 1);
    assert.equal(db.db.prepare('SELECT COUNT(*) n FROM ping_read_by WHERE ping_id = ?').get(lapsed.id).n, 0);
    assert.equal(db.searchPings('secret').length, 0, 'the search index holds nothing either');
    assert.equal(db.db.prepare(`SELECT COUNT(*) n FROM pings_fts WHERE pings_fts MATCH '"secret"'`).get().n, 0);
    assert.equal(db.expireDuePings().pings.length, 0, 'a second sweep finds nothing');

    // Deleting by hand is a deletion, not an expiry.
    const deleted = db.createPing({ waveId: 'wave-1', authorId: 'user-a', content: 'oops', expiresAt: future() });
    db.deletePing(deleted.id, 'user-a');
    const shown = db.getPingsForWave('wave-1').find(p => p.id === deleted.id);
    assert.equal(shown.deleted, true);
    assert.equal(shown.expired, false);
    assert.equal(shown.expiresAt, null);

    // The wave timer is applied by createPing itself, so bots and webhooks
    // cannot skip it.
    db.setWavePingTtl('wave-1', 3600);
    assert.equal(db.getWave('wave-1').pingTtl, 3600);
    const byBot = db.createPing({ waveId: 'wave-1', authorId: 'user-a', content: 'from a bot' });
    assert.ok(Math.abs(Date.parse(byBot.expiresAt) - Date.parse(byBot.createdAt) - 3600_000) < 1000);
    db.db.close();
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('a federated copy honours the expiry it arrived with and cannot be revived', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-expiry-fed-'));
  try {
    const db = await openDb(copyServer(temp));
    seedTwoUsers(db);
    const base = { waveId: 'wave-1', originWaveId: 'origin-1', originNode: 'peer.example', authorId: 'r-1', authorNode: 'peer.example', createdAt: past(60_000) };

    db.cacheRemotePing({ ...base, id: 'remote-late', content: 'already over', expiresAt: past() });
    assert.equal(db.getRemotePing('remote-late').deleted, true, 'a late delivery is stored as gone');
    assert.equal(db.getRemotePing('remote-late').content, '');

    db.cacheRemotePing({ ...base, id: 'remote-soon', content: 'for now', expiresAt: future() });
    assert.equal(db.getRemotePingsForWave('wave-1').length, 1);
    db.db.prepare('UPDATE remote_pings SET expires_at = ? WHERE id = ?').run(past(), 'remote-soon');
    assert.equal(db.getRemotePingsForWave('wave-1').length, 0, 'hidden once due, before the sweep');
    assert.deepEqual(db.expireDuePings().pings.map(p => [p.id, p.remote]), [['remote-soon', true]]);

    // A re-delivery (a backfill, a retry) must not bring the content back.
    db.cacheRemotePing({ ...base, id: 'remote-soon', content: 'for now', expiresAt: future() });
    assert.equal(db.getRemotePing('remote-soon').content, '');
    assert.equal(db.getRemotePing('remote-soon').deleted, true);
    db.db.close();
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

// The guard: only files the ping's author uploaded are erased with it.
// `stripOwnerCheck` is the counterfactual — the same scenario with the check
// taken out of a copy of database-sqlite.js must erase the victim's file.
async function namedFileScenario({ stripOwnerCheck }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-expiry-owner-'));
  try {
    const serverDir = copyServer(temp, stripOwnerCheck && ((dir) => {
      const file = path.join(dir, 'database-sqlite.js');
      const src = fs.readFileSync(file, 'utf8');
      const guarded = "const owned = this.db.prepare('SELECT 1 FROM attachments WHERE path = ? AND uploaded_by = ?');";
      assert.ok(src.includes(guarded), 'could not find the ownership check');
      fs.writeFileSync(file, src
        .replace(guarded, "const owned = this.db.prepare('SELECT 1 FROM attachments WHERE path = ? AND ? IS NOT NULL');")
        .replace("const dropAttachment = this.db.prepare('DELETE FROM attachments WHERE path = ? AND uploaded_by = ?');",
          "const dropAttachment = this.db.prepare('DELETE FROM attachments WHERE path = ? AND ? IS NOT NULL');"));
    }));
    const db = await openDb(serverDir);
    seedTwoUsers(db);
    db.bindAttachment({ path: 'messages/victim.png', waveId: 'wave-1', uploadedBy: 'user-b' });
    db.bindAttachment({ path: 'messages/mine.png', waveId: 'wave-1', uploadedBy: 'user-a' });

    const ping = db.createPing({ waveId: 'wave-1', authorId: 'user-a', content: 'look', expiresAt: future() });
    db.recordPingExpiryFiles(ping.id, 'user-a', ['messages/victim.png', 'messages/mine.png', 'messages/no-row.png']);
    db.db.prepare('UPDATE pings SET expires_at = ? WHERE id = ?').run(past(), ping.id);
    db.expireDuePings();

    const result = {
      victimErased: !db.getAttachmentByPath('messages/victim.png') || db.isAttachmentTombstoned('messages/victim.png'),
      mineErased: !db.getAttachmentByPath('messages/mine.png') && db.isAttachmentTombstoned('messages/mine.png'),
      legacyTouched: db.isAttachmentTombstoned('messages/no-row.png'),
    };
    db.db.close();
    return result;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('naming someone else\'s upload does not get it erased', async () => {
  const guarded = await namedFileScenario({ stripOwnerCheck: false });
  assert.equal(guarded.mineErased, true, 'the author\'s own file goes with the ping');
  assert.equal(guarded.victimErased, false, 'another person\'s file stays');
  assert.equal(guarded.legacyTouched, false, 'a file nobody can vouch for is left alone');

  const unguarded = await namedFileScenario({ stripOwnerCheck: true });
  assert.equal(unguarded.victimErased, true, 'counterfactual: without the check the victim\'s file is erased');
});

test('expiring pings through a real server', { timeout: 180000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-expiry-e2e-'));
  const password = 'Expiring123!';
  let child;
  try {
    const serverDir = copyServer(temp);
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('EXPIRY_TEST_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-expiring-pings-0000000',
        SEED_DEMO_DATA: 'false', PING_EXPIRY_SWEEP_MS: '1000',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/EXPIRY_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/EXPIRY_TEST_PORT=(\d+)/)[1]}`;

    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, body: json };
    };
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', { body: { handle, email: `${handle}@example.test`, password, displayName: handle } });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, JSON.stringify(login.body));
      return { handle, token: login.body.token, id: login.body.user.id };
    };
    const send = (user, waveId, content, extra = {}) =>
      api('POST', '/api/pings', { token: user.token, body: { wave_id: waveId, content, ...extra } });
    const wavePings = async (user, waveId) => {
      const res = await api('GET', `/api/waves/${waveId}`, { token: user.token });
      assert.equal(res.status, 200);
      return new Map(res.body.all_messages.map(p => [p.id, p]));
    };
    const ttlOf = (ping) => Math.round((Date.parse(ping.expiresAt) - Date.parse(ping.createdAt)) / 1000);
    const Database = serverRequire('better-sqlite3');
    const rawDb = () => new Database(path.join(serverDir, 'data/farhold.db'));
    const lapse = (pingId) => { const d = rawDb(); d.prepare('UPDATE pings SET expires_at = ? WHERE id = ?').run(past(), pingId); d.close(); };
    const waitFor = async (check, what) => {
      const until = Date.now() + 10000;
      while (!(await check())) {
        if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
        await new Promise(r => setTimeout(r, 200));
      }
    };

    await makeUser('nodeadmin');
    const owner = await makeUser('waveowner');
    const member = await makeUser('wavemember');
    const created = await api('POST', '/api/waves', { token: owner.token, body: { title: 'Disappearing', privacy: 'private' } });
    assert.equal(created.status, 201);
    const waveId = created.body.id;
    assert.equal((await api('POST', `/api/waves/${waveId}/participants`, { token: owner.token, body: { userId: member.id } })).status < 300, true);

    await t.test('a sender picks a timer, from the list only', async () => {
      const res = await send(member, waveId, 'five minutes', { expiresIn: 300 });
      assert.equal(res.status, 201);
      assert.equal(ttlOf(res.body), 300);
      assert.equal((await send(member, waveId, 'odd', { expiresIn: 123 })).status, 400);
      assert.equal((await send(member, waveId, 'plain')).body.expiresAt, null, 'no timer, no expiry');
    });

    await t.test('the wave timer is a ceiling that only its managers set', async () => {
      assert.equal((await api('PUT', `/api/waves/${waveId}`, { token: member.token, body: { pingTtl: 3600 } })).status, 403);
      const refused = await api('PUT', `/api/waves/${waveId}`, { token: owner.token, body: { pingTtl: 77, title: 'Renamed by a bad save' } });
      assert.equal(refused.status, 400);
      const unchanged = await api('GET', `/api/waves/${waveId}`, { token: owner.token });
      assert.equal(unchanged.body.title, 'Disappearing', 'a refused save changes nothing');
      const set = await api('PUT', `/api/waves/${waveId}`, { token: owner.token, body: { pingTtl: 3600 } });
      assert.equal(set.status, 200);
      assert.equal(set.body.pingTtl, 3600);
      const list = await api('GET', '/api/waves', { token: member.token });
      assert.equal(list.body.find(w => w.id === waveId).pingTtl, 3600, 'the wave list carries it');
      const minimal = await api('GET', '/api/waves?minimal=true', { token: member.token });
      assert.equal(minimal.body.find(w => w.id === waveId).pingTtl, 3600, 'and so does the low-bandwidth list');

      assert.equal(ttlOf((await send(member, waveId, 'default')).body), 3600);
      assert.equal(ttlOf((await send(member, waveId, 'longer', { expiresIn: 2419200 })).body), 3600, 'longer is held to the wave');
      assert.equal(ttlOf((await send(member, waveId, 'shorter', { expiresIn: 300 })).body), 300, 'shorter is allowed');

      assert.equal((await api('PUT', `/api/waves/${waveId}`, { token: owner.token, body: { pingTtl: null } })).body.pingTtl, null);
    });

    await t.test('an expired ping is erased with its files, reactions and notifications', async () => {
      // An upload carried by the ping, and one the author did not make.
      const uploadAs = async (user, name) => {
        const form = new FormData();
        form.append('file', new Blob(['file body ' + name], { type: 'text/plain' }), name);
        form.append('waveId', waveId);
        const res = await fetch(`${base}/api/uploads/file`, { method: 'POST', headers: { Authorization: `Bearer ${user.token}` }, body: form });
        const data = await res.json();
        assert.equal(res.status, 200, JSON.stringify(data));
        return data.url;
      };
      const mine = await uploadAs(member, 'mine.txt');
      const theirs = await uploadAs(owner, 'theirs.txt');
      const relative = (url) => new URL(url, base).pathname.replace(/^\/uploads\//, '');
      assert.ok(fs.existsSync(path.join(serverDir, 'uploads', relative(mine))), 'the upload is on disk');

      const sent = await send(member, waveId, `@waveowner see ${mine}`, { expiresIn: 300, attachments: [theirs] });
      assert.equal(sent.status, 201);
      const pingId = sent.body.id;
      const reply = await send(owner, waveId, 'a reply', { parent_id: pingId });
      assert.equal(reply.status, 201);
      await api('POST', `/api/pings/${pingId}/react`, { token: owner.token, body: { emoji: '👍' } });
      const notes = async () => (await api('GET', '/api/notifications?limit=50', { token: owner.token })).body.notifications || [];
      assert.ok((await notes()).some(n => n.pingId === pingId), 'the mention notified the owner');

      lapse(pingId);
      await waitFor(async () => (await wavePings(owner, waveId)).get(pingId)?.expired, 'the sweep');
      // The gap is already closed by the reads; give the sweep a beat to finish erasing.
      await waitFor(() => { const d = rawDb(); const r = d.prepare('SELECT deleted FROM pings WHERE id = ?').get(pingId); d.close(); return r.deleted === 1; }, 'the row erased');

      const pings = await wavePings(owner, waveId);
      const gone = pings.get(pingId);
      assert.equal(gone.content, '');
      assert.equal(gone.expired, true);
      assert.deepEqual(gone.reactions || {}, {});
      assert.equal(pings.get(reply.body.id).parent_id, pingId, 'the reply keeps its parent');
      assert.equal((await notes()).some(n => n.pingId === pingId), false, 'its notification went too');

      await waitFor(() => !fs.existsSync(path.join(serverDir, 'uploads', relative(mine))), 'the file deleted from storage');
      const cookieRes = await fetch(`${base}/api/attachments/session`, { method: 'POST', headers: { Authorization: `Bearer ${owner.token}` } });
      const cookie = (cookieRes.headers.getSetCookie?.()[0] || cookieRes.headers.get('set-cookie')).split(';')[0];
      const fetchFile = (url) => fetch(new URL(url, base), { headers: { Cookie: cookie } });
      assert.notEqual((await fetchFile(mine)).status, 200, 'the expired ping\'s file is no longer served');
      assert.equal((await fetchFile(theirs)).status, 200, 'a file someone else uploaded is untouched');

      assert.equal((await api('PUT', `/api/pings/${pingId}`, { token: member.token, body: { content: 'back again' } })).status, 404,
        'an expired ping cannot be edited back to life');
    });

    await t.test('an expired ping is not searchable even before the sweep', async () => {
      // Search through the route, using a ping whose expiry is due right now.
      const sent = await send(member, waveId, 'zebracrossing notes', { expiresIn: 300 });
      const found = await api('GET', '/api/search?q=zebracrossing', { token: member.token });
      assert.ok(JSON.stringify(found.body).includes(sent.body.id), 'found while it lasts');
      lapse(sent.body.id);
      const after = await api('GET', '/api/search?q=zebracrossing', { token: member.token });
      assert.equal(JSON.stringify(after.body).includes(sent.body.id), false);
    });
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(r => child.once('exit', r));
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
