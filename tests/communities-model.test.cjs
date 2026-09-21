'use strict';

// Communities domain model (v2.94.0, Phase 1).
//
// There are no routes on any of this yet, so these tests go straight at the
// model. That is the right level for Phase 1: the schema is the expensive thing
// to change later, and the decisions worth defending are structural.
//
// The one that matters most is the LAST group. A Community channel is a
// container that holds waves, not a wave itself, and the entire justification
// for that choice is that moving a wave in or out changes nobody's access. If
// that stops being true, migrating a wave into a Community becomes a mass
// disclosure — which is exactly what the earlier channel-is-a-wave design would
// have done. Those tests are the guard on it.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');

/** A throwaway database with the real migrations applied, and some users. */
async function freshDb() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-communities-'));
  fs.mkdirSync(path.join(temp, 'data'));
  const { DatabaseSQLite } = await import('../server/database-sqlite.js');
  const db = new DatabaseSQLite({ dbPath: path.join(temp, 'data/farhold.db') });

  const users = {};
  for (const handle of ['owner', 'admin', 'member', 'stranger']) {
    users[handle] = db.createUser({
      id: `user-${handle}`,
      handle,
      email: `${handle}@example.test`,
      passwordHash: 'not-a-real-hash',
      displayName: handle,
    });
  }
  return { db, users, cleanup: () => { try { db.close(); } catch {} fs.rmSync(temp, { recursive: true, force: true }); } };
}

