'use strict';

// The eight remaining Medium and Low findings from the Communities audit
// (v2.105.0).
//
//   012  Remote invitation binding granted whatever the role had BECOME, not
//        what was checked when the invitation was issued.
//   013  Ceilings and budgets some admission paths respected and others did not.
//   014  Private Communities were discoverable through status codes, container
//        ids and counts, even by people with no way in.
//   015  Deleting an account left its Communities behind — an active
//        membership, an owner grant and a Community all pointing at a user row
//        that no longer existed.
//   016  Some security operations left no record in the Community's own log.
//   017  Expiries and optional numbers were absorbed rather than validated, so
//        a malformed request produced the least restrictive outcome available.
//   018  Turning the feature off closed the direct routes and left two others.
//   019  A deleted channel left its waves claiming a Community, and unfiling
//        was not scoped to the container it named.
//
// The storage-level fixes are tested directly, because they have to hold for
// every caller rather than for the handlers that happen to have been patched.
// The disclosure fixes are tested over HTTP, because a status code is the thing
// that leaks.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

async function freshDb(temp) {
  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  return new DatabaseSQLite({ dbPath: path.join(temp, `${Math.random().toString(36).slice(2)}.db`) });
}

/** Cheap user rows — bcrypt is not what any of this is testing. */
function makeUsers(db, ids) {
  const now = new Date().toISOString();
  const insert = db.db.prepare(
    `INSERT INTO users (id, handle, display_name, avatar, password_hash, role, created_at, last_seen, preferences)
     VALUES (?, ?, ?, '?', 'x', 'user', ?, ?, '{}')`
  );
  const tx = db.db.transaction(() => { for (const id of ids) insert.run(id, id, id, now, now); });
  tx();
}

