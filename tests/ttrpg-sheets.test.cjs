'use strict';

// Tabletop role-playing, phase 2 (v2.159.0): character sheets. A sheet is a
// blob the server stores (ciphertext in an encrypted wave) and decides, on
// every read, who may see: its owner, the table's GMs, and everyone at the
// table unless it's for the GMs only. A write names the version it started
// from. The read rule is a security control, so it has a counterfactual:
// with sheetReadable stripped, a GM-only sheet reaches another player.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'Sheets123!';
const serverRequire = (m) => require(path.join(root, 'server/node_modules', m));
let n = 0;
const sheetId = () => `sheet-${require('node:crypto').randomUUID()}`;
const plain = (data) => ({ data: JSON.stringify(data) });
// Looks like what a device sends: base64 ciphertext and a 12-byte nonce.
const sealed = () => ({ encrypted: true, data: Buffer.from(`ciphertext-${n++}-`.repeat(4)).toString('base64'), nonce: Buffer.alloc(12, 7).toString('base64'), keyVersion: 1 });

async function startServer({ strip = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-sheets-'));
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
    // Counterfactual: every reader at the table may read every sheet.
    const marker = 'function sheetReadable(sheet, viewerId, table) {';
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

const makeTable = (s, who, waveId) => s.call(who, 'PUT', `/api/waves/${waveId}/table`, { system: 'dnd5e-2024', defaultVisibility: 'gm' });

test('character sheets against a disposable server', { timeout: 60000 }, async (t) => {
  const s = await startServer();
  const { call, waves } = s;
  const url = (w, id = '') => `/api/waves/${w}/sheets${id ? `/${id}` : ''}`;
  try {
    await t.test('off by default, and only at a table', async () => {
      assert.equal((await call('ann', 'GET', url(waves.table))).status, 403);
      assert.equal((await enableFeature(s)).status, 200);
      const r = await call('ann', 'POST', url(waves.table), { id: sheetId(), system: 'dnd5e-2024', ...plain({ name: 'Vex' }) });
      assert.equal(r.status, 409); assert.equal(r.body.code, 'NOT_A_TABLE');
      assert.equal((await makeTable(s, 'gm', waves.table)).status, 200);
    });

    const shared = sheetId(); const secret = sheetId();
    await t.test('a player makes sheets; the table sees a shared one, only the GMs a GM-only one', async () => {
      let r = await call('ann', 'POST', url(waves.table), { id: shared, system: 'dnd5e-2024', ...plain({ name: 'Vex', hp: { current: 20 } }) });
      assert.equal(r.status, 201, JSON.stringify(r.body)); assert.equal(r.body.sheet.version, 1); assert.equal(r.body.sheet.visibility, 'table');
      r = await call('ann', 'POST', url(waves.table), { id: secret, system: 'generic', visibility: 'gm', ...plain({ name: 'Hidden twin' }) });
      assert.equal(r.status, 201);

      const bobList = (await call('bob', 'GET', url(waves.table))).body.sheets.map(x => x.id);
      assert.deepEqual(bobList, [shared]);
      assert.equal((await call('bob', 'GET', url(waves.table, secret))).status, 404);
      const gmList = (await call('gm', 'GET', url(waves.table))).body.sheets.map(x => x.id).sort();
      assert.deepEqual(gmList, [shared, secret].sort());
      assert.equal((await call('ann', 'GET', url(waves.table, secret))).body.sheet.isOwner, true);
      // Someone not in the wave reads nothing.
      assert.equal((await call('outsider', 'GET', url(waves.table))).status, 403);
      assert.equal((await call('outsider', 'GET', url(waves.table, shared))).status, 403);
    });

    await t.test('its owner and the GMs change it; a stale write is refused with the current sheet', async () => {
      let r = await call('gm', 'PUT', url(waves.table, shared), { baseVersion: 1, ...plain({ name: 'Vex', hp: { current: 13 } }) });
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.sheet.version, 2); assert.equal(r.body.sheet.updatedBy, 'gm');
      r = await call('ann', 'PUT', url(waves.table, shared), { baseVersion: 1, ...plain({ name: 'Vex', hp: { current: 20 }, notes: 'x' }) });
      assert.equal(r.status, 409); assert.equal(r.body.code, 'SHEET_CONFLICT'); assert.equal(r.body.sheet.version, 2);
      assert.equal(JSON.parse(r.body.sheet.data).hp.current, 13);
      r = await call('ann', 'PUT', url(waves.table, shared), { baseVersion: 2, ...plain({ name: 'Vex', hp: { current: 13 }, notes: 'x' }) });
      assert.equal(r.status, 200); assert.equal(r.body.sheet.version, 3);

      r = await call('bob', 'PUT', url(waves.table, shared), { baseVersion: 3, ...plain({ name: 'Mine now' }) });
      assert.equal(r.status, 403); assert.equal(r.body.code, 'SHEET_READ_ONLY');
      assert.equal((await call('bob', 'PUT', url(waves.table, secret), { baseVersion: 1, ...plain({}) })).status, 404);
      assert.equal((await call('ann', 'PUT', url(waves.table, shared), plain({}))).status, 400);
    });

    await t.test('only its owner chooses who sees it', async () => {
      let r = await call('gm', 'PUT', url(waves.table, shared), { baseVersion: 3, visibility: 'gm', ...plain({ name: 'Vex' }) });
      assert.equal(r.status, 403); assert.equal(r.body.code, 'SHEET_OWNER_ONLY');
      r = await call('ann', 'PUT', url(waves.table, shared), { baseVersion: 3, visibility: 'gm', ...plain({ name: 'Vex' }) });
      assert.equal(r.status, 200); assert.equal(r.body.sheet.visibility, 'gm');
      assert.equal((await call('bob', 'GET', url(waves.table, shared))).status, 404);
      r = await call('ann', 'PUT', url(waves.table, shared), { baseVersion: 4, visibility: 'table', ...plain({ name: 'Vex' }) });
      assert.equal(r.status, 200);
      assert.equal((await call('bob', 'GET', url(waves.table, shared))).status, 200);
    });

    await t.test('refuses bad sheets, a taken id, and more than ten each', async () => {
      const bad = [
        { id: 'sheet-1', system: 'generic', ...plain({}) },
        { id: sheetId(), system: 'pathfinder', ...plain({}) },
        { id: sheetId(), system: 'generic', visibility: 'everyone', ...plain({}) },
        { id: sheetId(), system: 'generic', data: 'not json' },
        { id: sheetId(), system: 'generic', data: '[1,2]' },
        { id: sheetId(), system: 'generic', data: JSON.stringify({ notes: 'x'.repeat(140 * 1024) }) },
        { id: sheetId(), system: 'generic', ...sealed() },
      ];
      for (const b of bad) assert.equal((await call('bob', 'POST', url(waves.table), b)).status, 400, JSON.stringify(b).slice(0, 80));
      assert.equal((await call('bob', 'POST', url(waves.table), { id: shared, system: 'generic', ...plain({}) })).status, 409);
      for (let i = 0; i < 10; i++) assert.equal((await call('bob', 'POST', url(waves.table), { id: sheetId(), system: 'generic', ...plain({ i }) })).status, 201);
      const r = await call('bob', 'POST', url(waves.table), { id: sheetId(), system: 'generic', ...plain({}) });
      assert.equal(r.status, 409); assert.equal(r.body.code, 'SHEET_LIMIT');
    });

    await t.test('an encrypted wave takes only ciphertext, and stores nothing readable', async () => {
      assert.equal((await makeTable(s, 'ann', waves.other)).status, 200);
      const id = sheetId();
      let r = await call('ann', 'POST', url(waves.other), { id, system: 'dnd5e-2024', ...plain({ name: 'Persuade the duke' }) });
      assert.equal(r.status, 400); assert.equal(r.body.code, 'ENCRYPTION_REQUIRED');
      r = await call('ann', 'POST', url(waves.other), { id, system: 'dnd5e-2024', ...sealed(), keyVersion: 9 });
      assert.equal(r.status, 400);
      const body = sealed();
      r = await call('ann', 'POST', url(waves.other), { id, system: 'dnd5e-2024', ...body });
      assert.equal(r.status, 201); assert.equal(r.body.sheet.encrypted, true); assert.equal(r.body.sheet.data, body.data);
      r = await call('ann', 'PUT', url(waves.other, id), { baseVersion: 1, ...plain({ name: 'oops' }) });
      assert.equal(r.status, 400); assert.equal(r.body.code, 'ENCRYPTION_REQUIRED');
      // The account export carries the sheet as stored.
      const exp = await call('ann', 'GET', '/api/account/export');
      assert.equal(exp.status, 200);
      assert.ok(exp.body.characterSheets.some(x => x.id === id && x.data === body.data));
    });

    await t.test('waves with people on other servers are refused', async () => {
      const r = await call('gm', 'GET', url(waves.federated));
      assert.equal(r.status, 409);
    });

    await t.test('deleting: not another player, but its owner or a GM', async () => {
      assert.equal((await call('bob', 'DELETE', url(waves.table, shared))).status, 403);
      assert.equal((await call('gm', 'DELETE', url(waves.table, secret))).status, 200);
      assert.equal((await call('ann', 'DELETE', url(waves.table, shared))).status, 200);
      assert.equal((await call('ann', 'GET', url(waves.table, shared))).status, 404);
    });
  } finally {
    s.stop();
  }
});

test('counterfactual: without the read check, a GM-only sheet reaches another player', { timeout: 60000 }, async () => {
  const s = await startServer({ strip: true });
  const { call, waves } = s;
  try {
    assert.equal((await enableFeature(s)).status, 200);
    assert.equal((await makeTable(s, 'gm', waves.table)).status, 200);
    const id = sheetId();
    assert.equal((await call('ann', 'POST', `/api/waves/${waves.table}/sheets`, { id, system: 'generic', visibility: 'gm', ...plain({ name: 'Secret' }) })).status, 201);
    const r = await call('bob', 'GET', `/api/waves/${waves.table}/sheets/${id}`);
    assert.equal(r.status, 200, 'the stripped server should leak the sheet');
    assert.equal(JSON.parse(r.body.sheet.data).name, 'Secret');
  } finally {
    s.stop();
  }
});
