'use strict';

// The Community authorization evaluator (v2.95.0, Communities Phase 2).
//
// This is the security boundary of the whole project, so the assertions that
// matter are the ones that must DENY. Each group below maps to a finding in
// docs/communities/01-threat-model.md:
//
//   A-1  an actor may be remote, and a well-signed assertion from a peer node
//        proves the peer SAID it — never that the actor held the power here
//   A-2  authorize against a committed state version, not wall-clock time
//   A-3  privilege escalation inside a Community
//   A-4  cross-Community IDOR
//
// And one that is not a threat-model finding but is the reason the container
// model was chosen at all: Community membership must never confer access to a
// wave. That is the last group, and it is the most important test in the file.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function freshDb() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-authz-'));
  fs.mkdirSync(path.join(temp, 'data'));
  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const db = new DatabaseSQLite({ dbPath: path.join(temp, 'data/farhold.db') });
  const users = {};
  for (const handle of ['owner', 'admin', 'mod', 'member', 'outsider', 'banned']) {
    users[handle] = db.createUser({
      id: `user-${handle}`, handle, email: `${handle}@example.test`,
      passwordHash: 'x', displayName: handle,
    });
  }
  return { db, users, cleanup: () => { try { db.close(); } catch {} fs.rmSync(temp, { recursive: true, force: true }); } };
}

