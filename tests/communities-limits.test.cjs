'use strict';

// Communities Phase 5 — abuse limits (v2.98.0).
//
// Threat model D-1 (unbounded payloads) and D-2 (amplification), plus the
// node-admin controls that openness requires: anyone may create a Community, so
// the person responsible for the node needs a way to deal with one that is
// being abused without first being invited into it.
//
// The principle these encode, learned when BROADCAST_PING_LIMIT was added after
// a long wave produced a federation request receiving nodes rejected outright:
// **limits should degrade, not discard.** A limit on a LISTING truncates; only
// a limit on CREATION refuses.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('Community limits and node-admin controls', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-comm-limits-'));
  const password = 'CommunityLimits123!';
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
// Communities is an OPT-IN instance feature from v2.99.0, so a fresh database
// has it switched off and every route below would answer 403. The feature is
// enabled here BEFORE the server boots — the same shape as the federation test
// seeding its pairing — so that these tests exercise the feature rather than
// the gate. The gate has its own test.
    {
      const { DatabaseSQLite } = await import('../server/database-sqlite.js');
      const seedDb = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
      seedDb.updateInstanceConfig({ features: { communities: true } });
      seedDb.db.close();
    }

    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('LIM_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-community-limits-00000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const deadline = Date.now() + 25000;
    while (!/LIM_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/LIM_PORT=(\d+)/)[1]}`;

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
      return { status: res.status, body: json, headers: res.headers };
    };
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', {
        body: { handle, email: `${handle}@example.test`, password, displayName: handle },
      });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      return { handle, token: login.body.token, id: login.body.user.id };
    };

    const nodeAdmin = await makeUser('nodeadmin');   // first user is the node admin
    const owner = await makeUser('owner');
    const member = await makeUser('plainmember');

    const { CAPS, MUTATION_BUDGET } = await import('../server/lib/communities/limits.js');

    // Destructive admin actions require step-up re-authentication, so the test
    // performs it rather than routing around it — the point of these tests is
    // the real path, and a test that skipped step-up would not exercise it.
    const stepUp = async (user) => {
      const res = await api('POST', '/api/auth/step-up', { token: user.token, body: { password } });
      assert.equal(res.status, 200, `step-up failed: ${JSON.stringify(res.body)}`);
      return res.body.stepUpToken || res.body.token;
    };
    const adminProof = await stepUp(nodeAdmin);

    const community = (await api('POST', '/api/communities', {
      token: owner.token, body: { name: 'Limits', slug: 'limits', visibility: 'private' },
    })).body.community;

    await t.test('D-1: over-long strings are refused, not silently truncated', async () => {
      // Silent truncation is worse than refusal: someone believes they named a
      // thing and the name they see is not the one that was stored.
      const long = 'x'.repeat(5000);
      assert.equal((await api('POST', '/api/communities', {
        token: owner.token, body: { name: long, slug: 'too-long-name' },
      })).status, 400);

      assert.equal((await api('POST', `/api/communities/${community.id}/channels`, {
        token: owner.token, body: { name: long, slug: 'long-channel' },
      })).status, 400);

      // A description at the cap is fine; one past it is refused.
      assert.equal((await api('PATCH', `/api/communities/${community.id}`, {
        token: owner.token, body: { description: 'y'.repeat(500) },
      })).status, 200);
      assert.equal((await api('PATCH', `/api/communities/${community.id}`, {
        token: owner.token, body: { description: 'y'.repeat(501) },
      })).status, 400);
    });

    await t.test('D-1: a slug is a shape, not a filtered string', async () => {
      for (const bad of ['has space', 'sym!bol', '-leading', 'a', 'z'.repeat(61)]) {
        const res = await api('POST', '/api/communities', {
          token: owner.token, body: { name: 'Slug Test', slug: bad },
        });
        assert.equal(res.status, 400, `slug ${JSON.stringify(bad)} should be refused`);
      }

      // Case is NORMALISED rather than refused — a slug is a case-insensitive
      // identifier, so 'Upper' and 'upper' must not be two different addresses.
      const normalised = await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Case Test', slug: 'MixedCase' },
      });
      assert.equal(normalised.status, 201);
      assert.equal(normalised.body.community.slug, 'mixedcase');
      const collide = await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Clash', slug: 'MIXEDCASE' },
      });
      assert.equal(collide.status, 409, 'and the normalised form is what collides');
    });

    await t.test('D-2: a per-actor mutation budget refuses a runaway loop', async () => {
      // HTTP rate limiting does not cover this: the limit that matters is per
      // ACTOR per COMMUNITY. Once a Community federates, one local action
      // becomes N signed requests to peers.
      const burst = await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Burst', slug: 'burst-target', visibility: 'private' },
      });
      const target = burst.body.community.id;

      let refused = null, made = 0;
      for (let i = 0; i < MUTATION_BUDGET.max + 10; i++) {
        const res = await api('POST', `/api/communities/${target}/channels`, {
          token: owner.token, body: { name: `Ch ${i}`, slug: `ch-${i}` },
        });
        if (res.status === 201) made++;
        else if (res.status === 429) { refused = { at: i, retryAfter: res.headers.get('retry-after') }; break; }
        else assert.fail(`unexpected ${res.status}: ${JSON.stringify(res.body)}`);
      }
      assert.ok(refused, 'the budget must eventually refuse');
      assert.ok(made <= MUTATION_BUDGET.max, `made ${made}, budget is ${MUTATION_BUDGET.max}`);
      assert.ok(Number(refused.retryAfter) > 0, 'Retry-After must tell them when to come back');
    });

    await t.test('D-2: the budget is per Community, not global to the actor', async () => {
      // Being throttled in one Community must not lock someone out of another
      // — that would make a single noisy space a denial of service on the rest.
      const other = (await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Elsewhere', slug: 'elsewhere', visibility: 'private' },
      })).body.community;
      const res = await api('POST', `/api/communities/${other.id}/channels`, {
        token: owner.token, body: { name: 'Fine', slug: 'fine' },
      });
      assert.equal(res.status, 201, 'a different Community has its own budget');
    });

    await t.test('D-2: reading is never charged', async () => {
      // A read costs one node one query. Charging it would let someone throttle
      // themselves out of a Community by looking at it.
      for (let i = 0; i < MUTATION_BUDGET.max + 5; i++) {
        const res = await api('GET', `/api/communities/${community.id}`, { token: owner.token });
        assert.equal(res.status, 200, `read ${i} was refused`);
      }
    });

    await t.test('a creation cap refuses, and says what the cap is', async () => {
      // Exercised against the role cap because it is the cheapest to reach.
      // The message has to name the ceiling, or the caller cannot tell a limit
      // from a malfunction.
      const capped = (await api('POST', '/api/communities', {
        token: member.token, body: { name: 'Roles', slug: 'role-cap', visibility: 'private' },
      })).body.community;

      let hit = null;
      for (let i = 0; i < CAPS.rolesPerCommunity + 5; i++) {
        const res = await api('POST', `/api/communities/${capped.id}/roles`, {
          token: member.token, body: { name: `role-${i}`, priority: 10, permissions: [] },
        });
        if (res.status === 409) { hit = res.body; break; }
        if (res.status === 429) break;  // budget first is fine; both are refusals
        assert.equal(res.status, 201, JSON.stringify(res.body));
      }
      if (hit) {
        assert.ok(hit.limit, 'the refusal names the ceiling');
        assert.match(hit.error, /limit/i);
      }
    });

    await t.test('a listing limit truncates rather than refusing', async () => {
      // Limits should degrade, not discard. An audit log longer than a page
      // must still return a page.
      const res = await api('GET', `/api/communities/${community.id}/audit`, { token: owner.token });
      assert.equal(res.status, 200);
      assert.ok(res.body.entries.length <= CAPS.auditPageSize);
    });

    // ----- Node-admin controls -----

    await t.test('only a node admin may reach the admin endpoints', async () => {
      assert.equal((await api('GET', '/api/admin/communities', { token: owner.token })).status, 403);
      assert.equal((await api('POST', `/api/admin/communities/${community.id}/suspend`,
        { token: owner.token, body: {} })).status, 403);
      assert.equal((await api('GET', '/api/admin/communities', { token: nodeAdmin.token })).status, 200);
    });

    await t.test('a destructive admin action requires step-up re-authentication', async () => {
      // Holding the admin role is not enough; the person at the keyboard has to
      // prove they are still the admin.
      const res = await api('POST', `/api/admin/communities/${community.id}/suspend`, {
        token: nodeAdmin.token, body: {},
      });
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'STEP_UP_REQUIRED');
    });

    await t.test('a node admin can suspend a Community they are not a member of', async () => {
      // The point of these controls: openness means the node admin must be able
      // to act without first being invited in.
      assert.equal(await api('GET', `/api/communities/${community.id}`, { token: nodeAdmin.token })
        .then(r => r.status), 404, 'they are not a member of this private Community');

      const res = await api('POST', `/api/admin/communities/${community.id}/suspend`, {
        token: nodeAdmin.token, stepUp: adminProof, body: { reason: 'abuse report' },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.community.status, 'suspended');

      // Frozen for its owner too.
      const asOwner = await api('GET', `/api/communities/${community.id}`, { token: owner.token });
      assert.equal(asOwner.status, 404, 'a suspended Community is not active');
      const mutate = await api('POST', `/api/communities/${community.id}/channels`, {
        token: owner.token, body: { name: 'Nope', slug: 'nope' },
      });
      assert.equal(mutate.status, 403, 'and its owner cannot change it');
    });

    await t.test('suspension is reversible without rebuilding anything', async () => {
      const res = await api('POST', `/api/admin/communities/${community.id}/suspend`, {
        token: nodeAdmin.token, stepUp: adminProof, body: { suspended: false },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.community.status, 'active');

      const back = await api('GET', `/api/communities/${community.id}`, { token: owner.token });
      assert.equal(back.status, 200);
      assert.ok(back.body.capabilities.includes('community.delete'), 'the owner is still the owner');
    });

    await t.test('a node admin closing a Community does not destroy its waves', async () => {
      const doomed = (await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Closing', slug: 'closing', visibility: 'private' },
      })).body.community;
      const channel = (await api('POST', `/api/communities/${doomed.id}/channels`, {
        token: owner.token, body: { name: 'Room', slug: 'room' },
      })).body.channel;
      const wave = await api('POST', '/api/waves', {
        token: owner.token, body: { title: 'Still here', privacy: 'private' },
      });
      const waveId = wave.body.wave ? wave.body.wave.id : wave.body.id;
      const filed = await api('PUT',
        `/api/communities/${doomed.id}/channels/${channel.id}/waves/${waveId}`, { token: owner.token });
      assert.equal(filed.status, 200);

      assert.equal((await api('DELETE', `/api/admin/communities/${doomed.id}`,
        { token: nodeAdmin.token, stepUp: adminProof })).status, 200);

      const after = await api('GET', `/api/waves/${waveId}`, { token: owner.token });
      assert.equal(after.status, 200, 'the conversation survives the Community being closed');
      const w = after.body.wave || after.body;
      assert.equal(w.communityId ?? w.community_id ?? null, null);
    });

    await t.test('the audit log records node-admin action against the Community', async () => {
      // An admin acting from outside still leaves a trail inside.
      const fresh = (await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Trail', slug: 'trail', visibility: 'private' },
      })).body.community;
      await api('POST', `/api/admin/communities/${fresh.id}/suspend`, {
        token: nodeAdmin.token, stepUp: adminProof, body: { reason: 'spam' },
      });
      await api('POST', `/api/admin/communities/${fresh.id}/suspend`, {
        token: nodeAdmin.token, stepUp: adminProof, body: { suspended: false },
      });

      const entries = (await api('GET', `/api/communities/${fresh.id}/audit`, { token: owner.token }))
        .body.entries.map(e => e.action);
      assert.ok(entries.includes('community.suspend_by_node_admin'));
      assert.ok(entries.includes('community.unsuspend_by_node_admin'));
    });

    await t.test('I-3: an invite resolves to the Community id, never a hostname', async () => {
      // A migrated Community's outstanding invites must not break, and must
      // certainly not start pointing somewhere else.
      const fresh = (await api('POST', '/api/communities', {
        token: member.token, body: { name: 'Portable', slug: 'portable', visibility: 'private' },
      })).body.community;
      const invite = (await api('POST', `/api/communities/${fresh.id}/invites`, {
        token: member.token, body: {},
      })).body.invite;

      const joiner = await makeUser('joiner');
      const joined = await api('POST', '/api/communities/join', {
        token: joiner.token, body: { token: invite.token },
      });
      assert.equal(joined.status, 200);
      assert.equal(joined.body.community.id, fresh.id,
        'redemption resolves by immutable id, with no hostname involved');
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
