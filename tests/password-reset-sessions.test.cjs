'use strict';

// v2.150.1 [SECURITY]: resetting a password by email ends every session.
//
// Changing a password in Settings has ended every other session since
// v2.75.0. Resetting it from the "forgot password" email never did, so
// someone who reset because they thought their account was taken left the
// intruder signed in, and a browser still holding the encryption key from
// before carried on with it (found 2026-11-24 when a fingerprint could not be
// made in a browser left signed in across a reset).
//
// Counterfactual: a copy of server.js without the revocation keeps the old
// session working after the reset.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const nodeCrypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const password = 'BeforeReset123!';
const REVOCATION = "      if (db.revokeAllUserSessions) db.revokeAllUserSessions(tokenResult.userId);\n";

async function scenario(stripFix) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-reset-'));
  let child;
  try {
    const serverDir = path.join(temp, 'server');
    fs.mkdirSync(serverDir);
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));
    const file = path.join(serverDir, 'server.js');
    let src = fs.readFileSync(file, 'utf8');
    if (stripFix) {
      assert.ok(src.includes(REVOCATION), 'revocation not found in server.js');
      src = src.split(REVOCATION).join('').split("      if (db.revokeAllRefreshTokensForUser) db.revokeAllRefreshTokensForUser(tokenResult.userId, 'password-reset');\n").join('');
    }
    fs.writeFileSync(file, src + "\nserver.on('listening', () => console.log('RESET_PORT=' + server.address().port));\n");

    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    seed.createUser({ id: 'resetter', handle: 'resetter', email: 'resetter@example.test', passwordHash: serverRequire('bcryptjs').hashSync(password, 4), displayName: 'resetter' });
    const resetToken = nodeCrypto.randomBytes(32).toString('hex');
    seed.createPasswordResetToken('resetter', nodeCrypto.createHash('sha256').update(resetToken).digest('hex'));
    seed.db.close();

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-password-reset-0000000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/RESET_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/RESET_PORT=(\d+)/)[1]}`;
    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, body: json };
    };

    const login = await api('POST', '/api/auth/login', { body: { handle: 'resetter', password } });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const old = login.body.token;
    assert.equal((await api('GET', '/api/waves', { token: old })).status, 200, 'precondition: signed in');

    const reset = await api('POST', '/api/auth/reset-password', { body: { token: resetToken, newPassword: 'AfterReset456!', confirmPassword: 'AfterReset456!' } });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));

    const after = await api('GET', '/api/waves', { token: old });
    const refreshed = await api('POST', '/api/auth/refresh', { token: old, body: { refreshToken: login.body.refreshToken } });
    const fresh = await api('POST', '/api/auth/login', { body: { handle: 'resetter', password: 'AfterReset456!' } });
    return { after: after.status, afterCode: after.body?.code, afterBody: after.body, refreshed: refreshed.status, fresh: fresh.status };
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('a password reset signs out every session, and can\'t be refreshed back', { timeout: 120000 }, async () => {
  const r = await scenario(false);
  assert.equal(r.after, 401, 'the session from before the reset must end');
  assert.equal(r.afterBody?.error, 'Session revoked', JSON.stringify(r.afterBody));
  assert.notEqual(r.refreshed, 200, 'nor be renewed with its refresh token');
  assert.equal(r.fresh, 200, 'the new password signs in');
});

test('counterfactual: without the revocation, the old session survives the reset', { timeout: 120000 }, async () => {
  const r = await scenario(true);
  assert.equal(r.after, 200, 'with the fix stripped, the old session should still work');
});
