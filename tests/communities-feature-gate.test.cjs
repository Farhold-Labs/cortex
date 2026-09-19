'use strict';

// The Communities feature gate (v2.99.0, Phase 6).
//
// Communities is an OPT-IN instance feature: a node that upgrades must not wake
// up hosting one. That makes the gate the thing worth testing hardest, because
// the failure mode is a social surface appearing on somebody's server without
// them asking for it.
//
// CLAUDE.md's rule applies: hiding the UI is a courtesy, never the control. So
// these tests go at the API with the feature off and expect a refusal from
// every route, including the ones only a node admin can reach.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('Communities is off unless an operator switches it on', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-comm-gate-'));
  const password = 'FeatureGate123!';
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
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('GATE_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-community-gate-000000',
        SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/GATE_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/GATE_PORT=(\d+)/)[1]}`;

    const api = async (method, urlPath, { token, body, stepUp } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(stepUp ? { 'X-Step-Up-Token': stepUp } : {}),
        },
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, body: json };
    };
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', {
        body: { handle, email: `${handle}@example.test`, password, displayName: handle },
      });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      return { handle, token: login.body.token, id: login.body.user.id };
    };

    const admin = await makeUser('gateadmin');   // first user is the node admin
    const person = await makeUser('gateperson');

    const ROUTES = [
      ['GET', '/api/communities'],
      ['GET', '/api/communities/mine'],
      ['POST', '/api/communities'],
      ['GET', '/api/communities/some-id'],
      ['PATCH', '/api/communities/some-id'],
      ['DELETE', '/api/communities/some-id'],
      ['GET', '/api/communities/some-id/members'],
      ['POST', '/api/communities/some-id/members'],
      ['POST', '/api/communities/some-id/members/remote'],
      ['GET', '/api/communities/some-id/channels'],
      ['POST', '/api/communities/some-id/channels'],
      ['GET', '/api/communities/some-id/roles'],
      ['POST', '/api/communities/some-id/roles'],
      ['GET', '/api/communities/some-id/invites'],
      ['POST', '/api/communities/some-id/invites'],
      ['POST', '/api/communities/join'],
      ['GET', '/api/communities/some-id/audit'],
      ['GET', '/api/admin/communities'],
      ['POST', '/api/admin/communities/some-id/suspend'],
      ['DELETE', '/api/admin/communities/some-id'],
    ];

    await t.test('every route refuses while the feature is off, for everyone', async () => {
      // Including the node admin: a feature that is off is off, and an admin who
      // wants it on has a switch for that.
      for (const [method, url] of ROUTES) {
        for (const who of [person, admin]) {
          const res = await api(method, url, { token: who.token, body: {} });
          assert.equal(res.status, 403, `${method} ${url} for ${who.handle} returned ${res.status}`);
          assert.equal(res.body.code, 'FEATURE_DISABLED', `${method} ${url} refused for the wrong reason`);
          assert.equal(res.body.feature, 'communities');
        }
      }
    });

    await t.test('the public instance config does not advertise it as on', async () => {
      const res = await api('GET', '/api/instance-config');
      assert.equal(res.status, 200);
      const features = res.body.features || {};
      assert.notEqual(features.communities, true,
        'an opt-in feature must not read as enabled before anyone enables it');
    });

    let enabled = false;
    await t.test('an admin can switch it on', async () => {
      const stepRes = await api('POST', '/api/auth/step-up', { token: admin.token, body: { password } });
      const proof = stepRes.body.stepUpToken || stepRes.body.token;

      const res = await api('PUT', '/api/admin/instance-config', {
        token: admin.token, stepUp: proof,
        body: { features: { communities: true } },
      });
      // The exact admin endpoint shape is not the point of this test; if it
      // moved, say so rather than silently passing.
      assert.ok([200, 204].includes(res.status),
        `could not enable the feature (${res.status}): ${JSON.stringify(res.body)}`);
      enabled = true;
    });

    await t.test('and then the routes work again', async () => {
      assert.ok(enabled, 'precondition: the feature was enabled');
      const list = await api('GET', '/api/communities/mine', { token: person.token });
      assert.equal(list.status, 200, JSON.stringify(list.body));

      const created = await api('POST', '/api/communities', {
        token: person.token, body: { name: 'Switched On', slug: 'switched-on' },
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
    });

    await t.test('switching it back off closes the door again', async () => {
      const stepRes = await api('POST', '/api/auth/step-up', { token: admin.token, body: { password } });
      const proof = stepRes.body.stepUpToken || stepRes.body.token;
      await api('PUT', '/api/admin/instance-config', {
        token: admin.token, stepUp: proof, body: { features: { communities: false } },
      });

      const res = await api('GET', '/api/communities/mine', { token: person.token });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'FEATURE_DISABLED');
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
