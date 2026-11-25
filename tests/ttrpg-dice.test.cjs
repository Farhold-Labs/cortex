'use strict';

// Tabletop role-playing, phase 1 (v2.158.0): docs/ttrpg/README.md. The server
// rolls; who sees a result is decided on every read; a roll goes on one ping,
// its roller's, in its own wave. The notation parser is tested directly, the
// rest against a disposable server. The visibility rule is a security control,
// so it has a counterfactual: with rollView stripped, a hidden result leaks.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const password = 'Dice123!';
const serverRequire = (m) => require(path.join(root, 'server/node_modules', m));
const dice = () => import('../server/lib/dice.js');
// A fixed sequence of faces, for rolls whose outcome a test needs to know.
const faces = (...values) => { let i = 0; return () => values[i++ % values.length]; };

// ---------------------------------------------------------------- notation

test('notation: dice, modifiers, keep and drop, advantage, rerolls', async () => {
  const { rollDice } = await dice();
  let r = rollDice('1d20+5', faces(12));
  assert.equal(r.expression, '1d20+5'); assert.equal(r.total, 17); assert.equal(r.crit, null);
  r = rollDice('d20', faces(20)); assert.equal(r.total, 20); assert.equal(r.crit, 'success');
  r = rollDice('d20 - 2', faces(1)); assert.equal(r.total, -1); assert.equal(r.crit, 'failure');
  r = rollDice('adv+3', faces(4, 15));
  assert.equal(r.expression, '2d20kh1+3'); assert.equal(r.total, 18);
  assert.deepEqual(r.terms[0].dice.map(d => d.kept), [false, true]);
  r = rollDice('DIS', faces(4, 15)); assert.equal(r.total, 4); assert.equal(r.crit, null);
  r = rollDice('4d6kh3', faces(1, 6, 3, 5)); assert.equal(r.total, 14);
  r = rollDice('4d6k3', faces(1, 6, 3, 5)); assert.equal(r.expression, '4d6kh3');
  r = rollDice('4d6dl1', faces(1, 6, 3, 5)); assert.equal(r.total, 14);
  r = rollDice('4d6dh1', faces(1, 6, 3, 5)); assert.equal(r.total, 9);
  r = rollDice('4d6kl2', faces(1, 6, 3, 5)); assert.equal(r.total, 4);
  r = rollDice('2d6+1d4+3', faces(2, 5, 4)); assert.equal(r.total, 14);
  r = rollDice('d%', faces(73)); assert.equal(r.expression, '1d100'); assert.equal(r.total, 73);
  // Great Weapon Fighting: reroll 1s and 2s once, keep the new face even if low.
  r = rollDice('2d6ro2', faces(1, 2, 6)); assert.deepEqual(r.terms[0].dice.map(d => [d.value, d.rerolled]), [[2, [1]], [6, []]]);
  // r: reroll until above.
  r = rollDice('1d6r2', faces(1, 2, 2, 5)); assert.equal(r.total, 5); assert.deepEqual(r.terms[0].dice[0].rerolled, [1, 2, 2]);
  // Two d20s kept (not advantage): no critical.
  assert.equal(rollDice('2d20', faces(20, 20)).crit, null);
});

test('notation: refuses malformed input and anything past the limits', async () => {
  const { rollDice, DiceError } = await dice();
  for (const bad of ['', '   ', 'hello', '1d20 5', '1d', 'd1', '0d6', '101d6', '1d1001', '3d6kh4', '3d6dl3', '1d6r6', '1d6r0',
    '1d20+', '++1d20', '20', '1d20+99999', 'x'.repeat(101), '1d6kh1kl1', '1d6r1ro1', '1d20;rm -rf', null, 42,
    Array.from({ length: 21 }, () => '1d4').join('+')]) {
    assert.throws(() => rollDice(bad), DiceError, `should refuse ${JSON.stringify(bad)}`);
  }
  // 100 dice is the ceiling, across all groups.
  assert.doesNotThrow(() => rollDice('50d6+50d6'));
  assert.throws(() => rollDice('50d6+50d6+1d4'), DiceError);
});

test('notation: real rolls stay in range and are roughly even', async () => {
  const { rollDice } = await dice();
  const counts = new Array(7).fill(0);
  for (let i = 0; i < 300; i++) for (const d of rollDice('20d6').terms[0].dice) counts[d.value]++;
  assert.equal(counts[0], 0);
  for (let f = 1; f <= 6; f++) assert.ok(counts[f] > 800 && counts[f] < 1200, `face ${f}: ${counts[f]} of 6000`);
  for (let i = 0; i < 200; i++) { const t = rollDice('1d20').total; assert.ok(t >= 1 && t <= 20); }
});

// ---------------------------------------------------------------- server