test('CORTEX-COMM-015: deleting an account does not strand its Communities', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-015-'));
  try {
    await t.test('the last owner leaving suspends the Community rather than orphaning it', async () => {
      const db = await freshDb(temp);
      makeUsers(db, ['owner', 'member', 'outsider']);
      const c = db.createCommunity({ slug: 'alone', name: 'Alone', createdBy: 'owner' });
      db.addCommunityMember(c.id, 'member', { state: 'active' });
      db.banFromCommunity(c.id, 'outsider', { reason: 'test', bannedBy: 'owner' });

      assert.equal(db.deleteUserAccount('owner').success, true);

      const after = db.getCommunityById(c.id);
      assert.equal(after.status, 'suspended', 'an ownerless Community must not stay open');
      assert.equal(after.created_by, null);
      assert.equal(db.getCommunityMembership(c.id, 'owner'), null, 'their membership is gone');
      assert.equal(
        db.db.prepare('SELECT COUNT(*) c FROM community_membership_roles').get().c, 0,
        'and so is the owner grant that pointed at them');

      // The ban they issued survives; only the attribution is cleared.
      const ban = db.db.prepare('SELECT * FROM community_bans WHERE user_id = ?').get('outsider');
      assert.ok(ban, 'a ban on somebody else is not theirs to take with them');
      assert.equal(ban.banned_by, null);

      assert.equal(db.db.pragma('foreign_key_check').length, 0,
        'the disabled foreign keys have to be honoured by hand, not ignored');
      db.db.close();
    });

    await t.test('a Community with another owner carries on', async () => {
      const db = await freshDb(temp);
      makeUsers(db, ['owner', 'coowner']);
      const c = db.createCommunity({ slug: 'shared', name: 'Shared', createdBy: 'owner' });
      const membershipId = db.addCommunityMember(c.id, 'coowner', { state: 'active' });
      db.grantCommunityRole(membershipId, db.getCommunityRole(c.id, 'owner').id, { grantedBy: 'owner' });

      db.deleteUserAccount('owner');

      assert.equal(db.getCommunityById(c.id).status, 'active',
        'suspending a Community that still has an owner would be its own outage');
      assert.ok(db.getCommunityMembership(c.id, 'coowner'));
      assert.equal(db.db.pragma('foreign_key_check').length, 0);
      db.db.close();
    });

    await t.test('a ban ON the deleted account is dropped rather than left dangling', async () => {
      const db = await freshDb(temp);
      makeUsers(db, ['owner', 'nuisance']);
      const c = db.createCommunity({ slug: 'banned', name: 'Banned', createdBy: 'owner' });
      db.banFromCommunity(c.id, 'nuisance', { reason: 'test', bannedBy: 'owner' });

      db.deleteUserAccount('nuisance');

      assert.equal(db.getCommunityBan(c.id, 'nuisance'), null,
        'a ban naming an id that belongs to nobody cannot match anybody');
      assert.equal(db.getCommunityById(c.id).status, 'active');
      assert.equal(db.db.pragma('foreign_key_check').length, 0);

      const audit = db.listCommunityAudit(c.id).map(a => a.action);
      assert.ok(audit.includes('community.ban_dropped_account_deleted'),
        'staff must be able to see why a ban disappeared');
      db.db.close();
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('CORTEX-COMM-012: a remote invitation confers only what was checked', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-012-'));
  try {
    await t.test('a role that turned administrative after issuance is withheld', async () => {
      const db = await freshDb(temp);
      makeUsers(db, ['owner', 'arrival']);
      const c = db.createCommunity({ slug: 'drift', name: 'Drift', createdBy: 'owner' });

      // A harmless role, checked and accepted at issuance.
      const role = db.createCommunityRole(c.id, { name: 'greeter', priority: 10, permissions: ['wave.create'] });
      db.createRemoteInvitation({
        communityId: c.id, handle: 'arrival', nodeName: 'their.node',
        roleId: role.id, invitedBy: 'owner',
      });

      // ...which later gains the power to hand out roles.
      db.updateCommunityRole(role.id, { permissions: ['wave.create', 'member.roles'] });

      const bound = db.bindRemoteInvitations({ userId: 'arrival', remoteHandle: 'arrival', nodeName: 'their.node' });
      assert.deepEqual(bound, [c.id], 'they are still let in — the invitation was genuine');

      const granted = db.getMemberRoles(c.id, 'arrival').map(r => r.name);
      assert.deepEqual(granted, ['member'],
        'but they arrive as a member, not as whatever that role became');

      assert.ok(db.listCommunityAudit(c.id).some(a => a.action === 'community.remote_invite_role_withheld'),
        'and the Community can see that something was withheld');
      db.db.close();
    });

    await t.test('a role that stayed harmless is still conferred', async () => {
      // The control. A fix here that refused every remote invitation would
      // pass the test above and break the feature.
      const db = await freshDb(temp);
      makeUsers(db, ['owner', 'arrival']);
      const c = db.createCommunity({ slug: 'fine', name: 'Fine', createdBy: 'owner' });
      const role = db.createCommunityRole(c.id, { name: 'greeter', priority: 10, permissions: ['wave.create'] });
      db.createRemoteInvitation({
        communityId: c.id, handle: 'arrival', nodeName: 'their.node',
        roleId: role.id, invitedBy: 'owner',
      });

      db.bindRemoteInvitations({ userId: 'arrival', remoteHandle: 'arrival', nodeName: 'their.node' });
      assert.ok(db.getMemberRoles(c.id, 'arrival').some(r => r.name === 'greeter'));
      db.db.close();
    });

    await t.test('an expired invitation is not redeemable', async () => {
      const db = await freshDb(temp);
      makeUsers(db, ['owner', 'latecomer']);
      const c = db.createCommunity({ slug: 'expired', name: 'Expired', createdBy: 'owner' });
      db.createRemoteInvitation({
        communityId: c.id, handle: 'latecomer', nodeName: 'their.node', invitedBy: 'owner',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });

      const bound = db.bindRemoteInvitations({ userId: 'latecomer', remoteHandle: 'latecomer', nodeName: 'their.node' });
      assert.deepEqual(bound, [], 'an invitation binds an address, and addresses change hands');
      assert.equal(db.getCommunityMembership(c.id, 'latecomer'), null);
      db.db.close();
    });

    await t.test('invitations are given a lifetime by default', async () => {
      const db = await freshDb(temp);
      makeUsers(db, ['owner']);
      const c = db.createCommunity({ slug: 'ttl', name: 'TTL', createdBy: 'owner' });
      const invite = db.createRemoteInvitation({
        communityId: c.id, handle: 'someone', nodeName: 'their.node', invitedBy: 'owner',
      });
      assert.ok(invite.expires_at, 'an invitation with no expiry waits for whoever holds the name next');
      assert.ok(new Date(invite.expires_at) > new Date(), 'and it has not already passed');
      db.db.close();
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('CORTEX-COMM-013: admission ceilings apply at every door', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-013-'));
  try {
    const limits = await import('../server/lib/communities/limits.js');

    await t.test('remote invitation binding respects the member cap', async () => {
      const db = await freshDb(temp);
      const cap = limits.CAPS.membersPerCommunity;
      makeUsers(db, ['owner', 'arrival']);
      const c = db.createCommunity({ slug: 'full', name: 'Full', createdBy: 'owner' });

      // Fill it. Cheap rows, inserted directly — the point is the ceiling, not
      // the route that would normally add each person.
      const filler = Array.from({ length: cap }, (_, i) => `filler-${i}`);
      makeUsers(db, filler);
      const now = new Date().toISOString();
      const insert = db.db.prepare(
        `INSERT INTO community_memberships (id, community_id, user_id, state, joined_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`
      );
      db.db.transaction(() => {
        for (const id of filler) insert.run(`m-${id}`, c.id, id, now, now);
      })();
      assert.ok(db.countCommunityMembers(c.id) >= cap);

      db.createRemoteInvitation({ communityId: c.id, handle: 'arrival', nodeName: 'their.node', invitedBy: 'owner' });
      const bound = db.bindRemoteInvitations({ userId: 'arrival', remoteHandle: 'arrival', nodeName: 'their.node' });
      assert.deepEqual(bound, [], 'a ceiling only some doors respect is not a ceiling');
      assert.equal(db.getCommunityMembership(c.id, 'arrival'), null);
      db.db.close();
    });

    await t.test('member listing pages instead of loading everyone', async () => {
      const db = await freshDb(temp);
      makeUsers(db, ['owner']);
      const c = db.createCommunity({ slug: 'paged', name: 'Paged', createdBy: 'owner' });
      const many = Array.from({ length: 30 }, (_, i) => `p-${String(i).padStart(3, '0')}`);
      makeUsers(db, many);
      for (const id of many) db.addCommunityMember(c.id, id, { state: 'active' });

      const firstTen = db.listCommunityMembers(c.id, { limit: 10, offset: 0 });
      assert.equal(firstTen.length, 10);
      const nextTen = db.listCommunityMembers(c.id, { limit: 10, offset: 10 });
      assert.equal(nextTen.length, 10);
      assert.equal(new Set([...firstTen, ...nextTen].map(m => m.user_id)).size, 20,
        'pages must not overlap');
      assert.equal(db.countCommunityMembers(c.id), 31, 'counting must not need loading');

      // One query for everybody's roles, not one per person.
      const roles = db.getMemberRolesBulk(c.id, firstTen.map(m => m.user_id));
      assert.equal(roles.size, 10);
      db.db.close();
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('CORTEX-COMM-014: a private Community does not announce itself', { timeout: 90000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-014-'));
  const password = 'Disclosure123!';
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
    {
      const { DatabaseSQLite } = await import('../server/database-sqlite.js');
      const seed = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
      seed.updateInstanceConfig({ features: { communities: true } });
      seed.db.close();
    }
    fs.appendFileSync(path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('DISCLOSE_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-disclosure-00000000000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 25000;
    while (!/DISCLOSE_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/DISCLOSE_PORT=(\d+)/)[1]}`;

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
      try { json = await res.json(); } catch { /* no body */ }
      return { status: res.status, body: json };
    };
    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', {
        body: { handle, email: `${handle}@example.test`, password, displayName: handle },
      });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, `login failed for ${handle}`);
      return { handle, token: login.body.token, id: login.body.user.id };
    };

    await makeUser('nodeadmin');
    const owner = await makeUser('owner');
    const member = await makeUser('member');
    const outsider = await makeUser('outsider');

    const priv = (await api('POST', '/api/communities', {
      token: owner.token, body: { name: 'Hidden', slug: 'hidden', visibility: 'private' },
    })).body.community;
    const pub = (await api('POST', '/api/communities', {
      token: owner.token, body: { name: 'Open', slug: 'open', visibility: 'public' },
    })).body.community;
    await api('POST', `/api/communities/${priv.id}/members`, {
      token: owner.token, body: { handle: 'member' },
    });

    await t.test('a gated route does not confirm that a private Community exists', async () => {
      const real = await api('GET', `/api/communities/${priv.id}/members`, { token: outsider.token });
      const imaginary = await api('GET', '/api/communities/does-not-exist-at-all/members', { token: outsider.token });
      assert.equal(real.status, 404);
      assert.equal(imaginary.status, 404);
      assert.deepEqual(real.body, imaginary.body,
        'the two answers must be indistinguishable, body as well as status');
    });

    await t.test('a member who simply lacks the capability still gets 403', async () => {
      // The control. Answering 404 to everyone would hide the oracle by making
      // the API useless to its own members.
      const res = await api('POST', `/api/communities/${priv.id}/channels`, {
        token: member.token, body: { name: 'Nope', slug: 'nope' },
      });
      assert.equal(res.status, 403, 'a member knows the place exists; tell them what is actually wrong');
    });

    await t.test('a public Community is not a secret from anyone', async () => {
      const res = await api('POST', `/api/communities/${pub.id}/channels`, {
        token: outsider.token, body: { name: 'Nope', slug: 'nope' },
      });
      assert.equal(res.status, 403);
    });

    await t.test('a wave does not carry the id of a container its reader cannot see', async () => {
      const channel = (await api('POST', `/api/communities/${priv.id}/channels`, {
        token: owner.token, body: { name: 'General', slug: 'general' },
      })).body.channel;

      // A wave inside the private Community's channel, which the outsider is
      // invited into personally.
      const wave = (await api('POST', '/api/waves', {
        token: owner.token,
        body: { title: 'Shared out', privacy: 'private', channelId: channel.id, participants: [outsider.id] },
      })).body;
      assert.ok(wave && wave.id, `wave creation failed: ${JSON.stringify(wave)}`);

      const mine = await api('GET', '/api/waves', { token: outsider.token });
      const seen = (mine.body.waves || mine.body).find(w => w.id === wave.id);
      assert.ok(seen, 'they are in the wave and should see it');
      assert.equal(seen.communityId, null,
        'being in one wave is not being in the private Community that holds it');
      assert.equal(seen.channelId, null);

      const direct = await api('GET', `/api/waves/${wave.id}`, { token: outsider.token });
      assert.equal(direct.body.communityId, null, 'and the single-wave route agrees');

      // The owner, who is in the Community, sees the container normally.
      const ownerView = await api('GET', `/api/waves/${wave.id}`, { token: owner.token });
      assert.equal(ownerView.body.communityId, priv.id);
    });

    await t.test('a channel reports only the waves its reader may actually read', async () => {
      const channel = (await api('POST', `/api/communities/${priv.id}/channels`, {
        token: owner.token, body: { name: 'Counting', slug: 'counting' },
      })).body.channel;

      // Two private waves the member is not in, one they are.
      for (const title of ['Owner only A', 'Owner only B']) {
        await api('POST', '/api/waves', {
          token: owner.token, body: { title, privacy: 'private', channelId: channel.id },
        });
      }
      await api('POST', '/api/waves', {
        token: owner.token,
        body: { title: 'Shared', privacy: 'private', channelId: channel.id, participants: [member.id] },
      });

      const asOwner = (await api('GET', `/api/communities/${priv.id}/channels`, { token: owner.token }))
        .body.channels.find(c => c.id === channel.id);
      const asMember = (await api('GET', `/api/communities/${priv.id}/channels`, { token: member.token }))
        .body.channels.find(c => c.id === channel.id);

      assert.equal(asOwner.waveCount, 3);
      assert.equal(asMember.waveCount, 1,
        'a count of waves you cannot open is a list of things happening without you');
    });

    await t.test('the member list is paged and says so', async () => {
      const res = await api('GET', `/api/communities/${priv.id}/members`, { token: owner.token });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.members));
      assert.equal(typeof res.body.total, 'number');
      assert.equal(res.body.hasMore, false);
    });

    // ----- CORTEX-COMM-019: containment stays consistent -----

    await t.test('unfiling a wave has to name the channel it is actually in', async () => {
      const chanA = (await api('POST', `/api/communities/${priv.id}/channels`, {
        token: owner.token, body: { name: 'A', slug: 'chan-a' },
      })).body.channel;
      const chanB = (await api('POST', `/api/communities/${priv.id}/channels`, {
        token: owner.token, body: { name: 'B', slug: 'chan-b' },
      })).body.channel;

      const wave = (await api('POST', '/api/waves', {
        token: owner.token, body: { title: 'Lives in B', privacy: 'private', channelId: chanB.id },
      })).body;

      // Filing rights in A say nothing about a wave sitting in B — and the
      // audit record would have been written against A.
      const wrongChannel = await api('DELETE',
        `/api/communities/${priv.id}/channels/${chanA.id}/waves/${wave.id}`, { token: owner.token });
      assert.equal(wrongChannel.status, 404);
      assert.equal((await api('GET', `/api/waves/${wave.id}`, { token: owner.token })).body.channelId,
        chanB.id, 'the wave must still be where it was');

      const rightChannel = await api('DELETE',
        `/api/communities/${priv.id}/channels/${chanB.id}/waves/${wave.id}`, { token: owner.token });
      assert.equal(rightChannel.status, 200, 'and the legitimate detach still works');
    });

    await t.test('deleting a channel leaves its waves in no container at all', async () => {
      const channel = (await api('POST', `/api/communities/${priv.id}/channels`, {
        token: owner.token, body: { name: 'Doomed', slug: 'doomed' },
      })).body.channel;
      const wave = (await api('POST', '/api/waves', {
        token: owner.token, body: { title: 'Survivor', privacy: 'private', channelId: channel.id },
      })).body;

      assert.equal((await api('DELETE', `/api/communities/${priv.id}/channels/${channel.id}`,
        { token: owner.token })).status, 200);

      const after = await api('GET', `/api/waves/${wave.id}`, { token: owner.token });
      assert.equal(after.status, 200, 'the conversation survives its container');
      assert.equal(after.body.channelId, null);
      assert.equal(after.body.communityId, null,
        '"uncontained" has to mean both columns, or the wave claims a Community with no channel for it');
    });

    // ----- CORTEX-COMM-017: malformed input is refused, not absorbed -----

    await t.test('an unreadable or past expiry is refused rather than ignored', async () => {
      for (const bad of ['next tuesday', '2026-13-45', {}, '1999-01-01T00:00:00Z']) {
        const res = await api('POST', `/api/communities/${priv.id}/invites`, {
          token: owner.token, body: { expiresAt: bad },
        });
        assert.equal(res.status, 400, `expected a refusal for ${JSON.stringify(bad)}`);
      }
      const good = await api('POST', `/api/communities/${priv.id}/invites`, {
        token: owner.token,
        body: { expiresAt: new Date(Date.now() + 86400000).toISOString() },
      });
      assert.equal(good.status, 201, 'a real future date still works');
    });

    await t.test('an invalid use count does not silently become unlimited', async () => {
      // '5' is deliberately NOT here: a numeric string that parses cleanly is a
      // number expressed as text, and refusing it would be pedantry rather than
      // validation. What was wrong was 0, -1 and 1.5 becoming "unlimited".
      for (const bad of [0, -1, 1.5, 99999, 'lots']) {
        const res = await api('POST', `/api/communities/${priv.id}/invites`, {
          token: owner.token, body: { maxUses: bad },
        });
        assert.equal(res.status, 400, `expected a refusal for maxUses=${JSON.stringify(bad)}`);
      }
      assert.equal((await api('POST', `/api/communities/${priv.id}/invites`, {
        token: owner.token, body: { maxUses: 5 },
      })).status, 201);
    });

    await t.test('a malformed permission list is refused, not treated as no change', async () => {
      const role = (await api('POST', `/api/communities/${priv.id}/roles`, {
        token: owner.token, body: { name: 'greeter', priority: 10, permissions: ['wave.create'] },
      })).body.role;

      for (const bad of [{ permissions: 'wave.create' }, { permissions: ['not.a.capability'] },
                         { priority: 'high' }, { name: 'x'.repeat(200) }]) {
        const res = await api('PATCH', `/api/communities/${priv.id}/roles/${role.id}`, {
          token: owner.token, body: bad,
        });
        assert.equal(res.status, 400, `expected a refusal for ${JSON.stringify(bad)}`);
      }

      const still = (await api('GET', `/api/communities/${priv.id}/roles`, { token: owner.token }))
        .body.roles.find(r => r.id === role.id);
      assert.equal(still.name, 'greeter', 'a refused edit changes nothing');
    });

    // ----- CORTEX-COMM-016: security operations leave a record -----

    await t.test('channel changes and invite revocations are recorded', async () => {
      const channel = (await api('POST', `/api/communities/${priv.id}/channels`, {
        token: owner.token, body: { name: 'Audited', slug: 'audited' },
      })).body.channel;
      await api('PATCH', `/api/communities/${priv.id}/channels/${channel.id}`, {
        token: owner.token, body: { visibility: 'restricted' },
      });

      const invite = (await api('POST', `/api/communities/${priv.id}/invites`, { token: owner.token })).body.invite;
      await api('DELETE', `/api/communities/${priv.id}/invites/${invite.id}`, { token: owner.token });

      const actions = (await api('GET', `/api/communities/${priv.id}/audit`, { token: owner.token }))
        .body.entries.map(e => e.action);
      assert.ok(actions.includes('channel.update'),
        'changing who can see a channel is a security operation');
      assert.ok(actions.includes('invite.revoke'),
        'withdrawing a way in is as much a record as granting one');
    });

    // ----- CORTEX-COMM-018: the feature switch means the state freezes -----

    await t.test('turning Communities off stops waves being filed into channels', async () => {
      const channel = (await api('POST', `/api/communities/${priv.id}/channels`, {
        token: owner.token, body: { name: 'Frozen', slug: 'frozen' },
      })).body.channel;

      const admin = await api('POST', '/api/auth/login', { body: { handle: 'nodeadmin', password } });
      // Instance config is step-up gated, which is itself worth exercising here.
      const proof = (await api('POST', '/api/auth/step-up', {
        token: admin.body.token, body: { password },
      })).body.stepUpToken;
      const off = await api('PUT', '/api/admin/instance-config', {
        token: admin.body.token, stepUp: proof, body: { features: { communities: false } },
      });
      assert.equal(off.status, 200, `could not disable the feature: ${JSON.stringify(off.body)}`);

      try {
        const blocked = await api('POST', '/api/waves', {
          token: owner.token, body: { title: 'Sneaky', privacy: 'private', channelId: channel.id },
        });
        assert.equal(blocked.status, 403, 'a shutdown that leaves a side door open is not a shutdown');
        assert.equal(blocked.body.code, 'FEATURE_DISABLED');

        // An ordinary wave, touching no Community, is unaffected.
        const ordinary = await api('POST', '/api/waves', {
          token: owner.token, body: { title: 'Normal', privacy: 'private' },
        });
        assert.ok(ordinary.status === 200 || ordinary.status === 201,
          'disabling Communities must not disable Cortex');
      } finally {
        await api('PUT', '/api/admin/instance-config', {
          token: admin.body.token, stepUp: proof, body: { features: { communities: true } },
        });
      }
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