test('Community authorization evaluator', async (t) => {
  const { db, users, cleanup } = await freshDb();
  const { CAPABILITIES } = await import('../server/lib/communities/capabilities.js');
  const authz = await import('../server/lib/communities/authorize.js');
  const {
    authorize, resolveActor, canActOnMember, canGrantRole, canEditRole,
    canInviteConferRole, wouldLeaveNoOwner, canDiscoverChannel,
    assertNeverGrantsWaveAccess, homeNodeStanding, effectiveCapabilities, REASON,
  } = authz;

  const local = (userId) => ({ kind: 'user', userId });

  try {
    const community = db.createCommunity({
      name: 'Productions', slug: 'productions', visibility: 'public', createdBy: users.owner.id,
    });
    const join = (user, roleName) => {
      const mid = db.addCommunityMember(community.id, user.id, { state: 'active' });
      if (roleName) db.grantCommunityRole(mid, db.getCommunityRole(community.id, roleName).id);
      return mid;
    };
    join(users.admin, 'admin');
    join(users.mod, 'moderator');
    join(users.member, 'member');

    // ----- The matrix -----

    await t.test('each role holds exactly the powers it should', () => {
      const cases = [
        // [user,           capability,                      expected]
        [users.owner,  CAPABILITIES.DELETE_COMMUNITY,   true],
        [users.owner,  CAPABILITIES.MANAGE_ROLES,       true],
        [users.admin,  CAPABILITIES.MANAGE_COMMUNITY,   true],
        [users.admin,  CAPABILITIES.MANAGE_ROLES,       true],
        [users.admin,  CAPABILITIES.DELETE_COMMUNITY,   false],  // admin runs it, owner disposes of it
        [users.admin,  CAPABILITIES.TRANSFER_OWNER,     false],
        [users.mod,    CAPABILITIES.MODERATE_CONTENT,   true],
        [users.mod,    CAPABILITIES.BAN_MEMBER,         true],
        [users.mod,    CAPABILITIES.MANAGE_CHANNELS,    false],  // polices, does not restructure
        [users.mod,    CAPABILITIES.MANAGE_ROLES,       false],
        [users.member, CAPABILITIES.CREATE_WAVE,        true],
        [users.member, CAPABILITIES.VIEW_CHANNEL,       true],
        [users.member, CAPABILITIES.BAN_MEMBER,         false],
        [users.member, CAPABILITIES.MANAGE_CHANNELS,    false],
      ];
      for (const [user, cap, expected] of cases) {
        const got = authorize(db, local(user.id), community.id, cap);
        assert.equal(got.allowed, expected,
          `${user.handle} ${expected ? 'should' : 'should NOT'} hold ${cap} (got ${got.reason})`);
      }
    });

    await t.test('a non-member holds nothing, however public the Community', () => {
      const got = authorize(db, local(users.outsider.id), community.id, CAPABILITIES.VIEW_CHANNEL);
      assert.equal(got.allowed, false);
      assert.equal(got.reason, REASON.NOT_A_MEMBER);
    });

    await t.test('a ban outranks a role that was never revoked', () => {
      // A ban now revokes the grants too (CORTEX-COMM-005), but the ban check
      // must still stand on its own: it runs before membership and capability
      // are even consulted, so it holds even if someone re-grants the role.
      const mid = join(users.banned, 'admin');
      assert.ok(authorize(db, local(users.banned.id), community.id, CAPABILITIES.MANAGE_COMMUNITY).allowed,
        'precondition: admin powers before the ban');

      db.banFromCommunity(community.id, users.banned.id, { bannedBy: users.owner.id });
      db.db.prepare("UPDATE community_memberships SET state = 'active' WHERE id = ?").run(mid);

      const got = authorize(db, local(users.banned.id), community.id, CAPABILITIES.MANAGE_COMMUNITY);
      assert.equal(got.allowed, false);
      assert.equal(got.reason, REASON.BANNED, 'even with an active membership and the admin role');
    });

    await t.test('a suspended Community is frozen for its owner too', () => {
      db.updateCommunity(community.id, { status: 'suspended' });
      const got = authorize(db, local(users.owner.id), community.id, CAPABILITIES.MANAGE_COMMUNITY);
      assert.equal(got.allowed, false);
      assert.equal(got.reason, REASON.COMMUNITY_INACTIVE);
      db.updateCommunity(community.id, { status: 'active' });
    });

    await t.test('unknown capabilities and missing Communities deny, not throw', () => {
      assert.equal(authorize(db, local(users.owner.id), community.id, 'community.obliterate').reason,
        REASON.UNKNOWN_CAPABILITY);
      assert.equal(authorize(db, local(users.owner.id), 'no-such-community', CAPABILITIES.VIEW_CHANNEL).reason,
        REASON.NO_COMMUNITY);
      assert.equal(authorize(db, null, community.id, CAPABILITIES.VIEW_CHANNEL).reason,
        REASON.ACTOR_UNRESOLVED);
      assert.equal(authorize(db, { kind: 'wat' }, community.id, CAPABILITIES.VIEW_CHANNEL).reason,
        REASON.ACTOR_UNRESOLVED);
    });

    // ----- A-1: remote actors -----

    await t.test('A-1: a peer node saying so does not make it true', () => {
      // The finding, exactly: an envelope signed by alice.example proves that
      // node said "Alice did this". It proves nothing about whether Alice holds
      // the capability in THIS node's view of Community state.
      const asserted = { kind: 'federated', handle: 'alice', node: 'alice.example', homeUserId: 'remote-1' };

      assert.equal(resolveActor(db, asserted), null, 'no local row exists for them yet');
      const got = authorize(db, asserted, community.id, CAPABILITIES.BAN_MEMBER);
      assert.equal(got.allowed, false);
      assert.equal(got.reason, REASON.ACTOR_UNRESOLVED);
    });

    await t.test('A-1: a cross-port member is authorized like anyone else', () => {
      // Under plan §2 a remote member arrives through cross-port auth and IS a
      // local users row, so this path must work — the evaluator was written to
      // take a possibly-remote actor from day one so Phase 4 need not rewrite it.
      // Their node must be a live peer before anything else is asked, because
      // from v2.97.0 standing is checked ahead of membership — a person whose
      // node is not vouching for them is refused before the question of whether
      // they belong here even arises.
      db.db.prepare(`INSERT OR IGNORE INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                     VALUES (?, ?, ?, ?, 'active', ?)`)
        .run('fed-pmp', 'pmp.example', 'https://pmp.example', 'k', new Date().toISOString());

      const stub = db.upsertCrossPortUser({
        homeUserId: 'remote-42', homeNode: 'pmp.example',
        handle: 'jempson', displayName: 'Jempson',
      });
      const asserted = { kind: 'federated', handle: 'jempson', node: 'pmp.example', homeUserId: 'remote-42' };
      assert.equal(resolveActor(db, asserted), stub.id, 'resolves to the stub row');

      assert.equal(authorize(db, asserted, community.id, CAPABILITIES.VIEW_CHANNEL).reason,
        REASON.NOT_A_MEMBER, 'existing locally is not the same as belonging here');

      const mid = db.addCommunityMember(community.id, stub.id, { state: 'active' });
      db.grantCommunityRole(mid, db.getCommunityRole(community.id, 'member').id);

      assert.ok(authorize(db, asserted, community.id, CAPABILITIES.CREATE_WAVE).allowed,
        'a remote member holds their granted powers');
      assert.equal(authorize(db, asserted, community.id, CAPABILITIES.BAN_MEMBER).allowed, false,
        'and no more than those');
    });

    await t.test('A-1 regression: a remote user with no avatar can still be created', () => {
      // Found while writing the test above. `users.avatar` is NOT NULL with a
      // DEFAULT, and a column DEFAULT applies only when the column is OMITTED —
      // an explicit NULL still violates it. upsertCrossPortUser passed
      // `avatar || null`, so a remote user whose profile carried no avatar could
      // not complete a cross-port login at all: 500, "Failed to create local
      // user". createUser had always defended with `|| '?'`; this path had not.
      const bare = db.upsertCrossPortUser({
        homeUserId: 'remote-noavatar', homeNode: 'pmp.example',
        handle: 'plainuser', displayName: 'Plain User',
      });
      assert.ok(bare && bare.id, 'a remote user with no avatar must be creatable');
      assert.equal(bare.avatar, '?');

      // The UPDATE path had the same defect, so a second call must not throw either.
      const again = db.upsertCrossPortUser({
        homeUserId: 'remote-noavatar', homeNode: 'pmp.example',
        handle: 'plainuser', displayName: 'Renamed',
      });
      assert.equal(again.id, bare.id, 'same row');
      assert.equal(again.avatar, '?');
    });

    await t.test('A-1: an actor claimed from the wrong node does not resolve', () => {
      // Handles collide across nodes — cross-port auth suffixes them for that
      // reason — so matching on handle alone would authorize the wrong person.
      assert.equal(
        resolveActor(db, { kind: 'federated', handle: 'jempson', node: 'attacker.example', homeUserId: 'remote-42' }),
        null);
      assert.equal(
        resolveActor(db, { kind: 'federated', handle: 'jempson', node: 'pmp.example', homeUserId: 'remote-99' }),
        null, 'right node, wrong person');
    });

    await t.test('A-1: a local user cannot be impersonated through the federated path', () => {
      // users.owner is a local account with no is_cross_port flag. A peer
      // claiming it must not resolve to it.
      assert.equal(resolveActor(db, { kind: 'federated', handle: 'owner', node: 'evil.example' }), null);
      assert.equal(resolveActor(db, { kind: 'federated', handle: 'owner', node: 'pmp.example' }), null);
    });

    await t.test('a remote member loses standing when their node stops vouching', () => {
      // Rights held here by a remote member are BORROWED from the relationship
      // with their home node. Before v2.97.0 nothing checked this: the stub row
      // behaved like a local account forever, so unpairing a node left its
      // people's Community membership entirely intact.
      const stub = db.upsertCrossPortUser({
        homeUserId: 'remote-standing', homeNode: 'ally.example',
        handle: 'ally', displayName: 'Ally', avatar: 'A',
      });
      const asserted = { kind: 'federated', handle: 'ally', node: 'ally.example', homeUserId: 'remote-standing' };
      const mid = db.addCommunityMember(community.id, stub.id, { state: 'active' });
      db.grantCommunityRole(mid, db.getCommunityRole(community.id, 'member').id);

      // No peer record at all — the node was never paired, or has been removed.
      assert.equal(homeNodeStanding(db, stub.id).ok, false);
      assert.equal(authorize(db, asserted, community.id, CAPABILITIES.CREATE_WAVE).reason,
        REASON.HOME_NODE_INACTIVE);
      assert.equal(effectiveCapabilities(db, asserted, community.id).size, 0,
        'and the capability listing must agree with the gate');

      // Paired and active: standing restored, membership never touched.
      db.db.prepare(`INSERT INTO federation_nodes (id, node_name, base_url, public_key, status, created_at)
                     VALUES (?, ?, ?, ?, 'active', ?)`)
        .run('fed-ally', 'ally.example', 'https://ally.example', 'k', new Date().toISOString());
      assert.equal(homeNodeStanding(db, stub.id).ok, true);
      assert.ok(authorize(db, asserted, community.id, CAPABILITIES.CREATE_WAVE).allowed);

      // Suspended: withdrawn again, without anyone editing a membership.
      db.db.prepare("UPDATE federation_nodes SET status = 'suspended' WHERE node_name = 'ally.example'").run();
      assert.equal(authorize(db, asserted, community.id, CAPABILITIES.CREATE_WAVE).reason,
        REASON.HOME_NODE_INACTIVE);

      db.db.prepare("UPDATE federation_nodes SET status = 'active' WHERE node_name = 'ally.example'").run();
    });

    await t.test('a local member has no home node to lose', () => {
      // The gate must apply to borrowed standing only — nothing about
      // federation may lock a local user out of their own Community.
      assert.equal(homeNodeStanding(db, users.owner.id).ok, true);
      assert.ok(effectiveCapabilities(db, local(users.owner.id), community.id).has(CAPABILITIES.DELETE_COMMUNITY));
    });

    await t.test('effectiveCapabilities agrees with authorize in every refusing case', () => {
      // The two must never disagree: a caller that asks "what can they do" and
      // one that asks "may they do this" have to get consistent answers, which
      // is the bug the two-node test found.
      assert.equal(effectiveCapabilities(db, local(users.outsider.id), community.id).size, 0, 'non-member');
      assert.equal(effectiveCapabilities(db, local(users.banned.id), community.id).size, 0, 'banned');
      assert.equal(effectiveCapabilities(db, null, community.id).size, 0, 'unresolvable actor');
      assert.equal(effectiveCapabilities(db, local(users.owner.id), 'no-such-community').size, 0);

      db.updateCommunity(community.id, { status: 'suspended' });
      assert.equal(effectiveCapabilities(db, local(users.owner.id), community.id).size, 0, 'suspended community');
      db.updateCommunity(community.id, { status: 'active' });
    });

    // ----- A-2: state version -----

    await t.test('A-2: a mutation may commit to the state it believed it saw', () => {
      const current = db.getCommunityById(community.id).state_version;
      assert.ok(authorize(db, local(users.owner.id), community.id, CAPABILITIES.MANAGE_COMMUNITY,
        { expectedStateVersion: current }).allowed);

      const stale = authorize(db, local(users.owner.id), community.id, CAPABILITIES.MANAGE_COMMUNITY,
        { expectedStateVersion: current - 1 });
      assert.equal(stale.allowed, false);
      assert.equal(stale.reason, REASON.STATE_VERSION_MISMATCH,
        'refusing on conflict is an acceptable V1; guessing is not');
    });

    // ----- A-3: privilege escalation -----

    await t.test('A-3: you cannot grant a capability you do not hold', () => {
      const ownerRole = db.getCommunityRole(community.id, 'owner');
      const got = canGrantRole(db, users.admin.id, community.id, ownerRole);
      assert.equal(got.allowed, false, 'an admin must not be able to mint an owner');
      assert.ok([REASON.CANNOT_GRANT_UNHELD, REASON.OUTRANKED].includes(got.reason));

      // And the same through a custom role, since the role table is data a user
      // controls and the label proves nothing.
      const sneaky = db.createCommunityRole(community.id, {
        name: 'helper', priority: 50, permissions: [CAPABILITIES.DELETE_COMMUNITY],
      });
      assert.equal(canGrantRole(db, users.admin.id, community.id, sneaky).reason,
        REASON.CANNOT_GRANT_UNHELD);
    });

    await t.test('A-3: a moderator cannot grant roles at all', () => {
      const memberRole = db.getCommunityRole(community.id, 'member');
      assert.equal(canGrantRole(db, users.mod.id, community.id, memberRole).reason,
        REASON.MISSING_CAPABILITY);
    });

    await t.test('A-3: nobody may create a peer who outranks or matches them', () => {
      const adminRole = db.getCommunityRole(community.id, 'admin');
      assert.equal(canGrantRole(db, users.admin.id, community.id, adminRole).allowed, false,
        'equal priority is refused, not just higher');
    });

    await t.test('A-3: role priority inversion is blocked on edit', () => {
      // The subtle one: a moderator editing the admin role rewrites the powers
      // of people above them without ever touching a membership.
      const adminRole = db.getCommunityRole(community.id, 'admin');
      assert.equal(canEditRole(db, users.mod.id, community.id, adminRole).allowed, false);

      const custom = db.createCommunityRole(community.id, {
        name: 'crew', priority: 250, permissions: [CAPABILITIES.VIEW_MEMBERS],
      });
      assert.equal(canEditRole(db, users.mod.id, community.id, custom).allowed, false,
        'a role above the actor is not editable by them');
    });

    await t.test('CORTEX-COMM-004: a role cannot be RAISED above the actor', () => {
      // The old test here only ever edited an already-higher role, so it never
      // tried the direction the attack uses: take a low role you already hold
      // and lift it above the owner. The guard never saw the proposed priority.
      const lowly = db.createCommunityRole(community.id, {
        name: 'stepping-stone', priority: 10, permissions: [CAPABILITIES.VIEW_MEMBERS],
      });
      const adminPriority = db.getMemberPriority(community.id, users.admin.id);

      assert.equal(
        canEditRole(db, users.admin.id, community.id, lowly, { priority: 1000 }).allowed,
        false, 'above the owner');
      assert.equal(
        canEditRole(db, users.admin.id, community.id, lowly, { priority: adminPriority }).allowed,
        false, 'equal to the actor is still an escape — it stops them being actionable');
      assert.equal(
        canEditRole(db, users.admin.id, community.id, lowly, { priority: adminPriority + 1 }).allowed,
        false, 'one above the actor');
      assert.ok(
        canEditRole(db, users.admin.id, community.id, lowly, { priority: adminPriority - 1 }).allowed,
        'and a genuine edit below them still works');

      // Nonsense priorities are refused rather than coerced.
      for (const priority of ['1000', 1.5, Infinity, NaN, {}]) {
        assert.equal(
          canEditRole(db, users.admin.id, community.id, lowly, { priority }).allowed,
          false, `priority ${JSON.stringify(priority)} must be refused`);
      }
    });

    await t.test('A-3: managed roles are not editable, including by the owner', () => {
      for (const name of ['owner', 'admin', 'moderator', 'member']) {
        const role = db.getCommunityRole(community.id, name);
        assert.equal(canEditRole(db, users.owner.id, community.id, role).allowed, false,
          `${name} must stay as defined`);
      }
    });

    await t.test('A-3: an edit cannot add capabilities the editor lacks', () => {
      const custom = db.createCommunityRole(community.id, {
        name: 'stagehand', priority: 50, permissions: [CAPABILITIES.VIEW_MEMBERS],
      });
      assert.ok(canEditRole(db, users.admin.id, community.id, custom, { permissions: [CAPABILITIES.MANAGE_EVENTS] }).allowed);
      assert.equal(
        canEditRole(db, users.admin.id, community.id, custom, { permissions: [CAPABILITIES.DELETE_COMMUNITY] }).reason,
        REASON.CANNOT_GRANT_UNHELD);
    });

    await t.test('A-3: acting on a member requires strictly outranking them', () => {
      assert.ok(canActOnMember(db, users.owner.id, users.member.id, community.id).allowed);
      assert.ok(canActOnMember(db, users.admin.id, users.mod.id, community.id).allowed);
      assert.equal(canActOnMember(db, users.mod.id, users.admin.id, community.id).allowed, false);
      assert.equal(canActOnMember(db, users.member.id, users.member.id, community.id).allowed, false,
        'self is not an action on a member — leaving is a different operation');

      // Two admins must not be able to remove each other.
      const second = db.addCommunityMember(community.id, users.outsider.id, { state: 'active' });
      db.grantCommunityRole(second, db.getCommunityRole(community.id, 'admin').id);
      assert.equal(canActOnMember(db, users.admin.id, users.outsider.id, community.id).allowed, false,
        'equal priority — a Community that can be decapitated in one exchange');
      db.setCommunityMemberState(community.id, users.outsider.id, 'left');
    });

    await t.test('A-3: an invite may never confer administrative powers', () => {
      // An invite link is a bearer token that travels through chat and email.
      assert.equal(canInviteConferRole(db.getCommunityRole(community.id, 'owner')).allowed, false);
      assert.equal(canInviteConferRole(db.getCommunityRole(community.id, 'admin')).allowed, false);
      assert.ok(canInviteConferRole(db.getCommunityRole(community.id, 'member')).allowed);

      // Checked by capability, not by name — the same problem wearing a
      // different label must not get through.
      const disguised = db.createCommunityRole(community.id, {
        name: 'greeter', priority: 60, permissions: [CAPABILITIES.MANAGE_ROLES],
      });
      assert.equal(canInviteConferRole(disguised).allowed, false);
      assert.equal(canInviteConferRole(disguised).reason, REASON.INVITE_CANNOT_CONFER);
    });

    await t.test('A-3: the last owner cannot leave the Community unadministrable', () => {
      assert.equal(wouldLeaveNoOwner(db, community.id, users.owner.id), true);
      assert.equal(wouldLeaveNoOwner(db, community.id, users.admin.id), false);

      const secondOwner = db.addCommunityMember(community.id, users.member.id, { state: 'active' });
      db.grantCommunityRole(secondOwner, db.getCommunityRole(community.id, 'owner').id);
      assert.equal(wouldLeaveNoOwner(db, community.id, users.owner.id), false,
        'with a second owner, the first may go');
      db.revokeCommunityRole(secondOwner, db.getCommunityRole(community.id, 'owner').id);
    });

    // ----- A-4: cross-Community IDOR -----

    let channel, otherCommunity, otherChannel;
    await t.test('A-4: a resource from another Community is refused', () => {
      channel = db.createChannel({ communityId: community.id, name: 'Main', slug: 'main' });
      otherCommunity = db.createCommunity({ name: 'Other', slug: 'other', createdBy: users.outsider.id });
      otherChannel = db.createChannel({ communityId: otherCommunity.id, name: 'Theirs', slug: 'theirs' });

      assert.ok(authorize(db, local(users.owner.id), community.id, CAPABILITIES.MANAGE_CHANNELS,
        { resource: { type: 'channel', id: channel.id } }).allowed);

      // The owner of THIS Community, holding the capability, acting on a channel
      // that belongs to another. An opaque id makes this hard to guess, which is
      // not a control.
      const got = authorize(db, local(users.owner.id), community.id, CAPABILITIES.MANAGE_CHANNELS,
        { resource: { type: 'channel', id: otherChannel.id } });
      assert.equal(got.allowed, false);
      assert.equal(got.reason, REASON.WRONG_COMMUNITY);
    });

    await t.test('A-4: a resource that does not exist is refused, not ignored', () => {
      const got = authorize(db, local(users.owner.id), community.id, CAPABILITIES.MANAGE_CHANNELS,
        { resource: { type: 'channel', id: 'channel-does-not-exist' } });
      assert.equal(got.allowed, false);
      assert.equal(got.reason, REASON.WRONG_COMMUNITY);
    });

    // ----- The invariant the container model exists for -----

    await t.test('Community membership never confers access to a wave', () => {
      // If this ever passes differently, moving a wave into a Community becomes
      // a mass disclosure and the container model has been defeated.
      const wave = db.createWave({
        title: 'Private rehearsal notes', createdBy: users.member.id, privacy: 'private',
      });
      db.setWaveChannel(wave.id, channel.id);

      // The owner holds every capability in the Community the wave now sits in.
      assert.ok(authorize(db, local(users.owner.id), community.id, CAPABILITIES.MODERATE_CONTENT).allowed);
      assert.ok(authorize(db, local(users.owner.id), community.id, CAPABILITIES.MANAGE_CHANNELS).allowed);

      // And is still not a participant, which is what decides reading.
      assert.equal(db.isWaveParticipant(wave.id, users.owner.id), false,
        'the Community owner must not have become a participant');
      assert.equal(db.isWaveParticipant(wave.id, users.member.id), true);

      // The named guard: this module declines to answer wave access at all.
      const guard = assertNeverGrantsWaveAccess();
      assert.equal(guard.allowed, false);
      assert.match(guard.reason, /never_confers_wave_access/);

      // And there is no capability that could be mistaken for one.
      assert.ok(!Object.values(CAPABILITIES).some(c => /read|view_wave|wave\.read/i.test(c)),
        'no capability may look like it grants wave reading');
    });

    await t.test('channel discovery is gated, and says nothing about content', () => {
      assert.ok(canDiscoverChannel(db, local(users.member.id), channel.id).allowed);
      assert.equal(canDiscoverChannel(db, local(users.outsider.id), channel.id).allowed, false);

      // A node-level channel has no Community to belong to, and this evaluator
      // says so rather than inventing an answer.
      const nodeChannel = db.createChannel({ communityId: null, name: 'Node', slug: 'node-general' });
      const got = canDiscoverChannel(db, local(users.outsider.id), nodeChannel.id);
      assert.equal(got.allowed, true);
      assert.equal(got.nodeLevel, true);
    });
  } finally {
    cleanup();
  }
});
