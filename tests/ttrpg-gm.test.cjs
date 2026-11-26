'use strict';

// Tabletop role-playing, phase 3 (v2.160.0): the GM's tools. GM documents
// (encounters, the GMs' half of an encounter, stat blocks, notes) are read by
// their audience, decided on every read, and written only by GMs. Rolls can
// carry a ref (initiative), and a GM can tell a player it's their turn. The
// read rule is a security control, so it has a counterfactual: with
// tableDocReadable stripped, a player reads the GM's notes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'Gm123456!';
const serverRequire = (m) => require(path.join(root, 'server/node_modules', m));
let n = 0;
const docId = () => `doc-${require('node:crypto').randomUUID()}`;
const plain = (data) => ({ data: JSON.stringify(data) });
const sealed = () => ({ encrypted: true, data: Buffer.from(`ciphertext-${n++}-`.repeat(4)).toString('base64'), nonce: Buffer.alloc(12, 7).toString('base64'), keyVersion: 1 });

async function startServer({ strip = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-gmtools-'));
  const serverDir = path.join(temp, 'server'); fs.mkdirSync(serverDir);
  for (const name of fs.readdirSync(path.join(root, 'server'))) {
    if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
  }
  fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
  fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(serverDir, 'data'));
  const serverFile = path.join(serverDir, 'server.js');
  if (strip) {
    const src = fs.readFileSync(serverFile, 'utf8');
    // Counterfactual: everyone at the table may read every GM document.
    const marker = 'function tableDocReadable(doc, viewerId, table) {';
    assert.ok(src.includes(marker));
    fs.writeFileSync(serverFile, src.replace(marker, `${marker}\n  return true;`));
  }
  fs.appendFileSync(serverFile, "\nserver.on('listening', () => console.log('TTRPG_TEST_PORT=' + server.address().port));\n");

  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const db = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
  const hash = serverRequire('bcryptjs').hashSync(password, 4);
  for (const id of ['gm', 'ann', 'bob', 'outsider']) db.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: hash, displayName: id });
  const table = db.createWave({ title: 'Table', createdBy: 'gm', participants: ['ann', 'bob'], privacy: 'private' });
  const other = db.createWave({ title: 'Other', createdBy: 'ann', participants: ['gm', 'bob'], privacy: 'private' });
  const federated = db.createWave({ title: 'Across', createdBy: 'gm', participants: ['ann'], privacy: 'private' });
  db.db.prepare("UPDATE waves SET federation_state = 'origin' WHERE id = ?").run(federated.id);
  db.db.prepare('UPDATE waves SET encrypted = 1 WHERE id = ?').run(other.id);
  db.db.close();

  const child = spawn(process.execPath, ['server.js'], { cwd: serverDir,
    env: { PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', USE_SQLITE: 'true', JWT_SECRET: 'ttrpg-test-signing-key',
      FEDERATION_ENABLED: 'false', SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100', RATE_LIMIT_DICE_MAX: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  const deadline = Date.now() + 20000;
  while (!/TTRPG_TEST_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('Cortex startup failed: ' + output.slice(-5000));
    await new Promise(r => setTimeout(r, 50));
  }
  const base = `http://127.0.0.1:${output.match(/TTRPG_TEST_PORT=(\d+)/)[1]}`;
  const tokens = {};
  const call = async (user, method, url, body, extra = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(tokens[user] ? { Authorization: `Bearer ${tokens[user]}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  for (const user of ['gm', 'ann', 'bob', 'outsider']) {
    const r = await call(null, 'POST', '/api/auth/login', { handle: user, password });
    assert.equal(r.status, 200, JSON.stringify(r.body)); tokens[user] = r.body.token;
  }
  const stop = () => { child.kill(); fs.rmSync(temp, { recursive: true, force: true }); };
  return { call, waves: { table: table.id, other: other.id, federated: federated.id }, stop, output: () => output, serverDir };
}

// gm is the first account, so the instance admin; admin settings need a step-up.
const enableFeature = async (s) => {
  const stepUp = (await s.call('gm', 'POST', '/api/auth/step-up', { password })).body.stepUpToken;
  return s.call('gm', 'PUT', '/api/admin/instance-config', { features: { ttrpg: true } }, { 'X-Step-Up-Token': stepUp });
};

const makeTable = (s, who, waveId, system = 'dnd5e-2024') => s.call(who, 'PUT', `/api/waves/${waveId}/table`, { system, defaultVisibility: 'gm' });

test('the GM tools against a disposable server', { timeout: 60000 }, async (t) => {
  const s = await startServer();
  const { call, waves } = s;
  const url = (w, id = '') => `/api/waves/${w}/table-docs${id ? `/${id}` : ''}`;
  try {
    assert.equal((await enableFeature(s)).status, 200);

    await t.test('2014 rules are a system a table and a sheet can use', async () => {
      const r = await makeTable(s, 'gm', waves.table, 'dnd5e-2014');
      assert.equal(r.status, 200); assert.equal(r.body.table.system, 'dnd5e-2014');
      const sh = await call('ann', 'POST', `/api/waves/${waves.table}/sheets`, { id: `sheet-${require('node:crypto').randomUUID()}`, system: 'dnd5e-2014', ...plain({ name: 'Old school' }) });
      assert.equal(sh.status, 201);
    });

    const note = docId(); const enc = docId(); const encGm = docId();
    await t.test('only GMs make documents, and each kind has its audiences', async () => {
      let r = await call('ann', 'POST', url(waves.table), { id: docId(), kind: 'note', ...plain({ title: 'Mine' }) });
      assert.equal(r.status, 403); assert.equal(r.body.code, 'GM_ONLY');
      r = await call('gm', 'POST', url(waves.table), { id: note, kind: 'note', ...plain({ title: 'The duke is a vampire' }) });
      assert.equal(r.status, 201); assert.equal(r.body.doc.audience, 'gm');
      assert.equal((await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'encounter', audience: 'gm', ...plain({}) })).status, 400);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'encounter_gm', audience: 'table', ...plain({}) })).status, 400);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'secret_plans', ...plain({}) })).status, 400);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: 'doc-1', kind: 'note', ...plain({}) })).status, 400);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: enc, kind: 'encounter', ...plain({ name: 'Ambush', combatants: [] }) })).status, 201);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: encGm, kind: 'encounter_gm', ...plain({ stats: { goblin: { hp: 7 } } }) })).status, 201);
    });

    await t.test('players read the encounter, never the GM half or the notes', async () => {
      const kinds = (await call('ann', 'GET', url(waves.table))).body.docs.map(d => d.kind);
      assert.deepEqual(kinds, ['encounter']);
      assert.equal((await call('ann', 'GET', url(waves.table, note))).status, 404);
      assert.equal((await call('ann', 'GET', url(waves.table, encGm))).status, 404);
      assert.equal((await call('ann', 'GET', url(waves.table, enc))).body.doc.canEdit, false);
      assert.equal((await call('gm', 'GET', url(waves.table))).body.docs.length, 3);
      assert.equal((await call('outsider', 'GET', url(waves.table))).status, 403);
      // Nor change or delete them.
      assert.equal((await call('ann', 'PUT', url(waves.table, enc), { baseVersion: 1, ...plain({ name: 'Ours now' }) })).status, 403);
      assert.equal((await call('ann', 'DELETE', url(waves.table, enc))).status, 403);
      assert.equal((await call('ann', 'PUT', url(waves.table, note), { baseVersion: 1, ...plain({}) })).status, 404);
    });

    await t.test('sharing a note makes it a handout; a stale write is refused', async () => {
      let r = await call('gm', 'PUT', url(waves.table, note), { baseVersion: 1, audience: 'table', ...plain({ title: 'Handout' }) });
      assert.equal(r.status, 200); assert.equal(r.body.doc.audience, 'table');
      assert.equal(JSON.parse((await call('bob', 'GET', url(waves.table, note))).body.doc.data).title, 'Handout');
      r = await call('gm', 'PUT', url(waves.table, note), { baseVersion: 1, ...plain({ title: 'Stale' }) });
      assert.equal(r.status, 409); assert.equal(r.body.code, 'DOC_CONFLICT'); assert.equal(r.body.doc.version, 2);
      r = await call('gm', 'PUT', url(waves.table, note), { baseVersion: 2, audience: 'gm', ...plain({ title: 'Back' }) });
      assert.equal(r.status, 200);
      assert.equal((await call('bob', 'GET', url(waves.table, note))).status, 404);
      assert.equal((await call('gm', 'PUT', url(waves.table, enc), { baseVersion: 1, audience: 'gm', ...plain({}) })).status, 400);
    });

    await t.test('an encrypted wave takes only ciphertext', async () => {
      assert.equal((await makeTable(s, 'ann', waves.other)).status, 200);
      // ann owns that wave, so she is its GM.
      let r = await call('ann', 'POST', url(waves.other), { id: docId(), kind: 'note', ...plain({ title: 'plain' }) });
      assert.equal(r.status, 400); assert.equal(r.body.code, 'ENCRYPTION_REQUIRED');
      const body = sealed();
      r = await call('ann', 'POST', url(waves.other), { id: docId(), kind: 'note', ...body });
      assert.equal(r.status, 201); assert.equal(r.body.doc.data, body.data);
    });

    await t.test('a roll can carry a ref, which the log can filter on', async () => {
      const rolls = `/api/waves/${waves.table}/rolls`;
      assert.equal((await call('ann', 'POST', rolls, { expression: 'd20', ref: 'enc:x y' })).status, 400);
      assert.equal((await call('ann', 'POST', rolls, { expression: 'd20', ref: 'x'.repeat(101) })).status, 400);
      const a = await call('ann', 'POST', rolls, { expression: 'd20+2', visibility: 'public', ref: `enc:${enc}:c1` });
      assert.equal(a.status, 201); assert.equal(a.body.roll.ref, `enc:${enc}:c1`);
      await call('bob', 'POST', rolls, { expression: 'd20', visibility: 'public', ref: 'enc:other:c2' });
      await call('bob', 'POST', rolls, { expression: 'd20', visibility: 'public' });
      const found = (await call('gm', 'GET', `${rolls}?ref=${encodeURIComponent(`enc:${enc}:`)}`)).body.rolls;
      assert.deepEqual(found.map(r => r.ref), [`enc:${enc}:c1`]);
      // A hidden roll found this way stays hidden: the ref doesn't open it.
      await call('gm', 'POST', rolls, { expression: 'd20', visibility: 'gm_secret', ref: `enc:${enc}:m1` });
      const seen = (await call('bob', 'GET', `${rolls}?ref=${encodeURIComponent(`enc:${enc}:`)}`)).body.rolls;
      assert.equal(seen.length, 2);
      const secret = seen.find(r => r.hidden);
      assert.ok(secret, 'the GM\'s secret roll is listed as hidden');
      assert.equal(secret.total, undefined); assert.equal(secret.terms, undefined); assert.equal(secret.expression, null);
    });

    await t.test('a GM tells a player it is their turn; nobody else can', async () => {
      const turn = `/api/waves/${waves.table}/table/turn`;
      assert.equal((await call('ann', 'POST', turn, { userId: 'bob' })).status, 403);
      assert.equal((await call('gm', 'POST', turn, { userId: 'outsider' })).status, 400);
      const r = await call('gm', 'POST', turn, { userId: 'bob' });
      assert.equal(r.status, 200); assert.equal(r.body.notified, true);
      const notes = (await call('bob', 'GET', '/api/notifications')).body;
      const list = notes.notifications || notes;
      assert.ok(list.some(x => x.type === 'ttrpg_turn' && /your turn/i.test(`${x.title} ${x.body}`)), JSON.stringify(list).slice(0, 300));
    });

    await t.test('deleting: GMs only', async () => {
      assert.equal((await call('gm', 'DELETE', url(waves.table, enc))).status, 200);
      assert.equal((await call('gm', 'GET', url(waves.table, enc))).status, 404);
    });
  } finally {
    s.stop();
  }
});

test('counterfactual: without the read check, a player reads the GM\'s notes', { timeout: 60000 }, async () => {
  const s = await startServer({ strip: true });
  const { call, waves } = s;
  try {
    assert.equal((await enableFeature(s)).status, 200);
    assert.equal((await makeTable(s, 'gm', waves.table)).status, 200);
    const id = docId();
    assert.equal((await call('gm', 'POST', `/api/waves/${waves.table}/table-docs`, { id, kind: 'note', ...plain({ title: 'Secret door' }) })).status, 201);
    const r = await call('bob', 'GET', `/api/waves/${waves.table}/table-docs/${id}`);
    assert.equal(r.status, 200, 'the stripped server should leak the note');
    assert.equal(JSON.parse(r.body.doc.data).title, 'Secret door');
  } finally {
    s.stop();
  }
});
