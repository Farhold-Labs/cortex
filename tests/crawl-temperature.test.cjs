'use strict';

// The crawl can show °F, °C, or both (v2.120.0). It only ever showed °F.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const password = 'Temperature123!';

test('formatTemperature shows one scale or both, in the chosen order', async () => {
  const { formatTemperature } = await import('../client/src/utils/temperature.js');
  const w = { temp: 71, tempC: 22 };
  assert.equal(formatTemperature(w, 'F'), '71°F');
  assert.equal(formatTemperature(w, 'C'), '22°C');
  assert.equal(formatTemperature(w, 'CF'), '22°C / 71°F');
  assert.equal(formatTemperature(w, 'FC'), '71°F / 22°C');
  // No preference, or one this client does not know, is the old behaviour.
  assert.equal(formatTemperature(w), '71°F');
  assert.equal(formatTemperature(w, 'K'), '71°F');
  // A reading cached before the server sent tempC is converted here.
  assert.equal(formatTemperature({ temp: 32 }, 'C'), '0°C');
  assert.equal(formatTemperature({ temp: -40 }, 'CF'), '-40°C / -40°F');
});

test('the temperature preference is stored, validated and kept', { timeout: 120000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-temp-units-'));
  let child;

  try {
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

    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    const hash = serverRequire('bcryptjs').hashSync(password, 4);
    seed.createUser({ id: 'traveller', handle: 'traveller', email: 'traveller@example.test', passwordHash: hash, displayName: 'traveller' });
    seed.db.close();

    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('TEMP_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-temperature-000000000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 25000;
    while (!/TEMP_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/TEMP_PORT=(\d+)/)[1]}`;

    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* no body */ }
      return { status: res.status, body: json };
    };

    const loggedIn = await api('POST', '/api/auth/login', { body: { handle: 'traveller', password } });
    assert.equal(loggedIn.status, 200, JSON.stringify(loggedIn.body));
    const token = loggedIn.body.token;
    const stored = async () => (await api('GET', '/api/auth/me', { token })).body?.preferences?.crawlBar || {};

    await t.test('saves each of the four choices', async () => {
      for (const units of ['C', 'CF', 'FC', 'F']) {
        const res = await api('PUT', '/api/profile/preferences', { token, body: { crawlBar: { tempUnits: units } } });
        assert.equal(res.status, 200, JSON.stringify(res.body));
        assert.equal((await stored()).tempUnits, units);
      }
    });

    await t.test('refuses an unknown value and keeps the last choice', async () => {
      await api('PUT', '/api/profile/preferences', { token, body: { crawlBar: { tempUnits: 'CF' } } });
      for (const bad of ['K', '<b>C</b>', 42, null]) {
        await api('PUT', '/api/profile/preferences', { token, body: { crawlBar: { tempUnits: bad } } });
        assert.equal((await stored()).tempUnits, 'CF', `after ${JSON.stringify(bad)}`);
      }
    });

    await t.test('another crawl setting does not reset it', async () => {
      await api('PUT', '/api/profile/preferences', { token, body: { crawlBar: { scrollSpeed: 'fast' } } });
      const after = await stored();
      assert.equal(after.tempUnits, 'CF');
      assert.equal(after.scrollSpeed, 'fast');
    });

    await t.test('the older crawl-preferences route keeps and validates it too', async () => {
      let res = await api('PUT', '/api/profile/crawl-preferences', { token, body: { showNews: false } });
      assert.equal(res.status, 200);
      assert.equal(res.body.crawlBar.tempUnits, 'CF');
      res = await api('PUT', '/api/profile/crawl-preferences', { token, body: { tempUnits: 'C' } });
      assert.equal(res.body.crawlBar.tempUnits, 'C');
      res = await api('PUT', '/api/profile/crawl-preferences', { token, body: { tempUnits: 'nonsense' } });
      assert.equal(res.body.crawlBar.tempUnits, 'C');
      assert.equal((await stored()).tempUnits, 'C');
    });
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise(r => child.once('exit', r));
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
