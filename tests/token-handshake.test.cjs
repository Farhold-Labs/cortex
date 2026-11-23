'use strict';

// Nothing is retired until its replacement is known to have arrived (v2.146.1).
//
// A refresh token traded for a new one was retired on the spot. When the
// answer never reached the client (a tab unloaded mid-request, a phone
// frozen in the background) the client still held the old token, its next
// refresh presented it, and the server read that as theft: every session the
// account had was revoked. On farhold a person was signed out mid-sentence
// that way: their browser's swap at 12:59:53 was never received, and the
// replay 55 minutes later ended everything.
//
// Now a swap is complete only when the client shows it has the new token (by
// presenting it, or by using the access token sent with it). Until then the
// old one comes back with the SAME new token. Real theft is still caught: a
// token presented after its replacement was confirmed ends that login, and
// only that login. The same rule covers every other secret the server hands
// out in place of another: renewed sessions, MFA recovery codes, the E2EE
// recovery key and keypair, bot keys, calendar links and guest cancel links.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const password = 'Handshake123!';

async function startServer({ mutate } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-handshake-'));
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

  const dbPath = path.join(serverDir, 'data/farhold.db');
  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const seed = new DatabaseSQLite({ dbPath });
  const hash = serverRequire('bcryptjs').hashSync(password, 4);
  for (const id of ['admin', 'hbeck', 'other']) {
    seed.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: hash, displayName: id });
  }
  seed.db.prepare("UPDATE users SET role = 'admin' WHERE id = 'admin'").run();
  seed.db.close();

  const serverFile = path.join(serverDir, 'server.js');
  if (mutate) fs.writeFileSync(serverFile, mutate(fs.readFileSync(serverFile, 'utf8')));
  fs.appendFileSync(serverFile,
    "\nserver.on('listening', () => console.log('HANDSHAKE_PORT=' + server.address().port));\n");

  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
      USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-handshake-000000000000',
      SEED_DEMO_DATA: 'false',
      RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      RATE_LIMIT_REFRESH_MAX: '10000', RATE_LIMIT_MFA_MAX: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', b => { output += b; });
  child.stderr.on('data', b => { output += b; });

  const deadline = Date.now() + 25000;
  while (!/HANDSHAKE_PORT=(\d+)/.test(output)) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
    await new Promise(r => setTimeout(r, 50));
  }
  const base = `http://127.0.0.1:${output.match(/HANDSHAKE_PORT=(\d+)/)[1]}`;

  const api = async (method, urlPath, { token, body, headers = {} } = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  };

  // A device logging in, as the app does: with refresh tokens.
  const login = async (handle, extra = {}) => {
    const res = await api('POST', '/api/auth/login', { body: { handle, password, supportsRefresh: true, ...extra } });
    assert.equal(res.status, 200, `login failed for ${handle}: ${JSON.stringify(res.body)}`);
    return res.body;
  };
  const refresh = (refreshToken) => api('POST', '/api/auth/token/refresh', { body: { refreshToken } });
  const me = (token) => api('GET', '/api/auth/me', { token });

  const stop = () => {
    child.kill('SIGTERM');
    fs.rmSync(temp, { recursive: true, force: true });
  };
  return { api, login, refresh, me, stop, dbPath, output: () => output };
}

