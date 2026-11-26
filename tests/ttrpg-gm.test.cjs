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
// What a GM's device sends for a GM-only document (v2.162.0): sealed with the GM key.
const gmSealed = (keyVersion = 1) => ({ ...sealed(), keyScope: 'gm', keyVersion });
// A wrapped GM key as a device would send it; the server can't open it and doesn't try.
const wrapped = (userId) => ({ userId, encryptedKey: Buffer.from(`wrapped-for-${userId}-`.repeat(3)).toString('base64'), nonce: Buffer.alloc(12, 3).toString('base64') });

async function startServer({ strip = false, stripGmKey = false, stripOwner = false } = {}) {
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
  if (stripOwner) {
    // Counterfactual: anyone at the table may change any token.
    const src = fs.readFileSync(serverFile, 'utf8');
    const marker = 'function tableDocWritable(doc, userId, table) {';
    assert.ok(src.includes(marker));
    fs.writeFileSync(serverFile, src.replace(marker, `${marker}\n  return true;`));
  }
  if (stripGmKey) {
    const src = fs.readFileSync(serverFile, 'utf8');
    const marker = 'function tableDocBody(t, audience, input) {';
    assert.ok(src.includes(marker));
    fs.writeFileSync(serverFile, src.replace(marker, `${marker}\n  return sheetBody(t.wave.id, input, 'GM documents');`));
  }
  fs.appendFileSync(serverFile, "\nserver.on('listening', () => console.log('TTRPG_TEST_PORT=' + server.address().port));\n");

  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const db = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
  const hash = serverRequire('bcryptjs').hashSync(password, 4);
  for (const id of ['gm', 'ann', 'bob', 'outsider']) db.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: hash, displayName: id });
  // Encryption keys on record (v2.162.0): the server notes who wrapped a GM key with which key.
  for (const id of ['gm', 'ann', 'bob', 'outsider']) {
    db.db.prepare('INSERT INTO user_encryption_keys (user_id, public_key, encrypted_private_key, key_derivation_salt, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, `public-key-of-${id}`, 'x', 'y', new Date().toISOString());
  }
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
  const raw = async (user, method, url, body) => {
    const res = await fetch(base + url, { method, headers: tokens[user] ? { Authorization: `Bearer ${tokens[user]}` } : {}, body });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const stop = () => { child.kill(); fs.rmSync(temp, { recursive: true, force: true }); };
  return { call, raw, waves: { table: table.id, other: other.id, federated: federated.id }, stop, output: () => output, serverDir };
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
    await t.test('the GM key: only GMs make it, for every GM and nobody else, one version at a time', async () => {
      const keys = `/api/waves/${waves.table}/table/gm-keys`;
      // Every user here has encryption keys on record for the wrapper check.
      assert.equal((await call('ann', 'POST', keys, { version: 1, keys: [wrapped('ann')] })).status, 403);
      assert.equal((await call('ann', 'GET', keys)).status, 403);
      let r = await call('gm', 'GET', keys);
      assert.equal(r.status, 200); assert.equal(r.body.version, 0); assert.deepEqual(r.body.gms, ['gm']); assert.deepEqual(r.body.missing, ['gm']);
      assert.equal((await call('gm', 'POST', keys, { version: 2, keys: [wrapped('gm')] })).status, 409);
      r = await call('gm', 'POST', keys, { version: 1, keys: [wrapped('gm'), wrapped('ann')] });
      assert.equal(r.status, 400); assert.equal(r.body.code, 'GM_KEY_RECIPIENTS');
      assert.equal((await call('gm', 'POST', keys, { version: 1, keys: [] })).status, 400);
      assert.equal((await call('gm', 'POST', keys, { version: 1, keys: [{ ...wrapped('gm'), nonce: 'short' }] })).status, 400);
      r = await call('gm', 'POST', keys, { version: 1, keys: [wrapped('gm')] });
      assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.version, 1); assert.deepEqual(r.body.missing, []);
      // A second "version 1" (a race) is refused, and the first stands.
      assert.equal((await call('gm', 'POST', keys, { version: 1, keys: [wrapped('gm')] })).status, 409);
      const mine = (await call('gm', 'GET', keys)).body.mine;
      assert.equal(mine.length, 1); assert.equal(mine[0].wrappedBy, 'gm'); assert.ok(mine[0].wrapperPublicKey);
    });

    await t.test('only GMs make documents, and each kind has its audiences; GM-only ones need the GM key', async () => {
      let r = await call('ann', 'POST', url(waves.table), { id: docId(), kind: 'note', ...gmSealed() });
      assert.equal(r.status, 403); assert.equal(r.body.code, 'GM_ONLY');
      r = await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'note', ...plain({ title: 'The duke is a vampire' }) });
      assert.equal(r.status, 400); assert.equal(r.body.code, 'GM_KEY_REQUIRED');
      r = await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'note', ...sealed() });
      assert.equal(r.status, 400); assert.equal(r.body.code, 'GM_KEY_REQUIRED');
      assert.equal((await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'note', ...gmSealed(2) })).status, 400);
      r = await call('gm', 'POST', url(waves.table), { id: note, kind: 'note', ...gmSealed() });
      assert.equal(r.status, 201); assert.equal(r.body.doc.audience, 'gm'); assert.equal(r.body.doc.keyScope, 'gm');
      // A document for the table can't be sealed with a key its readers don't hold.
      assert.equal((await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'encounter', ...gmSealed() })).status, 400);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'encounter', audience: 'gm', ...plain({}) })).status, 400);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'encounter_gm', audience: 'table', ...plain({}) })).status, 400);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'secret_plans', ...plain({}) })).status, 400);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: 'doc-1', kind: 'note', ...plain({}) })).status, 400);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: enc, kind: 'encounter', ...plain({ name: 'Ambush', combatants: [] }) })).status, 201);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: encGm, kind: 'encounter_gm', ...plain({ stats: { goblin: { hp: 7 } } }) })).status, 400);
      assert.equal((await call('gm', 'POST', url(waves.table), { id: encGm, kind: 'encounter_gm', ...gmSealed() })).status, 201);
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
      assert.equal((await call('ann', 'PUT', url(waves.table, note), { baseVersion: 1, ...gmSealed() })).status, 404);
    });

    await t.test('sharing a note makes it a handout, sealed for the table again; a stale write is refused', async () => {
      // Shared, it must be readable by the table: not left under the GM key.
      let r = await call('gm', 'PUT', url(waves.table, note), { baseVersion: 1, audience: 'table', ...gmSealed() });
      assert.equal(r.status, 400);
      r = await call('gm', 'PUT', url(waves.table, note), { baseVersion: 1, audience: 'table', ...plain({ title: 'Handout' }) });
      assert.equal(r.status, 200); assert.equal(r.body.doc.audience, 'table');
      assert.equal(JSON.parse((await call('bob', 'GET', url(waves.table, note))).body.doc.data).title, 'Handout');
      r = await call('gm', 'PUT', url(waves.table, note), { baseVersion: 1, ...plain({ title: 'Stale' }) });
      assert.equal(r.status, 409); assert.equal(r.body.code, 'DOC_CONFLICT'); assert.equal(r.body.doc.version, 2);
      assert.equal((await call('gm', 'PUT', url(waves.table, note), { baseVersion: 2, audience: 'gm', ...plain({ title: 'Back' }) })).status, 400);
      r = await call('gm', 'PUT', url(waves.table, note), { baseVersion: 2, audience: 'gm', ...gmSealed() });
      assert.equal(r.status, 200); assert.equal(r.body.doc.keyScope, 'gm');
      assert.equal((await call('bob', 'GET', url(waves.table, note))).status, 404);
      assert.equal((await call('gm', 'PUT', url(waves.table, enc), { baseVersion: 1, audience: 'gm', ...plain({}) })).status, 400);
    });

    await t.test('an encrypted wave takes only ciphertext', async () => {
      assert.equal((await makeTable(s, 'ann', waves.other)).status, 200);
      // ann owns that wave, so she is its GM. A document for the table there is ciphertext under the wave key.
      let r = await call('ann', 'POST', url(waves.other), { id: docId(), kind: 'encounter', ...plain({ name: 'plain' }) });
      assert.equal(r.status, 400); assert.equal(r.body.code, 'ENCRYPTION_REQUIRED');
      const body = sealed();
      r = await call('ann', 'POST', url(waves.other), { id: docId(), kind: 'encounter', ...body });
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

    await t.test('sharing the GM key with a new GM, and a new version when a GM leaves', async () => {
      const keys = `/api/waves/${waves.table}/table/gm-keys`;
      assert.equal((await s.call('gm', 'PUT', `/api/waves/${waves.table}/table`, { system: 'dnd5e-2014', defaultVisibility: 'gm', gms: ['gm', 'bob'] })).status, 200);
      let r = await call('gm', 'GET', keys);
      assert.deepEqual(r.body.missing, ['bob']); assert.equal(r.body.needsRotation, false);
      // A new version must go to every GM (not bob alone), and a player can't be given one.
      assert.equal((await call('bob', 'POST', keys, { version: 2, keys: [wrapped('bob')] })).status, 400);
      assert.equal((await call('gm', 'POST', `${keys}/grant`, { userId: 'ann', keys: [{ version: 1, ...wrapped('ann') }] })).status, 400);
      // Only versions the giver holds.
      assert.equal((await call('gm', 'POST', `${keys}/grant`, { userId: 'bob', keys: [{ version: 2, ...wrapped('bob') }] })).status, 400);
      r = await call('gm', 'POST', `${keys}/grant`, { userId: 'bob', keys: [{ version: 1, ...wrapped('bob') }] });
      assert.equal(r.status, 200); assert.equal(r.body.added, 1); assert.deepEqual(r.body.missing, []);
      // Never over one already held.
      r = await call('gm', 'POST', `${keys}/grant`, { userId: 'bob', keys: [{ version: 1, ...wrapped('evil') }] });
      assert.equal(r.body.added, 0);
      assert.equal((await call('bob', 'GET', keys)).body.mine[0].encryptedKey, wrapped('bob').encryptedKey);
      // bob stops being a GM: he holds the current version, so a new one is due, for gm alone.
      assert.equal((await s.call('gm', 'PUT', `/api/waves/${waves.table}/table`, { system: 'dnd5e-2014', defaultVisibility: 'gm', gms: ['gm'] })).status, 200);
      r = await call('gm', 'GET', keys);
      assert.equal(r.body.needsRotation, true);
      assert.equal((await call('gm', 'POST', keys, { version: 2, keys: [wrapped('gm'), wrapped('bob')] })).status, 400);
      r = await call('gm', 'POST', keys, { version: 2, keys: [wrapped('gm')] });
      assert.equal(r.status, 201); assert.equal(r.body.needsRotation, false);
      assert.equal((await call('bob', 'GET', keys)).status, 403);
    });

    await t.test('maps: a GM uploads the picture, kept large; players see a map once it is shown', async () => {
      const sharp = serverRequire('sharp');
      const png = await sharp({ create: { width: 5000, height: 3000, channels: 3, background: '#335533' } }).png().toBuffer();
      const send = async (who) => {
        const form = new FormData();
        form.append('image', new Blob([png], { type: 'image/png' }), 'dungeon.png');
        return s.raw(who, 'POST', `/api/waves/${waves.table}/table/map-image`, form);
      };
      assert.equal((await send('ann')).status, 403);
      const r = await send('gm');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.width, 4096); assert.equal(r.body.height, Math.round(3000 * 4096 / 5000));
      assert.match(r.body.url, /\/uploads\/messages\/.*-map-\d+\.webp$/);
      // The picture is bound to the table's wave: someone outside it can't fetch it.
      const path = new URL(r.body.url, 'http://x').pathname;
      assert.equal((await s.raw('outsider', 'GET', path)).status === 200, false);
      const map = docId();
      assert.equal((await call('gm', 'POST', url(waves.table), { id: map, kind: 'map', ...gmSealed(2) })).status, 201);
      assert.ok(!(await call('ann', 'GET', url(waves.table))).body.docs.some(d => d.id === map), 'a map being prepared is the GMs\'');
      assert.equal((await call('gm', 'PUT', url(waves.table, map), { baseVersion: 1, audience: 'table', ...plain({ name: 'Dungeon', image: r.body }) })).status, 200);
      assert.ok((await call('ann', 'GET', url(waves.table))).body.docs.some(d => d.id === map));
      // Players can't change a map.
      assert.equal((await call('ann', 'PUT', url(waves.table, map), { baseVersion: 2, ...plain({ name: 'Mine' }) })).status, 403);
    });

    const annToken = docId(); const gmToken = docId(); const hiddenToken = docId();
    await t.test('tokens: a player places and moves their own, nobody else\'s, and hides nothing', async () => {
      let r = await call('ann', 'POST', url(waves.table), { id: annToken, kind: 'token', ...plain({ name: 'Vex', x: 1, y: 1 }) });
      assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.doc.ownerId, 'ann'); assert.equal(r.body.doc.canEdit, true);
      assert.equal((await call('ann', 'POST', url(waves.table), { id: docId(), kind: 'token', ownerId: 'bob', ...plain({}) })).status, 403);
      assert.equal((await call('ann', 'POST', url(waves.table), { id: docId(), kind: 'token', audience: 'gm', ...gmSealed(2) })).status, 403);
      assert.equal((await call('ann', 'POST', url(waves.table), { id: docId(), kind: 'note', ...gmSealed(2) })).status, 403);
      // The GM places one for bob.
      r = await call('gm', 'POST', url(waves.table), { id: gmToken, kind: 'token', ownerId: 'bob', ...plain({ name: 'Zoe', x: 2, y: 2 }) });
      assert.equal(r.status, 201); assert.equal(r.body.doc.ownerId, 'bob');
      assert.equal((await call('gm', 'POST', url(waves.table), { id: docId(), kind: 'token', ownerId: 'outsider', ...plain({}) })).status, 400);
      // Moving.
      assert.equal((await call('ann', 'PUT', url(waves.table, annToken), { baseVersion: 1, ...plain({ name: 'Vex', x: 3, y: 1 }) })).status, 200);
      assert.equal((await call('ann', 'PUT', url(waves.table, gmToken), { baseVersion: 1, ...plain({ name: 'Zoe', x: 9, y: 9 }) })).status, 403);
      assert.equal((await call('bob', 'PUT', url(waves.table, gmToken), { baseVersion: 1, ...plain({ name: 'Zoe', x: 3, y: 2 }) })).status, 200);
      assert.equal((await call('gm', 'PUT', url(waves.table, annToken), { baseVersion: 2, ...plain({ name: 'Vex', x: 0, y: 0 }) })).status, 200);
      // A player can't hide their token from the table.
      assert.equal((await call('ann', 'PUT', url(waves.table, annToken), { baseVersion: 3, audience: 'gm', ...gmSealed(2) })).status, 403);
      // A hidden monster never reaches players.
      assert.equal((await call('gm', 'POST', url(waves.table), { id: hiddenToken, kind: 'token', audience: 'gm', ...gmSealed(2) })).status, 201);
      assert.ok(!(await call('bob', 'GET', url(waves.table))).body.docs.some(d => d.id === hiddenToken));
      assert.equal((await call('bob', 'GET', url(waves.table, hiddenToken))).status, 404);
      // Removing: the owner can, another player can't.
      assert.equal((await call('bob', 'DELETE', url(waves.table, annToken))).status, 403);
      assert.equal((await call('ann', 'DELETE', url(waves.table, annToken))).status, 200);
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
    assert.equal((await call('gm', 'POST', `/api/waves/${waves.table}/table/gm-keys`, { version: 1, keys: [wrapped('gm')] })).status, 201);
    const id = docId();
    const body = gmSealed();
    assert.equal((await call('gm', 'POST', `/api/waves/${waves.table}/table-docs`, { id, kind: 'note', ...body })).status, 201);
    const r = await call('bob', 'GET', `/api/waves/${waves.table}/table-docs/${id}`);
    assert.equal(r.status, 200, 'the stripped server should hand over the note');
    // Even so, what it hands over is sealed with a key bob was never given.
    assert.equal(r.body.doc.data, body.data); assert.equal(r.body.doc.keyScope, 'gm');
  } finally {
    s.stop();
  }
});