test('Communities Phase 1 domain model', async (t) => {
  const { db, users, cleanup } = await freshDb();
  const { CAPABILITIES } = await import('../server/lib/communities/capabilities.js');

  try {
    await t.test('the migration actually added the wave container columns', () => {
      // generate-schema --check compares object COUNTS, so it cannot detect a
      // missing column (CLAUDE.md records this). Checked explicitly here.
      const cols = db.db.prepare('PRAGMA table_info(waves)').all().map(c => c.name);
      assert.ok(cols.includes('community_id'), 'waves.community_id missing');
      assert.ok(cols.includes('channel_id'), 'waves.channel_id missing');
    });

    let community;
    await t.test('a new Community is seeded with its built-in roles and an owner', () => {
      community = db.createCommunity({
        name: 'Theatre Talk', slug: 'theatre-talk',
        visibility: 'public', createdBy: users.owner.id,
      });
      assert.equal(community.visibility, 'public');
      assert.equal(community.status, 'active');

      const roles = db.listCommunityRoles(community.id).map(r => r.name);
      assert.deepEqual(roles, ['owner', 'admin', 'moderator', 'member'],
        'built-in roles must exist, highest priority first');
      assert.ok(db.listCommunityRoles(community.id).every(r => r.managed === 1));

      // Ownership is a role, not a column, so there is one place to read it.
      const caps = db.getMemberCapabilities(community.id, users.owner.id);
      assert.ok(caps.has(CAPABILITIES.DELETE_COMMUNITY), 'creator must own the Community');
    });

    await t.test('a Community without a creator still gets its roles', () => {
      // Guards the transaction: a Community that exists without built-in roles
      // is one nobody can administer, including whoever just made it.
      const orphan = db.createCommunity({ name: 'Imported', slug: 'imported' });
      assert.equal(db.listCommunityRoles(orphan.id).length, 4);
      assert.equal(db.listCommunityMembers(orphan.id).length, 0);
    });

    await t.test('an ordinary member holds member powers and no more', () => {
      const membershipId = db.addCommunityMember(community.id, users.member.id);
      db.grantCommunityRole(membershipId, db.getCommunityRole(community.id, 'member').id);

      const caps = db.getMemberCapabilities(community.id, users.member.id);
      assert.ok(caps.has(CAPABILITIES.CREATE_WAVE), 'a member may start a conversation');
      assert.ok(!caps.has(CAPABILITIES.MANAGE_CHANNELS), 'a member may not restructure the Community');
      assert.ok(!caps.has(CAPABILITIES.BAN_MEMBER));
      assert.ok(!caps.has(CAPABILITIES.DELETE_COMMUNITY));
    });

    await t.test('a non-member holds nothing', () => {
      assert.equal(db.getMemberCapabilities(community.id, users.stranger.id).size, 0);
      assert.equal(db.getMemberPriority(community.id, users.stranger.id), -1);
    });

    await t.test('capabilities are a union, not a ladder', () => {
      // Roles are sets, deliberately: a Community may want someone who runs
      // events but does not touch members. Priority orders people, not powers.
      const membershipId = db.addCommunityMember(community.id, users.admin.id);
      db.grantCommunityRole(membershipId, db.getCommunityRole(community.id, 'moderator').id);
      db.grantCommunityRole(membershipId, db.getCommunityRole(community.id, 'member').id);

      const caps = db.getMemberCapabilities(community.id, users.admin.id);
      assert.ok(caps.has(CAPABILITIES.MODERATE_CONTENT), 'from moderator');
      assert.ok(caps.has(CAPABILITIES.CREATE_WAVE), 'from member');
      assert.ok(!caps.has(CAPABILITIES.MANAGE_COMMUNITY), 'neither role grants this');
      assert.equal(db.getMemberPriority(community.id, users.admin.id), 200, 'highest role wins');
    });

    await t.test('CORTEX-COMM-005: removal revokes the grants, not just the powers', () => {
      // This test used to assert the opposite — that the role rows survived
      // removal so a rejoin could restore them — and an audit showed why that
      // was wrong: a removed admin could walk back in through an ordinary join
      // and be an admin again, with nobody granting them anything.
      //
      // Removal that the removed person can undo is not removal.
      db.setCommunityMemberState(community.id, users.member.id, 'removed');
      assert.equal(db.getMemberRoles(community.id, users.member.id).length, 0, 'the grants are gone');
      assert.equal(db.getMemberCapabilities(community.id, users.member.id).size, 0);
      assert.equal(db.getMemberPriority(community.id, users.member.id), -1);

      // What was taken is recorded where the member cannot restore it from.
      assert.ok(
        db.listCommunityAudit(community.id).some(e => e.action === 'role.revoked_on_exit'),
        'and the audit records what was revoked');
    });

    await t.test('rejoining after removal confers nothing on its own', () => {
      const before = db.getCommunityMembership(community.id, users.member.id);
      db.addCommunityMember(community.id, users.member.id, { state: 'active' });
      const after = db.getCommunityMembership(community.id, users.member.id);
      assert.equal(after.id, before.id, 'the row is still reused, so history survives');
      assert.ok(after.version > before.version);
      assert.equal(db.getMemberCapabilities(community.id, users.member.id).size, 0,
        'but coming back is not a grant');

      // Whoever readmitted them decides what they get, which is the point.
      db.grantCommunityRole(after.id, db.getCommunityRole(community.id, 'member').id);
      assert.ok(db.getMemberCapabilities(community.id, users.member.id).has(CAPABILITIES.CREATE_WAVE));
    });

    await t.test('leaving voluntarily keeps the rank you set down', () => {
      // Removal and leaving were one code path and one behaviour, which is how
      // the unsafe half went unnoticed. They are now distinct: leaving is the
      // member's own decision, so coming back to what you had is reasonable.
      const membershipId = db.getCommunityMembership(community.id, users.member.id).id;
      db.grantCommunityRole(membershipId, db.getCommunityRole(community.id, 'moderator').id);
      db.setCommunityMemberState(community.id, users.member.id, 'left');
      assert.ok(db.getMemberRoles(community.id, users.member.id).length > 0, 'grants kept');
      assert.equal(db.getMemberCapabilities(community.id, users.member.id).size, 0,
        'though they confer nothing while away');

      db.addCommunityMember(community.id, users.member.id, { state: 'active' });
      assert.ok(db.getMemberCapabilities(community.id, users.member.id).has(CAPABILITIES.MODERATE_CONTENT));

      // Leave the fixture as the later tests expect it.
      db.revokeCommunityRole(membershipId, db.getCommunityRole(community.id, 'moderator').id);
    });

    await t.test('a built-in role cannot be deleted, a custom one can', () => {
      assert.equal(db.deleteCommunityRole(db.getCommunityRole(community.id, 'owner').id), false);
      const custom = db.createCommunityRole(community.id, {
        name: 'stage-manager', priority: 150, permissions: [CAPABILITIES.MANAGE_EVENTS],
      });
      assert.equal(db.deleteCommunityRole(custom.id), true);
    });

    await t.test('an unrecognised capability string is dropped, not stored', () => {
      // A typo must not become a role that silently holds a power nothing checks.
      const role = db.createCommunityRole(community.id, {
        name: 'typo', permissions: [CAPABILITIES.VIEW_MEMBERS, 'member.banish'],
      });
      assert.deepEqual(JSON.parse(role.permissions), [CAPABILITIES.VIEW_MEMBERS]);
    });

    await t.test('a corrupt permissions blob denies rather than throws', () => {
      // An exception inside an authorization check is an outage; an empty set
      // merely denies, which is the direction this is meant to fail in.
      const role = db.createCommunityRole(community.id, { name: 'broken', permissions: [] });
      db.db.prepare('UPDATE community_roles SET permissions = ? WHERE id = ?').run('{not json', role.id);
      const membershipId = db.getCommunityMembership(community.id, users.member.id).id;
      db.grantCommunityRole(membershipId, role.id);
      assert.doesNotThrow(() => db.getMemberCapabilities(community.id, users.member.id));
      db.revokeCommunityRole(membershipId, role.id);
    });

    await t.test('banning removes the membership and the ban outlives it', () => {
      db.banFromCommunity(community.id, users.stranger.id, { reason: 'spam', bannedBy: users.owner.id });
      assert.ok(db.getCommunityBan(community.id, users.stranger.id), 'ban recorded');

      db.addCommunityMember(community.id, users.stranger.id, { state: 'active' });
      db.setCommunityMemberState(community.id, users.stranger.id, 'left');
      assert.ok(db.getCommunityBan(community.id, users.stranger.id),
        'a ban that vanishes when the membership goes is not a ban');
    });

    await t.test('a banned user cannot be deleted out from under their ban', () => {
      // ON DELETE RESTRICT, and foreign keys are enforced (pragma at
      // database-sqlite.js:400) — so this is a real constraint, not a comment.
      // Deleting the user must fail loudly rather than quietly readmitting them.
      assert.ok(db.getCommunityBan(community.id, users.stranger.id), 'precondition: still banned');
      assert.throws(
        () => db.db.prepare('DELETE FROM users WHERE id = ?').run(users.stranger.id),
        /FOREIGN KEY|constraint/i,
        'a ban that vanishes with the user row is not a ban');
      assert.ok(db.db.prepare('SELECT 1 FROM users WHERE id = ?').get(users.stranger.id),
        'and the delete must not have partially applied');
    });

    await t.test('an expired ban reads as absent but is not destroyed', () => {
      db.banFromCommunity(community.id, users.member.id, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      assert.equal(db.getCommunityBan(community.id, users.member.id), null, 'no longer in force');
      const row = db.db.prepare('SELECT * FROM community_bans WHERE community_id = ? AND user_id = ?')
        .get(community.id, users.member.id);
      assert.ok(row, 'the record that it happened survives for moderators');
      db.db.prepare('DELETE FROM community_bans WHERE id = ?').run(row.id);
      db.setCommunityMemberState(community.id, users.member.id, 'active');
    });

    await t.test('only public Communities are discoverable', () => {
      db.createCommunity({ name: 'Cast Only', slug: 'cast-only', visibility: 'unlisted' });
      db.createCommunity({ name: 'Board', slug: 'board', visibility: 'private' });
      const found = db.listPublicCommunities().map(c => c.slug);
      assert.ok(found.includes('theatre-talk'));
      assert.ok(!found.includes('cast-only'), 'unlisted is reachable by link, never listed');
      assert.ok(!found.includes('board'));
    });

    // ----- Channels as containers: the decision this phase exists to protect -----

    let channel;
    await t.test('channel slugs are unique per container, including at node level', () => {
      channel = db.createChannel({ communityId: community.id, name: 'Productions', slug: 'productions' });

      assert.throws(
        () => db.createChannel({ communityId: community.id, name: 'Dupe', slug: 'productions' }),
        /UNIQUE/, 'two channels with one slug in one Community');

      // Different Communities may of course both have a #general.
      const other = db.getCommunityBySlug('cast-only');
      assert.ok(db.createChannel({ communityId: other.id, name: 'Productions', slug: 'productions' }));

      // And node-level channels must collide with each other — in SQLite two
      // NULLs are distinct in a UNIQUE constraint, so without the IFNULL index
      // a node could accumulate any number of channels slugged 'general'.
      db.createChannel({ communityId: null, name: 'General', slug: 'general' });
      assert.throws(
        () => db.createChannel({ communityId: null, name: 'General Again', slug: 'general' }),
        /UNIQUE/, 'node-level slugs must be unique too');
    });

    await t.test('attaching a wave to a channel changes no one\'s access', async () => {
      // THE invariant. A four-person private wave joining a large Community must
      // not become readable by the Community — that is the failure the container
      // model exists to prevent.
      const wave = db.createWave({
        title: 'Earnest rehearsal', createdBy: users.owner.id, privacy: 'private',
        participants: [users.member.id],
      });

      const participantsBefore = db.getWaveParticipants(wave.id).map(p => p.id).sort();
      const before = db.getWave(wave.id);

      const moved = db.setWaveChannel(wave.id, channel.id);
      assert.equal(moved.channel_id, channel.id);
      assert.equal(moved.community_id, community.id, 'community is derived from the channel');

      const after = db.getWave(wave.id);
      assert.equal(after.privacy, before.privacy, 'privacy must not change');
      assert.equal(after.encrypted, before.encrypted, 'encryption must not change');
      assert.deepEqual(
        db.getWaveParticipants(wave.id).map(p => p.id).sort(),
        participantsBefore,
        'participants must not change — this is what makes migration safe');

      // A Community member who is not a wave participant gains nothing.
      assert.equal(db.getCommunityMembership(community.id, users.admin.id).state, 'active');
      assert.ok(!db.getWaveParticipants(wave.id).some(p => p.id === users.admin.id),
        'Community membership must not confer wave participation');
    });

    await t.test('detaching is equally harmless, so migration works both ways', () => {
      const wave = db.listWavesInChannel(channel.id)[0];
      const participantsBefore = db.getWaveParticipants(wave.id).map(p => p.id).sort();

      const out = db.setWaveChannel(wave.id, null);
      assert.equal(out.channel_id, null);
      assert.equal(out.community_id, null);
      assert.deepEqual(
        db.getWaveParticipants(wave.id).map(p => p.id).sort(),
        participantsBefore,
        'leaving must not strand or mass-add anyone');

      db.setWaveChannel(wave.id, channel.id);
    });

    await t.test('deleting a channel does not delete the waves inside it', () => {
      const doomed = db.createChannel({ communityId: community.id, name: 'Temp', slug: 'temp' });
      const wave = db.listWavesInChannel(channel.id)[0];
      db.setWaveChannel(wave.id, doomed.id);

      db.deleteChannel(doomed.id);

      const after = db.getWave(wave.id);
      assert.ok(after, 'the conversation survives its container');
      assert.equal(after.channelId, null, 'it falls back to uncontained, which is a normal state');
    });

    await t.test('an uncontained wave is the normal case and stays valid', () => {
      // Direct messages and crew waves must never require a Community — forcing
      // a two-person conversation into one would hand that Community's staff a
      // structural claim over it.
      const dm = db.createWave({ title: 'DM', createdBy: users.member.id, privacy: 'private' });
      const row = db.getWave(dm.id);
      assert.equal(row.communityId, null);
      assert.equal(row.channelId, null);
    });

    await t.test('every wave mapper exposes the container, not just the raw row', () => {
      // This file has three wave mappers and they drift — CLAUDE.md records it
      // as a standing trap. A column no mapper exposes is a column no reader
      // can see, so Phase 3 would find channels that appear empty.
      const wave = db.listWavesInChannel(channel.id)[0] || db.createWave({
        title: 'Mapper check', createdBy: users.owner.id, privacy: 'private',
      });
      db.setWaveChannel(wave.id, channel.id);

      const single = db.getWave(wave.id);
      assert.equal(single.channelId, channel.id, 'rowToWave must carry channelId');
      assert.equal(single.communityId, community.id, 'rowToWave must carry communityId');

      const batched = db.getWavesByIds([wave.id]).get(wave.id);
      assert.equal(batched.channelId, channel.id, 'the batch mapper must agree with the single one');
    });

    await t.test('the audit log records metadata and never content', () => {
      db.logCommunityAudit(community.id, {
        actorId: users.owner.id, action: 'channel.create',
        targetType: 'channel', targetId: channel.id, metadata: { name: 'Productions' },
      });
      const entries = db.listCommunityAudit(community.id);
      // Assert what the log CONTAINS, not how much. Counting entries broke the
      // moment revocation started writing its own, which is exactly the sort of
      // brittleness that makes a real regression look like a passing suite
      // needing its number bumped.
      assert.ok(entries.some(e => e.action === 'channel.create'));
      assert.ok(entries.every(e => e.community_id === community.id), 'scoped to this community');
      assert.ok(
        entries.every(e => !JSON.stringify(e.metadata || '').match(/password|token|secret/i)),
        'and never carries a secret');
    });
  } finally {
    cleanup();
  }
});