async function startServer({ strip = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-ttrpg-'));
  const serverDir = path.join(temp, 'server'); fs.mkdirSync(serverDir);
  for (const name of fs.readdirSync(path.join(root, 'server'))) {
    if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
  }
  fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
  fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
  fs.mkdirSync(path.join(serverDir, 'data'));
  const serverFile = path.join(serverDir, 'server.js');
  if (strip) {
    // Counterfactual: every reader sees every roll.
    const src = fs.readFileSync(serverFile, 'utf8');
    const marker = 'function rollView(roll, viewerId, table) {';
    assert.ok(src.includes(marker));
    fs.writeFileSync(serverFile, src.replace(marker, `${marker}\n  return { ...roll, hidden: false };`));
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

test('tables and dice against a disposable server', { timeout: 60000 }, async (t) => {
  const s = await startServer();
  const { call, waves } = s;
  try {
    await t.test('off by default: every route answers 403 until an admin turns it on', async () => {
      assert.equal((await call('gm', 'GET', `/api/waves/${waves.table}/table`)).status, 403);
      assert.equal((await call('gm', 'POST', `/api/waves/${waves.table}/rolls`, { expression: 'd20' })).status, 403);
      const on = await enableFeature(s); assert.equal(on.status, 200, JSON.stringify(on.body));
      const cfg = await call('ann', 'GET', '/api/instance-config');
      assert.equal(cfg.body.features?.ttrpg ?? cfg.body.config?.features?.ttrpg, true);
    });

    await t.test('only the wave\'s owner or admins set up a table; GMs must be in the wave', async () => {
      assert.equal((await call('ann', 'PUT', `/api/waves/${waves.table}/table`, { system: 'dnd5e-2024', defaultVisibility: 'gm' })).status, 403);
      assert.equal((await call('outsider', 'GET', `/api/waves/${waves.table}/table`)).status, 403);
      assert.equal((await call('gm', 'PUT', `/api/waves/${waves.table}/table`, { system: 'chess', defaultVisibility: 'gm' })).status, 400);
      assert.equal((await call('gm', 'PUT', `/api/waves/${waves.table}/table`, { system: 'dnd5e-2024', defaultVisibility: 'gm_secret' })).status, 400);
      const notIn = await call('gm', 'PUT', `/api/waves/${waves.table}/table`, { system: 'dnd5e-2024', defaultVisibility: 'gm', gms: ['outsider'] });
      assert.equal(notIn.status, 400); assert.equal(notIn.body.code, 'GM_NOT_IN_WAVE');
      const set = await call('gm', 'PUT', `/api/waves/${waves.table}/table`, { system: 'dnd5e-2024', defaultVisibility: 'gm' });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      assert.deepEqual(set.body.table.gms, ['gm']); assert.equal(set.body.table.isGm, true);
      const seen = await call('ann', 'GET', `/api/waves/${waves.table}/table`);
      assert.equal(seen.body.table.isGm, false); assert.equal(seen.body.table.defaultVisibility, 'gm');
      const fed = await call('gm', 'PUT', `/api/waves/${waves.federated}/table`, { system: 'dnd5e-2024', defaultVisibility: 'gm' });
      assert.equal(fed.status, 409); assert.equal(fed.body.code, 'TTRPG_LOCAL_ONLY');
    });

    let annDefault, gmSecret, bobPublic;
    await t.test('rolling: bad notation, not a table, outsiders, and only GMs roll in secret', async () => {
      const bad = await call('ann', 'POST', `/api/waves/${waves.table}/rolls`, { expression: '101d6' });
      assert.equal(bad.status, 400); assert.equal(bad.body.code, 'INVALID_DICE');
      assert.equal((await call('ann', 'POST', `/api/waves/${waves.other}/rolls`, { expression: 'd20' })).body.code, 'NOT_A_TABLE');
      assert.equal((await call('outsider', 'POST', `/api/waves/${waves.table}/rolls`, { expression: 'd20' })).status, 403);
      const secret = await call('ann', 'POST', `/api/waves/${waves.table}/rolls`, { expression: 'd20', visibility: 'gm_secret' });
      assert.equal(secret.status, 403); assert.equal(secret.body.code, 'GM_ONLY');
      const r1 = await call('ann', 'POST', `/api/waves/${waves.table}/rolls`, { expression: '1d20+5' });
      assert.equal(r1.status, 201, JSON.stringify(r1.body));
      assert.equal(r1.body.roll.visibility, 'gm', 'the table default'); assert.equal(typeof r1.body.roll.total, 'number');
      annDefault = r1.body.roll;
      gmSecret = (await call('gm', 'POST', `/api/waves/${waves.table}/rolls`, { expression: '2d6', visibility: 'gm_secret' })).body.roll;
      bobPublic = (await call('bob', 'POST', `/api/waves/${waves.table}/rolls`, { expression: 'adv+2', visibility: 'public' })).body.roll;
      assert.equal(bobPublic.expression, '2d20kh1+2');
    });

    await t.test('who sees what: roller and GMs see a GM roll, nobody else sees a result', async () => {
      const ids = [annDefault.id, gmSecret.id, bobPublic.id].join(',');
      const as = async (user) => Object.fromEntries((await call(user, 'GET', `/api/waves/${waves.table}/rolls?ids=${ids}`)).body.rolls.map(r => [r.id, r]));
      const ann = await as('ann'), bob = await as('bob'), gm = await as('gm');
      assert.equal(ann[annDefault.id].total, annDefault.total);
      assert.equal(gm[annDefault.id].total, annDefault.total);
      assert.equal(gm[gmSecret.id].hidden, false);
      // Bob: Ann's roll to the GM shows its dice, not its result; the GM's secret shows nothing.
      assert.equal(bob[annDefault.id].hidden, true); assert.equal(bob[annDefault.id].expression, '1d20+5');
      for (const r of [bob[annDefault.id], bob[gmSecret.id], ann[gmSecret.id]]) {
        assert.equal(r.total, undefined); assert.equal(r.terms, undefined); assert.equal(r.crit, undefined);
      }
      assert.equal(bob[gmSecret.id].expression, null);
      // Public: everyone.
      for (const v of [ann, bob, gm]) assert.equal(v[bobPublic.id].total, bobPublic.total);
      // The log follows the same rule, and can be one person's.
      const log = (await call('bob', 'GET', `/api/waves/${waves.table}/rolls`)).body.rolls;
      assert.equal(log.length, 3); assert.equal(log.filter(r => r.total !== undefined).length, 1);
      const annOnly = (await call('gm', 'GET', `/api/waves/${waves.table}/rolls?roller=ann`)).body.rolls;
      assert.deepEqual(annOnly.map(r => r.id), [annDefault.id]);
      assert.equal((await call('outsider', 'GET', `/api/waves/${waves.table}/rolls`)).status, 403);
    });

    await t.test('a roll goes on one ping, its roller\'s, in its own wave', async () => {
      const count = async () => (await call('gm', 'GET', `/api/waves/${waves.table}/pings`)).body;
      const before = await count();
      const n0 = (before.pings || before.messages || before).length;
      const stolen = await call('bob', 'POST', '/api/pings', { wave_id: waves.table, content: 'mine now', rollId: annDefault.id });
      assert.equal(stolen.status, 409); assert.equal(stolen.body.code, 'ROLL_UNAVAILABLE');
      const elsewhere = await call('ann', 'POST', '/api/pings', { wave_id: waves.other, content: 'wrong wave', rollId: annDefault.id });
      assert.equal(elsewhere.status, 409);
      const after = await count();
      assert.equal((after.pings || after.messages || after).length, n0, 'a refused roll leaves no ping behind');
      const ok = await call('ann', 'POST', '/api/pings', { wave_id: waves.table, content: 'Stealth', rollId: annDefault.id });
      assert.equal(ok.status, 201, JSON.stringify(ok.body)); assert.equal(ok.body.roll_id, annDefault.id);
      const again = await call('ann', 'POST', '/api/pings', { wave_id: waves.table, content: 'Stealth again', rollId: annDefault.id });
      assert.equal(again.status, 409);
      const list = await count();
      const ping = (list.pings || list.messages || list).find(p => p.id === ok.body.id);
      assert.equal(ping.roll_id, annDefault.id);
      const roll = (await call('gm', 'GET', `/api/waves/${waves.table}/rolls?ids=${annDefault.id}`)).body.rolls[0];
      assert.equal(roll.pingId, ok.body.id);
    });

    await t.test('switching the table off keeps the rolls; rolling then needs a table again', async () => {
      assert.equal((await call('ann', 'DELETE', `/api/waves/${waves.table}/table`)).status, 403);
      assert.equal((await call('gm', 'DELETE', `/api/waves/${waves.table}/table`)).status, 200);
      assert.equal((await call('gm', 'GET', `/api/waves/${waves.table}/table`)).body.table, null);
      assert.equal((await call('ann', 'POST', `/api/waves/${waves.table}/rolls`, { expression: 'd20' })).body.code, 'NOT_A_TABLE');
      // With no GMs left, a GM roll is the roller's alone.
      const bob = (await call('bob', 'GET', `/api/waves/${waves.table}/rolls`)).body.rolls;
      assert.equal(bob.length, 3);
      assert.equal(bob.find(r => r.id === annDefault.id).hidden, true);
    });
  } finally {
    s.stop();
  }
});

test('counterfactual: without rollView, a roll to the GM shows its result to other players', { timeout: 60000 }, async () => {
  const s = await startServer({ strip: true });
  try {
    await enableFeature(s);
    await s.call('gm', 'PUT', `/api/waves/${s.waves.table}/table`, { system: 'dnd5e-2024', defaultVisibility: 'gm' });
    const roll = (await s.call('ann', 'POST', `/api/waves/${s.waves.table}/rolls`, { expression: '1d20+5' })).body.roll;
    const seen = (await s.call('bob', 'GET', `/api/waves/${s.waves.table}/rolls?ids=${roll.id}`)).body.rolls[0];
    assert.equal(seen.total, roll.total, 'the stripped server leaks the hidden result, so the real test fails for the right reason');
  } finally {
    s.stop();
  }
});