test('counterfactual: without the GM-key rule, a GM-only note could be stored as plain text', { timeout: 60000 }, async () => {
  const s = await startServer({ stripGmKey: true });
  const { call, waves } = s;
  try {
    assert.equal((await enableFeature(s)).status, 200);
    assert.equal((await makeTable(s, 'gm', waves.table)).status, 200);
    const r = await call('gm', 'POST', `/api/waves/${waves.table}/table-docs`, { id: docId(), kind: 'note', ...plain({ title: 'Readable by the server' }) });
    assert.equal(r.status, 201, 'the stripped server should take a plain GM note');
  } finally {
    s.stop();
  }
});

test('counterfactual: without the owner check, a player moves someone else\'s token', { timeout: 60000 }, async () => {
  const s = await startServer({ stripOwner: true });
  const { call, waves } = s;
  try {
    assert.equal((await enableFeature(s)).status, 200);
    assert.equal((await makeTable(s, 'gm', waves.table)).status, 200);
    const id = docId();
    assert.equal((await call('gm', 'POST', `/api/waves/${waves.table}/table-docs`, { id, kind: 'token', ownerId: 'bob', ...plain({ x: 1, y: 1 }) })).status, 201);
    const r = await call('ann', 'PUT', `/api/waves/${waves.table}/table-docs/${id}`, { baseVersion: 1, ...plain({ x: 9, y: 9 }) });
    assert.equal(r.status, 200, 'the stripped server should let ann move bob\'s token');
  } finally {
    s.stop();
  }
});
