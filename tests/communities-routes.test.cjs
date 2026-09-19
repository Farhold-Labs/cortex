'use strict';

// Communities Phase 3 — the API, end to end (v2.96.0).
//
// Runs against a real spawned server with a real database, because the things
// worth testing here are the ones that only exist once a handler, the evaluator
// and the schema are all in play: that every route consults the one evaluator,
// that an invite cannot be redeemed twice, that a Community's staff gain no
// authority over the waves filed in it.
//
// The last of those is the reason the container model was chosen, so it gets
// the most attention.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('Communities API', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-comm-api-'));
  const password = 'CommunitiesApi123!';
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
      "\nserver.on('listening', () => console.log('API_TEST_PORT=' + server.address().port));\n");

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: 'test-secret-for-communities-api-0000000',
        SEED_DEMO_DATA: 'false',
        RATE_LIMIT_API_MAX: '100000', RATE_LIMIT_LOGIN_MAX: '10000', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 25000;
    while (!/API_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error('startup failed: ' + output.slice(-3000));
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/API_TEST_PORT=(\d+)/)[1]}`;

    const api = async (method, urlPath, { token, body } = {}) => {
      const res = await fetch(base + urlPath, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try { json = await res.json(); } catch { /* empty body */ }
      return { status: res.status, body: json };
    };

    const makeUser = async (handle) => {
      await api('POST', '/api/auth/register', {
        body: { handle, email: `${handle}@example.test`, password, displayName: handle },
      });
      const login = await api('POST', '/api/auth/login', { body: { handle, password } });
      assert.equal(login.status, 200, `login failed for ${handle}: ${JSON.stringify(login.body)}`);
      return { handle, token: login.body.token, id: login.body.user.id };
    };

    // First registered user becomes the node admin; keep them out of the way.
    await makeUser('nodeadmin');
    const owner = await makeUser('owner');
    const admin = await makeUser('adminuser');
    const mod = await makeUser('moduser');
    const member = await makeUser('memberuser');
    const outsider = await makeUser('outsider');

    let community, channel;

    await t.test('anyone may create a Community, and becomes its owner', async () => {
      const res = await api('POST', '/api/communities', {
        token: owner.token,
        body: { name: 'Productions', slug: 'productions', visibility: 'public' },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      community = res.body.community;
      assert.equal(community.visibility, 'public');

      const detail = await api('GET', `/api/communities/${community.id}`, { token: owner.token });
      assert.ok(detail.body.capabilities.includes('community.delete'), 'creator owns it');
    });

    await t.test('slugs are validated and unique', async () => {
      const bad = await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Bad', slug: 'Not A Slug!' },
      });
      assert.equal(bad.status, 400);

      const dupe = await api('POST', '/api/communities', {
        token: member.token, body: { name: 'Another', slug: 'productions' },
      });
      assert.equal(dupe.status, 409);
    });

    await t.test('discovery lists public Communities and nothing else', async () => {
      await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Cast Only', slug: 'cast-only', visibility: 'unlisted' },
      });
      await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Board', slug: 'board', visibility: 'private' },
      });

      const res = await api('GET', '/api/communities', { token: outsider.token });
      const slugs = res.body.communities.map(c => c.slug);
      assert.ok(slugs.includes('productions'));
      assert.ok(!slugs.includes('cast-only'), 'unlisted must not be listed — that is what unlisted means');
      assert.ok(!slugs.includes('board'));
    });

    await t.test('a private Community reads as 404 to a non-member, not 403', async () => {
      // M-1: 403 confirms the thing exists. For a Community someone was not
      // meant to know about, that is the leak.
      const priv = (await api('GET', '/api/communities', { token: owner.token })).body.communities;
      const board = (await api('GET', '/api/communities/mine', { token: owner.token }))
        .body.communities.find(c => c.slug === 'board');
      const res = await api('GET', `/api/communities/${board.id}`, { token: outsider.token });
      assert.equal(res.status, 404);
      assert.ok(Array.isArray(priv));
    });

    await t.test('members are added and given the member role', async () => {
      for (const u of [admin, mod, member]) {
        const res = await api('POST', `/api/communities/${community.id}/members`, {
          token: owner.token, body: { userId: u.id },
        });
        assert.equal(res.status, 201, JSON.stringify(res.body));
      }
      const list = await api('GET', `/api/communities/${community.id}/members`, { token: owner.token });
      assert.equal(list.body.members.length, 4);
      assert.ok(list.body.members.find(m => m.userId === member.id).roles.some(r => r.name === 'member'));
    });

    await t.test('someone can be added directly by handle, and the search finds them', async () => {
      // The invite code works for people you can reach; adding directly is for
      // people already on this server.
      const found = await api('GET', '/api/users/search?q=moduser', { token: owner.token });
      assert.equal(found.status, 200);
      assert.ok(found.body.some(u => u.handle === 'moduser'), 'search finds a local person');

      const fresh = await makeUser('addedbyhandle');
      const res = await api('POST', `/api/communities/${community.id}/members`, {
        token: owner.token, body: { handle: 'addedbyhandle' },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));

      const mine = await api('GET', '/api/communities/mine', { token: fresh.token });
      assert.ok(mine.body.communities.some(c => c.id === community.id),
        'they are in it without redeeming anything');

      // As an ordinary member, not as staff.
      const detail = await api('GET', `/api/communities/${community.id}`, { token: fresh.token });
      assert.ok(detail.body.capabilities.includes('channel.create_wave'));
      assert.ok(!detail.body.capabilities.includes('member.ban'));

      await api('DELETE', `/api/communities/${community.id}/members/${fresh.id}`, { token: owner.token });
    });

    await t.test('adding a member requires the invite capability', async () => {
      const outsiderTarget = await makeUser('wouldbeadded');
      const res = await api('POST', `/api/communities/${community.id}/members`, {
        token: member.token, body: { handle: 'wouldbeadded' },
      });
      assert.equal(res.status, 403, 'an ordinary member cannot add people');
      assert.ok(outsiderTarget.id);
    });

    await t.test('a non-member cannot read the member list', async () => {
      const res = await api('GET', `/api/communities/${community.id}/members`, { token: outsider.token });
      assert.equal(res.status, 403);
    });

    await t.test('roles are granted through the evaluator, not by asking nicely', async () => {
      const roles = (await api('GET', `/api/communities/${community.id}/roles`, { token: owner.token })).body.roles;
      const adminRole = roles.find(r => r.name === 'admin');
      const modRole = roles.find(r => r.name === 'moderator');
      const ownerRole = roles.find(r => r.name === 'owner');

      assert.equal((await api('PUT',
        `/api/communities/${community.id}/members/${admin.id}/roles/${adminRole.id}`,
        { token: owner.token })).status, 200);
      assert.equal((await api('PUT',
        `/api/communities/${community.id}/members/${mod.id}/roles/${modRole.id}`,
        { token: owner.token })).status, 200);

      // The escalation that matters: an admin minting an owner.
      const escalate = await api('PUT',
        `/api/communities/${community.id}/members/${admin.id}/roles/${ownerRole.id}`,
        { token: admin.token });
      assert.equal(escalate.status, 403, 'an admin must not be able to make themselves owner');

      // And a member cannot grant anything at all.
      const byMember = await api('PUT',
        `/api/communities/${community.id}/members/${member.id}/roles/${modRole.id}`,
        { token: member.token });
      assert.equal(byMember.status, 403);
    });

    await t.test('a role cannot be minted holding powers its author lacks', async () => {
      const res = await api('POST', `/api/communities/${community.id}/roles`, {
        token: admin.token,
        body: { name: 'superuser', priority: 50, permissions: ['community.delete'] },
      });
      assert.equal(res.status, 403, 'admin does not hold community.delete, so cannot confer it');
    });

    await t.test('a moderator cannot remove an admin', async () => {
      const res = await api('DELETE', `/api/communities/${community.id}/members/${admin.id}`, {
        token: mod.token,
      });
      assert.equal(res.status, 403);
    });

    await t.test('the last owner cannot leave', async () => {
      // The check runs inside the transaction that would perform the write, so
      // this is the behaviour rather than an advisory message.
      const res = await api('POST', `/api/communities/${community.id}/leave`, { token: owner.token });
      assert.equal(res.status, 409);
      assert.match(res.body.error, /owner/i);

      const still = await api('GET', `/api/communities/${community.id}`, { token: owner.token });
      assert.ok(still.body.capabilities.includes('community.delete'), 'still the owner');
    });

    // ----- Invites -----

    let inviteToken;
    await t.test('an invite returns its token exactly once', async () => {
      const res = await api('POST', `/api/communities/${community.id}/invites`, {
        token: owner.token, body: { maxUses: 1 },
      });
      assert.equal(res.status, 201);
      inviteToken = res.body.invite.token;
      assert.ok(inviteToken && inviteToken.length > 20);

      const list = await api('GET', `/api/communities/${community.id}/invites`, { token: owner.token });
      assert.ok(list.body.invites.length >= 1);
      for (const inv of list.body.invites) {
        assert.ok(!('token' in inv), 'the listing must never return a usable token');
        assert.ok(!('token_hash' in inv), 'nor the hash, which a caller can do nothing with but leak');
      }
    });

    await t.test('an invite may not confer an administrative role', async () => {
      const roles = (await api('GET', `/api/communities/${community.id}/roles`, { token: owner.token })).body.roles;
      for (const name of ['owner', 'admin']) {
        const res = await api('POST', `/api/communities/${community.id}/invites`, {
          token: owner.token, body: { roleId: roles.find(r => r.name === name).id },
        });
        assert.equal(res.status, 403, `an invite link must not be able to grant ${name}`);
      }
    });

    await t.test('I-2: a single-use invite survives a redemption race', async () => {
      // Read-then-write loses this race, and the prize is a one-use invite
      // redeemed by several people. The guard is in the UPDATE's WHERE clause.
      const racers = [];
      for (let i = 0; i < 6; i++) racers.push(await makeUser(`racer${i}`));

      const results = await Promise.all(racers.map(r =>
        api('POST', '/api/communities/join', { token: r.token, body: { token: inviteToken } })));

      const won = results.filter(r => r.status === 200);
      assert.equal(won.length, 1, `exactly one redemption may succeed, got ${won.length}`);

      const members = (await api('GET', `/api/communities/${community.id}/members`, { token: owner.token }))
        .body.members.map(m => m.handle);
      const joined = racers.filter(r => members.includes(r.handle));
      assert.equal(joined.length, 1, 'and exactly one racer is actually a member');
    });

    await t.test('a revoked invite stops working, with the same message as a wrong one', async () => {
      const made = await api('POST', `/api/communities/${community.id}/invites`, {
        token: owner.token, body: {},
      });
      await api('DELETE', `/api/communities/${community.id}/invites/${made.body.invite.id}`, {
        token: owner.token,
      });
      const used = await api('POST', '/api/communities/join', {
        token: outsider.token, body: { token: made.body.invite.token },
      });
      const wrong = await api('POST', '/api/communities/join', {
        token: outsider.token, body: { token: 'not-a-real-token-at-all' },
      });
      assert.equal(used.status, 404);
      assert.equal(wrong.status, 404);
      assert.deepEqual(used.body, wrong.body,
        'distinct answers tell a guesser how close they are');
    });

    await t.test('a public community can be joined without an invite', async () => {
      // "Public — anyone can find it" has to mean they can also join it.
      // Before this existed, discovery listed communities that no one could
      // then get into without someone minting them a code.
      const pub = (await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Open House', slug: 'open-house', visibility: 'public' },
      })).body.community;

      const joiner = await makeUser('opencomer');
      const res = await api('POST', `/api/communities/${pub.id}/join`, { token: joiner.token });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const mine = await api('GET', '/api/communities/mine', { token: joiner.token });
      assert.ok(mine.body.communities.some(c => c.id === pub.id));

      // And they arrive as an ordinary member, not as nothing and not as staff.
      const detail = await api('GET', `/api/communities/${pub.id}`, { token: joiner.token });
      assert.ok(detail.body.capabilities.includes('channel.create_wave'));
      assert.ok(!detail.body.capabilities.includes('member.ban'));

      // Joining twice is not an error — a second click on a slow connection
      // should not look like a failure.
      assert.equal((await api('POST', `/api/communities/${pub.id}/join`, { token: joiner.token })).status, 200);
    });

    await t.test('an unlisted community is joinable by link, a private one is not', async () => {
      const unlisted = (await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'By Link', slug: 'by-link', visibility: 'unlisted' },
      })).body.community;
      const priv = (await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Closed', slug: 'closed-doors', visibility: 'private' },
      })).body.community;

      const walker = await makeUser('linkwalker');

      // Unlisted: not listed, but joinable by someone who has the link — not
      // being listed is the whole of what unlisted means.
      const listed = (await api('GET', '/api/communities', { token: walker.token })).body.communities;
      assert.ok(!listed.some(c => c.id === unlisted.id), 'unlisted must not appear in discovery');
      assert.equal((await api('POST', `/api/communities/${unlisted.id}/join`, { token: walker.token })).status, 200);

      // Private: 404 rather than 403, because 403 confirms it exists.
      const denied = await api('POST', `/api/communities/${priv.id}/join`, { token: walker.token });
      assert.equal(denied.status, 404);
    });

    await t.test('a banned person cannot join an open community either', async () => {
      const pub = (await api('POST', '/api/communities', {
        token: owner.token, body: { name: 'Open Two', slug: 'open-two', visibility: 'public' },
      })).body.community;
      const pest = await makeUser('pest');
      await api('POST', `/api/communities/${pub.id}/bans`, {
        token: owner.token, body: { userId: pest.id },
      });
      const res = await api('POST', `/api/communities/${pub.id}/join`, { token: pest.token });
      assert.equal(res.status, 403, 'an open door is not a way around a ban');
    });

    await t.test('a banned person cannot redeem their way back in', async () => {
      const banned = await makeUser('bannedperson');
      await api('POST', `/api/communities/${community.id}/bans`, {
        token: owner.token, body: { userId: banned.id, reason: 'spam' },
      });
      const invite = await api('POST', `/api/communities/${community.id}/invites`, {
        token: owner.token, body: {},
      });
      const res = await api('POST', '/api/communities/join', {
        token: banned.token, body: { token: invite.body.invite.token },
      });
      assert.equal(res.status, 403);
    });

    // ----- Channels -----

    await t.test('channels are created by those who may manage them', async () => {
      const denied = await api('POST', `/api/communities/${community.id}/channels`, {
        token: member.token, body: { name: 'Sneaky', slug: 'sneaky' },
      });
      assert.equal(denied.status, 403, 'a member may not restructure the Community');

      const res = await api('POST', `/api/communities/${community.id}/channels`, {
        token: owner.token, body: { name: 'Main Stage', slug: 'main-stage' },
      });
      assert.equal(res.status, 201);
      channel = res.body.channel;

      const dupe = await api('POST', `/api/communities/${community.id}/channels`, {
        token: owner.token, body: { name: 'Again', slug: 'main-stage' },
      });
      assert.equal(dupe.status, 409);
    });

    await t.test('A-4: a channel from another Community is refused', async () => {
      const other = await api('POST', '/api/communities', {
        token: outsider.token, body: { name: 'Theirs', slug: 'theirs' },
      });
      const theirChannel = await api('POST', `/api/communities/${other.body.community.id}/channels`, {
        token: outsider.token, body: { name: 'Theirs', slug: 'theirs-main' },
      });
      // The owner of THIS Community, holding the capability, naming a channel
      // that belongs to another.
      const res = await api('PATCH',
        `/api/communities/${community.id}/channels/${theirChannel.body.channel.id}`,
        { token: owner.token, body: { name: 'Hijacked' } });
      assert.equal(res.status, 403);
    });

    // ----- Filing a wave: the invariant -----

    await t.test('filing a wave needs authority over the wave, not just the channel', async () => {
      const wave = await api('POST', '/api/waves', {
        token: member.token, body: { title: 'Rehearsal notes', privacy: 'private' },
      });
      assert.equal(wave.status, 201, JSON.stringify(wave.body));
      const waveId = wave.body.wave ? wave.body.wave.id : wave.body.id;

      // The Community OWNER holds every Community capability, and still may not
      // file someone else's private wave: Community staff do not acquire
      // authority over a wave by virtue of it being near them.
      const byOwner = await api('PUT',
        `/api/communities/${community.id}/channels/${channel.id}/waves/${waveId}`,
        { token: owner.token });
      assert.equal(byOwner.status, 403, 'Community authority is not wave authority');

      // Its own creator can.
      const byCreator = await api('PUT',
        `/api/communities/${community.id}/channels/${channel.id}/waves/${waveId}`,
        { token: member.token });
      assert.equal(byCreator.status, 200, JSON.stringify(byCreator.body));
      assert.equal(byCreator.body.wave.channel_id, channel.id);
    });

    await t.test('filing a wave changes where it is listed and nothing else', async () => {
      // The invariant the whole container model exists for.
      const wave = await api('POST', '/api/waves', {
        token: member.token, body: { title: 'Private notes', privacy: 'private' },
      });
      const waveId = wave.body.wave ? wave.body.wave.id : wave.body.id;

      const before = await api('GET', `/api/waves/${waveId}`, { token: member.token });
      const participantsBefore = (before.body.wave || before.body).participants;

      // Assert the move SUCCEEDED before asserting what it did not change —
      // otherwise "nothing changed" passes trivially when nothing happened.
      const moved = await api('PUT',
        `/api/communities/${community.id}/channels/${channel.id}/waves/${waveId}`,
        { token: member.token });
      assert.equal(moved.status, 200, `the move must succeed: ${JSON.stringify(moved.body)}`);
      assert.equal(moved.body.wave.channel_id, channel.id);

      const after = await api('GET', `/api/waves/${waveId}`, { token: member.token });
      const w = after.body.wave || after.body;
      assert.equal(w.privacy, 'private', 'privacy unchanged');
      assert.deepEqual(
        (w.participants || []).map(p => p.id).sort(),
        (participantsBefore || []).map(p => p.id).sort(),
        'participants unchanged');

      // And the Community owner still cannot read it.
      const asOwner = await api('GET', `/api/waves/${waveId}`, { token: owner.token });
      assert.ok([403, 404].includes(asOwner.status),
        `the Community owner must not be able to read a private wave filed in their channel (got ${asOwner.status})`);
    });

    await t.test('a wave can be started directly in a channel, in one request', async () => {
      // Create-then-file is two requests, and a failure between them leaves an
      // orphan wave the person never asked for and cannot find. This is one.
      const res = await api('POST', '/api/waves', {
        token: member.token,
        body: { title: 'Born in a channel', privacy: 'private', channelId: channel.id },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const created = res.body.wave || res.body;
      assert.equal(created.channelId ?? created.channel_id, channel.id);

      const listed = await api('GET', `/api/waves/${created.id}`, { token: member.token });
      const w = listed.body.wave || listed.body;
      assert.equal(w.channelId ?? w.channel_id, channel.id, 'and it is really filed there');
      assert.equal(w.privacy, 'private', 'privacy is whatever was asked for, not inherited from the channel');
    });

    await t.test('someone outside the Community cannot start a wave in its channel', async () => {
      const res = await api('POST', '/api/waves', {
        token: outsider.token,
        body: { title: 'Trespass', privacy: 'private', channelId: channel.id },
      });
      assert.equal(res.status, 403);

      // And the wave must not have been created anyway — an authorization
      // failure that still leaves a row behind is not a refusal.
      const mine = await api('GET', '/api/waves', { token: outsider.token });
      const list = Array.isArray(mine.body) ? mine.body : (mine.body.waves || []);
      assert.ok(!list.some(w => w.title === 'Trespass'), 'no orphan wave was left behind');
    });

    await t.test('a channel id that belongs to no Community is refused', async () => {
      const nodeChannel = await api('POST', '/api/waves', {
        token: member.token,
        body: { title: 'Nowhere', privacy: 'private', channelId: 'channel-does-not-exist' },
      });
      assert.equal(nodeChannel.status, 404);
    });

    await t.test('deleting a channel leaves its waves alone', async () => {
      const doomed = await api('POST', `/api/communities/${community.id}/channels`, {
        token: owner.token, body: { name: 'Temp', slug: 'temp' },
      });
      const wave = await api('POST', '/api/waves', {
        token: member.token, body: { title: 'Survives', privacy: 'private' },
      });
      const waveId = wave.body.wave ? wave.body.wave.id : wave.body.id;
      const filed = await api('PUT',
        `/api/communities/${community.id}/channels/${doomed.body.channel.id}/waves/${waveId}`,
        { token: member.token });
      assert.equal(filed.status, 200, `precondition: the wave must actually be filed: ${JSON.stringify(filed.body)}`);

      await api('DELETE', `/api/communities/${community.id}/channels/${doomed.body.channel.id}`,
        { token: owner.token });

      const after = await api('GET', `/api/waves/${waveId}`, { token: member.token });
      assert.equal(after.status, 200, 'the conversation survives its container');
      const w = after.body.wave || after.body;
      assert.equal(w.channelId ?? w.channel_id ?? null, null, 'and falls back to uncontained');
    });

    await t.test('the audit log is gated and records what happened', async () => {
      assert.equal((await api('GET', `/api/communities/${community.id}/audit`,
        { token: member.token })).status, 403);

      const res = await api('GET', `/api/communities/${community.id}/audit`, { token: owner.token });
      assert.equal(res.status, 200);
      const actions = res.body.entries.map(e => e.action);
      assert.ok(actions.includes('community.create'));
      assert.ok(actions.includes('channel.create'));
      assert.ok(actions.includes('wave.file'));
    });

    await t.test('every Communities route refuses an unauthenticated caller', async () => {
      const routes = [
        ['GET', '/api/communities'],
        ['GET', '/api/communities/mine'],
        ['POST', '/api/communities'],
        ['GET', `/api/communities/${community.id}`],
        ['GET', `/api/communities/${community.id}/members`],
        ['GET', `/api/communities/${community.id}/channels`],
        ['GET', `/api/communities/${community.id}/roles`],
        ['GET', `/api/communities/${community.id}/audit`],
        ['POST', '/api/communities/join'],
      ];
      for (const [method, url] of routes) {
        const res = await api(method, url, { body: {} });
        assert.ok([401, 403].includes(res.status), `${method} ${url} allowed an anonymous caller (${res.status})`);
      }
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