test('a refresh swap is retired only once the client has the new token', { timeout: 180000 }, async (t) => {
  const s = await startServer();
  try {
    await t.test('a lost answer: the old token gets the same new one, and nobody is signed out', async () => {
      const browser = await s.login('hbeck');
      const phone = await s.login('hbeck');

      // The swap happens, but its answer never reaches the browser.
      const lost = await s.refresh(browser.refreshToken);
      assert.equal(lost.status, 200);

      // 55 minutes later the browser presents the token it still has.
      const replay = await s.refresh(browser.refreshToken);
      assert.equal(replay.status, 200, `the replay was refused: ${JSON.stringify(replay.body)}`);
      assert.equal(replay.body.refreshToken, lost.body.refreshToken, 'the same new token, not a second one');

      assert.equal((await s.me(replay.body.token)).status, 200, 'the browser carries on');
      assert.equal((await s.me(phone.token)).status, 200, 'the phone was never touched');
      assert.equal((await s.refresh(phone.refreshToken)).status, 200);
    });

    await t.test('two tabs presenting the same token at once both get the same new one', async () => {
      const tab = await s.login('hbeck');
      const [a, b] = await Promise.all([s.refresh(tab.refreshToken), s.refresh(tab.refreshToken)]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal(a.body.refreshToken, b.body.refreshToken);
    });

    await t.test('once the new token is confirmed, presenting the old one is theft: that login ends, no other', async () => {
      const victim = await s.login('hbeck');
      const otherDevice = await s.login('hbeck');
      const swap = await s.refresh(victim.refreshToken);
      // The receipt: the access token that came with the new refresh token is used.
      const receipt = await s.api('POST', '/api/auth/token/confirm', { token: swap.body.token });
      assert.equal(receipt.status, 200);
      assert.equal(receipt.body.confirmed, true);

      const stolen = await s.refresh(victim.refreshToken);
      assert.equal(stolen.status, 401);
      assert.equal(stolen.body.code, 'SESSION_REVOKED');

      assert.equal((await s.me(swap.body.token)).status, 401, "the victim's login is over");
      assert.equal((await s.refresh(swap.body.refreshToken)).status, 401, 'its newest token too');
      assert.equal((await s.me(otherDevice.token)).status, 200, 'another device is a different login');
      assert.equal((await s.refresh(otherDevice.refreshToken)).status, 200);
    });

    await t.test('any request with the new access token is a receipt, not only the confirm call', async () => {
      const device = await s.login('hbeck');
      const swap = await s.refresh(device.refreshToken);
      assert.equal((await s.me(swap.body.token)).status, 200);
      assert.equal((await s.refresh(device.refreshToken)).status, 401);
    });

    await t.test('presenting the new refresh token is a receipt too', async () => {
      const device = await s.login('hbeck');
      const first = await s.refresh(device.refreshToken);
      assert.equal((await s.refresh(first.body.refreshToken)).status, 200);
      assert.equal((await s.refresh(device.refreshToken)).status, 401);
    });

    await t.test('a thief who redeems first is still caught when the person comes back', async () => {
      const person = await s.login('hbeck');
      // The thief copies the token, redeems it, and uses what came back.
      const thief = await s.refresh(person.refreshToken);
      assert.equal((await s.me(thief.body.token)).status, 200);
      // The person's own refresh presents the token the thief already traded.
      const back = await s.refresh(person.refreshToken);
      assert.equal(back.status, 401);
      assert.equal((await s.refresh(thief.body.refreshToken)).status, 401, "the thief's token died with the login");
      assert.equal((await s.me(thief.body.token)).status, 401);
    });

    await t.test('a replay to a login already ended does not end the next one', async () => {
      const first = await s.login('hbeck');
      const swap = await s.refresh(first.refreshToken);
      await s.me(swap.body.token);
      assert.equal((await s.refresh(first.refreshToken)).status, 401);
      const again = await s.login('hbeck');
      // The stale tab keeps trying its dead token.
      assert.equal((await s.refresh(first.refreshToken)).status, 401);
      assert.equal((await s.me(again.token)).status, 200, 'the new login survives');
    });

    await t.test('the pending token is stored sealed, never in the clear, and dropped once confirmed', async () => {
      const device = await s.login('other');
      const swap = await s.refresh(device.refreshToken);
      const Database = serverRequire('better-sqlite3');
      const db = new Database(s.dbPath, { readonly: true });
      try {
        const rows = db.prepare("SELECT pending_secret FROM refresh_tokens WHERE pending_secret IS NOT NULL").all();
        assert.ok(rows.length >= 1);
        for (const r of rows) assert.ok(!r.pending_secret.includes(swap.body.refreshToken));
        await s.me(swap.body.token);
        const left = db.prepare(`SELECT pending_secret FROM refresh_tokens WHERE user_id = 'other' AND pending_secret IS NOT NULL`).all();
        assert.equal(left.length, 0);
      } finally {
        db.close();
      }
    });

    await t.test('a renewed or re-authenticated session retires the old one only when the new one is used', async () => {
      const legacy = await s.api('POST', '/api/auth/login', { body: { handle: 'other', password } });
      const renewed = await s.api('POST', '/api/auth/renew', { token: legacy.body.token });
      assert.equal(renewed.status, 200);
      assert.equal((await s.me(legacy.body.token)).status, 200, 'the old token works while the new one is unproven');
      assert.equal((await s.me(renewed.body.token)).status, 200);
      assert.equal((await s.me(legacy.body.token)).status, 401, 'retired once the new one was used');

      const reauth = await s.api('POST', '/api/auth/refresh', { token: renewed.body.token, body: { password } });
      assert.equal(reauth.status, 200);
      assert.equal((await s.me(renewed.body.token)).status, 200);
      assert.equal((await s.me(reauth.body.token)).status, 200);
      assert.equal((await s.me(renewed.body.token)).status, 401);
    });
  } finally {
    s.stop();
  }
});

test('counterfactual: retiring at the swap signs a person out for a lost answer', { timeout: 120000 }, async () => {
  const s = await startServer({
    mutate: (src) => {
      const fix = 'const secret = child && !child.confirmedAt ? openSwapSecret(child.pendingSecret) : null;';
      assert.ok(src.includes(fix), 'the fix moved; update the counterfactual');
      return src.replace(fix, 'const secret = null;');
    },
  });
  try {
    const browser = await s.login('hbeck');
    await s.refresh(browser.refreshToken);              // answer lost
    const replay = await s.refresh(browser.refreshToken);
    assert.equal(replay.status, 401, 'without the handshake the replay ends the login');
    assert.equal(replay.body.code, 'SESSION_REVOKED');
  } finally {
    s.stop();
  }
});

test('regenerated secrets wait for their receipt', { timeout: 180000 }, async (t) => {
  const s = await startServer();
  const { authenticator } = serverRequire('otplib');
  try {
    await t.test('MFA recovery codes: the old set works until the new one is confirmed or used', async () => {
      const { token } = await s.login('hbeck');
      const setup = await s.api('POST', '/api/auth/mfa/totp/setup', { token });
      assert.equal(setup.status, 200);
      const secret = setup.body.secret;
      const enabled = await s.api('POST', '/api/auth/mfa/totp/verify', { token, body: { code: authenticator.generate(secret) } });
      assert.equal(enabled.status, 200);
      const oldCodes = enabled.body.recoveryCodes;
      assert.equal(enabled.body.pendingConfirm, false, 'the first set has nothing to replace');

      const regen = await s.api('POST', '/api/auth/mfa/recovery/regenerate', {
        token, body: { password, mfaMethod: 'totp', mfaCode: authenticator.generate(secret) },
      });
      assert.equal(regen.status, 200);
      assert.equal(regen.body.pendingConfirm, true);
      const newCodes = regen.body.recoveryCodes;

      const signInWith = async (code) => {
        const started = await s.api('POST', '/api/auth/login', { body: { handle: 'hbeck', password, supportsRefresh: true } });
        assert.equal(started.body.mfaRequired, true);
        return s.api('POST', '/api/auth/mfa/verify', { body: { challengeId: started.body.mfaChallenge, method: 'recovery', code } });
      };

      assert.equal((await signInWith(oldCodes[0])).status, 200, 'an old code still works before confirmation');
      assert.equal((await signInWith(newCodes[0])).status, 200, 'a new code works, and using it is the receipt');
      assert.equal((await signInWith(oldCodes[1])).status, 400, 'the old set is retired now');
      assert.equal((await signInWith(newCodes[0])).status, 400, 'a used code stays used');
      assert.equal((await signInWith(newCodes[1])).status, 200);

      // And by explicit confirmation.
      const again = await s.api('POST', '/api/auth/mfa/recovery/regenerate', {
        token, body: { password, mfaMethod: 'totp', mfaCode: authenticator.generate(secret) },
      });
      assert.equal((await s.api('POST', '/api/auth/mfa/recovery/confirm', { token })).body.confirmed, true);
      assert.equal((await signInWith(newCodes[2])).status, 400);
      assert.equal((await signInWith(again.body.recoveryCodes[0])).status, 200);
    });

    await t.test('E2EE recovery key: the old blob stays until the person confirms the new one', async () => {
      const { token } = await s.login('other');
      await s.api('POST', '/api/e2ee/recovery/setup', { token, body: { encryptedPrivateKey: 'OLD-BLOB', recoverySalt: 'old-salt' } });
      const regen = await s.api('POST', '/api/e2ee/recovery/regenerate', { token, body: { encryptedPrivateKey: 'NEW-BLOB', recoverySalt: 'new-salt' } });
      assert.equal(regen.status, 200);
      assert.equal(regen.body.pendingConfirm, true);

      let info = await s.api('GET', '/api/e2ee/recovery', { token });
      assert.equal(info.body.encryptedPrivateKey, 'OLD-BLOB', 'the current key is unchanged');
      assert.equal(info.body.pending.encryptedPrivateKey, 'NEW-BLOB', 'the new one travels beside it');

      assert.equal((await s.api('POST', '/api/e2ee/recovery/confirm', { token })).body.confirmed, true);
      info = await s.api('GET', '/api/e2ee/recovery', { token });
      assert.equal(info.body.encryptedPrivateKey, 'NEW-BLOB');
      assert.equal(info.body.pending, null);

      // Wiping the keys wipes a key still waiting too: it wraps the keys wiped.
      await s.api('POST', '/api/e2ee/recovery/regenerate', { token, body: { encryptedPrivateKey: 'STALE-BLOB', recoverySalt: 'x' } });
      assert.equal((await s.api('POST', '/api/e2ee/keys/reset', { token })).status, 200);
      await s.api('POST', '/api/e2ee/recovery/setup', { token, body: { encryptedPrivateKey: 'FRESH-BLOB', recoverySalt: 'y' } });
      info = await s.api('GET', '/api/e2ee/recovery', { token });
      assert.equal(info.body.encryptedPrivateKey, 'FRESH-BLOB', 'a fresh setup after a reset takes effect at once');
      assert.equal(info.body.pending, null, 'no stale key waiting');
      assert.equal((await s.api('POST', '/api/e2ee/recovery/confirm', { token })).body.confirmed, false);
    });

    await t.test('bot keys: the old key works until the new one is used, or an admin retires it', async () => {
      const { token } = await s.login('admin');
      const created = await s.api('POST', '/api/admin/bots', { token, body: { name: 'handshake-bot' } });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const botId = created.body.bot.id;
      const oldKey = created.body.bot.apiKey || created.body.apiKey;

      const regen = await s.api('POST', `/api/admin/bots/${botId}/regenerate`, { token });
      assert.equal(regen.body.oldKeyActive, true);
      const newKey = regen.body.apiKey;

      assert.equal((await s.api('GET', '/api/bot/waves', { token: oldKey })).status, 200, 'old key still works');
      assert.equal((await s.api('GET', '/api/bot/waves', { token: newKey })).status, 200, 'the new key, first use');
      assert.equal((await s.api('GET', '/api/bot/waves', { token: oldKey })).status, 403, 'old key retired by that use');

      const regen2 = await s.api('POST', `/api/admin/bots/${botId}/regenerate`, { token });
      const retire = await s.api('POST', `/api/admin/bots/${botId}/regenerate/confirm`, { token });
      assert.equal(retire.body.retiredOld, true);
      assert.equal((await s.api('GET', '/api/bot/waves', { token: newKey })).status, 403, 'retired on the admin\'s word');
      assert.equal((await s.api('GET', '/api/bot/waves', { token: regen2.body.apiKey })).status, 200);
    });

    // The feed itself never answered before v2.146.1: /api/events/:id was
    // registered first and refused it for want of a login.
    await t.test('calendar links: the old link works until the new one is fetched', async () => {
      const { token } = await s.login('other');
      const first = await s.api('GET', '/api/user/calendar-feed', { token });
      const oldLink = first.body.token;
      const regen = await s.api('POST', '/api/user/calendar-feed/regenerate', { token });
      assert.equal(regen.body.oldLinkActive, true);
      assert.equal((await s.api('GET', `/api/events/feed.ics?token=${oldLink}`)).status, 200);
      assert.equal((await s.api('GET', `/api/events/feed.ics?token=${regen.body.token}`)).status, 200);
      assert.equal((await s.api('GET', `/api/events/feed.ics?token=${oldLink}`)).status, 401);
    });

    await t.test('an unconfirmed keypair rotation changes nothing until confirmed', async () => {
      const { token } = await s.login('admin');
      await s.api('POST', '/api/e2ee/keys/register', { token, body: { publicKey: 'UFVCMQ==', encryptedPrivateKey: 'UFJJVjE=', salt: 'c2FsdDE=' } });
      const rotate = await s.api('POST', '/api/e2ee/keys/rotate', { token, body: { publicKey: 'UFVCMg==', encryptedPrivateKey: 'UFJJVjI=', salt: 'c2FsdDI=' } });
      assert.equal(rotate.body.pendingConfirm, true);
      assert.equal((await s.api('GET', '/api/e2ee/keys/me', { token })).body.publicKey, 'UFVCMQ==');
      assert.equal((await s.api('POST', '/api/e2ee/keys/rotate/confirm', { token })).body.confirmed, true);
      assert.equal((await s.api('GET', '/api/e2ee/keys/me', { token })).body.publicKey, 'UFVCMg==');
    });
  } finally {
    s.stop();
  }
});

test('database: guest cancel links all keep working, and handovers go with the account', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-handshake-db-'));
  try {
    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const db = new DatabaseSQLite({ dbPath: path.join(temp, 'farhold.db') });
    const now = new Date().toISOString();
    db.createUser({ id: 'u1', handle: 'u1', email: 'u1@example.test', passwordHash: 'x', displayName: 'u1' });
    db.db.pragma('foreign_keys = OFF');
    db.db.prepare(`INSERT INTO event_rsvp_guest (id, event_id, name, email_hash, created_at) VALUES ('g1', 'ev1', 'Guest', 'h1', ?)`).run(now);
    db.db.pragma('foreign_keys = ON');

    const sha = (v) => require('node:crypto').createHash('sha256').update(v).digest('hex');
    const first = db.rotateGuestCancelToken('g1');
    db.rotateGuestCancelToken('g1');   // a later reminder, perhaps never delivered
    assert.equal(db.cancelGuestRsvpByToken(sha(first)), true, "the first email's link still cancels");

    db.setHandover('mfa-recovery-codes', 'u1', { hashes: ['a'] });
    db.storeRecoveryCodes('u1', []);   // an admin's MFA reset
    assert.equal(db.getHandover('mfa-recovery-codes', 'u1'), null, 'a waiting code set goes with the reset');

    db.setHandover('e2ee-recovery-key', 'u1', { encryptedPrivateKey: 'blob', recoverySalt: 's' });
    db.deleteUserAccount('u1');
    assert.equal(db.getHandover('e2ee-recovery-key', 'u1'), null, 'no recovery blob outlives the account');
    db.db.close();
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
