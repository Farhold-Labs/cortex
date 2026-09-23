/**
 * The Community authorization evaluator (v2.95.0, Communities Phase 2)
 *
 * THE single place that answers "may this actor do this here". Implementation
 * plan §3: no controller may compute Community permissions inline. Cortex has
 * lost real time to duplicated permission logic before — the wave row menu
 * existing twice in v2.84.1, notification defaults in three places in v2.66.0 —
 * and a permission check is a considerably worse thing to have two of.
 *
 * WHAT THIS DOES NOT DECIDE
 * Reading a wave. Per §2b of the plan a channel is a CONTAINER that holds
 * waves, and:
 *
 *     Channel visibility gates DISCOVERY. Wave privacy gates CONTENT.
 *
 * So this module can say a channel is listable, and it must never be consulted
 * to decide whether a member may open a wave inside it — that stays with the
 * wave's own participants and privacy. The moment Community membership starts
 * conferring read access to waves, moving a wave into a Community becomes a mass
 * disclosure, which is precisely what the container model exists to prevent.
 * There is deliberately no `canReadWave` here, and `assertNeverGrantsWaveAccess`
 * below exists so a future refactor has to delete a named guard to break it.
 *
 * ACTORS MAY BE REMOTE, FROM DAY ONE
 * Plan §1.2: write this to take an actor that may be remote even while every
 * Phase 3 caller passes a local one, or Phase 4 rewrites it. Two kinds:
 *
 *   { kind: 'user', userId }                     a local session
 *   { kind: 'federated', handle, node }          asserted by a peer node
 *
 * A federated actor is resolved to a local `users` row — under plan §2 a remote
 * member arrives through cross-port auth and genuinely has one — and is DENIED
 * if no such row exists. This is threat model A-1: a well-signed envelope saying
 * "Alice banned Bob" proves the peer said it, not that Alice held `member.ban`
 * in THIS node's view of state. We verify the premise, never the conclusion.
 *
 * FAILS CLOSED
 * Unknown capability, missing Community, suspended Community, unresolvable
 * actor, corrupt role data, thrown error — all DENY. A permission system that
 * fails open is not one.
 */
import { CAPABILITIES, CAPABILITY_VALUES, parsePermissions } from './capabilities.js';

/** Why a decision went the way it did. Recorded in audit, shown to nobody. */
export const REASON = {
  ALLOWED: 'allowed',
  NO_COMMUNITY: 'community_not_found',
  COMMUNITY_INACTIVE: 'community_not_active',
  UNKNOWN_CAPABILITY: 'unknown_capability',
  ACTOR_UNRESOLVED: 'actor_unresolved',
  NOT_A_MEMBER: 'not_a_member',
  MEMBERSHIP_INACTIVE: 'membership_not_active',
  BANNED: 'banned',
  MISSING_CAPABILITY: 'missing_capability',
  WRONG_COMMUNITY: 'resource_belongs_to_another_community',
  STATE_VERSION_MISMATCH: 'state_version_mismatch',
  OUTRANKED: 'target_outranks_actor',
  CANNOT_GRANT_UNHELD: 'cannot_grant_capability_not_held',
  LAST_OWNER: 'would_leave_community_without_an_owner',
  INVITE_CANNOT_CONFER: 'invite_may_not_confer_this_role',
  HOME_NODE_INACTIVE: 'home_node_no_longer_federated',
};

const deny = (reason, detail) => ({ allowed: false, reason, ...(detail ? { detail } : {}) });
const allow = (extra = {}) => ({ allowed: true, reason: REASON.ALLOWED, ...extra });

/**
 * Resolve an actor to a local user id.
 *
 * Federated actors are matched against the cross-port stub rows that
 * `upsertCrossPortUser` creates (`is_cross_port = 1`, `home_node`,
 * `home_user_id`). Matching on home node AND handle rather than handle alone,
 * because handles collide across nodes — cross-port auth already suffixes them
 * (`_<shortnode>`) for exactly that reason, so the local handle is not the
 * remote one and must not be compared against it.
 */
export function resolveActor(db, actor) {
  if (!actor || typeof actor !== 'object') return null;

  if (actor.kind === 'user') {
    if (!actor.userId) return null;
    const row = db.db.prepare('SELECT id FROM users WHERE id = ?').get(actor.userId);
    return row ? row.id : null;
  }

  if (actor.kind === 'federated') {
    if (!actor.node || (!actor.handle && !actor.homeUserId)) return null;
    // home_user_id is the stable identifier; handle is what a person typed and
    // can be changed at home. Prefer the former when the peer supplies it.
    const row = actor.homeUserId
      ? db.db.prepare('SELECT id FROM users WHERE is_cross_port = 1 AND home_node = ? AND home_user_id = ?')
          .get(actor.node, actor.homeUserId)
      : db.db.prepare('SELECT id FROM users WHERE is_cross_port = 1 AND home_node = ? AND home_user_id IS NOT NULL AND handle LIKE ?')
          .get(actor.node, `${actor.handle}%`);
    return row ? row.id : null;
  }

  return null;
}


/**
 * Is a cross-port member's home node still vouching for them?
 *
 * Local users always pass — they have no home node but this one. For a
 * cross-port user the answer is whether their `home_node` is still an **active**
 * federation peer: a suspended or removed node means the party that vouched for
 * this person no longer does, and the rights they hold here were only ever
 * borrowed from that relationship.
 *
 * NOTE, deliberately scoped: this gates COMMUNITIES only. A cross-port user
 * whose node is unpaired keeps any local session and any wave participation
 * they already had — changing that is a node-wide authentication decision, not
 * one for this evaluator to make unilaterally. It is recorded in the threat
 * model as an open question rather than silently decided here.
 */
export function homeNodeStanding(db, userId) {
  const user = db.db.prepare('SELECT is_cross_port, home_node FROM users WHERE id = ?').get(userId);
  if (!user) return { ok: false, detail: 'no such user' };
  if (!user.is_cross_port) return { ok: true };
  if (!user.home_node) return { ok: false, detail: 'cross-port user with no home node' };

  const node = db.getFederationNodeByName(user.home_node);
  if (!node) return { ok: false, detail: `${user.home_node} is no longer a peer` };
  if (node.status !== 'active') return { ok: false, detail: `${user.home_node} is ${node.status}` };
  return { ok: true };
}

/**
 * The evaluator.
 *
 * @param {object}  db          DatabaseSQLite
 * @param {object}  actor       { kind: 'user'|'federated', ... }
 * @param {string}  communityId
 * @param {string}  capability  one of CAPABILITIES
 * @param {object}  [options]
 * @param {object}  [options.resource]  { type, id } — checked to belong to this
 *                                      Community (threat model A-4)
 * @param {number}  [options.expectedStateVersion]  A-2: a mutation may commit to
 *                                      the state it believed it was acting on.
 * @returns {{allowed: boolean, reason: string, detail?: string}}
 */
export function authorize(db, actor, communityId, capability, options = {}) {
  try {
    if (!CAPABILITY_VALUES.includes(capability)) return deny(REASON.UNKNOWN_CAPABILITY, capability);

    const community = db.getCommunityById(communityId);
    if (!community) return deny(REASON.NO_COMMUNITY);
    // A suspended Community is frozen for everyone including its owner. The
    // node admin who suspended it is acting outside it, not within it.
    if (community.status !== 'active') return deny(REASON.COMMUNITY_INACTIVE, community.status);

    const userId = resolveActor(db, actor);
    if (!userId) return deny(REASON.ACTOR_UNRESOLVED);

    // A-4: the resource must belong to THIS Community. An opaque globally
    // unique id makes guessing hard, which is authorization by obscurity and
    // not a control.
    if (options.resource) {
      const ownership = resourceCommunity(db, options.resource);
      if (ownership === undefined) return deny(REASON.WRONG_COMMUNITY, 'unknown resource');
      if (ownership !== communityId) return deny(REASON.WRONG_COMMUNITY);
    }

    // A-2: evaluate against the state version the caller committed to, never
    // against wall-clock time — timestamps are attacker-controlled and clocks
    // disagree. Refusing on conflict is an acceptable V1; guessing is not.
    if (options.expectedStateVersion != null &&
        Number(options.expectedStateVersion) !== Number(community.state_version)) {
      return deny(REASON.STATE_VERSION_MISMATCH,
        `expected ${options.expectedStateVersion}, current ${community.state_version}`);
    }

    // A remote member's standing here is borrowed from their home node, and a
    // borrowed thing has to be given back when the lender withdraws.
    //
    // Before v2.97.0 nothing checked this: a cross-port user's stub row behaved
    // like a local account forever, so suspending or unpairing the node that
    // vouched for them left their Community membership fully intact. Unpairing
    // a node has to mean something.
    const standing = homeNodeStanding(db, userId);
    if (!standing.ok) return deny(REASON.HOME_NODE_INACTIVE, standing.detail);

    // A ban outranks every capability, including one held through a role that
    // was never revoked.
    if (db.getCommunityBan(communityId, userId)) return deny(REASON.BANNED);

    const membership = db.getCommunityMembership(communityId, userId);
    if (!membership) return deny(REASON.NOT_A_MEMBER);
    if (membership.state !== 'active') return deny(REASON.MEMBERSHIP_INACTIVE, membership.state);

    const held = db.getMemberCapabilities(communityId, userId);
    if (!held.has(capability)) return deny(REASON.MISSING_CAPABILITY, capability);

    return allow({ userId });
  } catch (err) {
    console.error('[communities/authorize] evaluation failed:', err);
    return deny(REASON.ACTOR_UNRESOLVED, 'evaluation error');
  }
}

/**
 * Every capability an actor effectively holds here, with the same gates applied
 * as a single check — inactive Community, withdrawn home node, ban, lapsed
 * membership all produce an EMPTY set.
 *
 * This exists because a caller that wants the whole list would otherwise reach
 * past the evaluator to `db.getMemberCapabilities`, which knows about roles and
 * nothing about standing. A two-node test caught exactly that: suspending a
 * remote member's home node correctly refused every gated endpoint while the
 * Community detail route cheerfully went on reporting her full capability list,
 * because it was computing it itself.
 *
 * So: anything that needs to know what an actor can do asks here, and policy
 * stays in one place.
 */
export function effectiveCapabilities(db, actor, communityId) {
  try {
    const community = db.getCommunityById(communityId);
    if (!community || community.status !== 'active') return new Set();

    const userId = resolveActor(db, actor);
    if (!userId) return new Set();
    if (!homeNodeStanding(db, userId).ok) return new Set();
    if (db.getCommunityBan(communityId, userId)) return new Set();

    const membership = db.getCommunityMembership(communityId, userId);
    if (!membership || membership.state !== 'active') return new Set();

    return db.getMemberCapabilities(communityId, userId);
  } catch (err) {
    // An exception inside an authorization check is an outage if it propagates
    // and a vulnerability if it is swallowed into an allow. Deny, loudly.
    console.error('[communities/authorize] evaluation failed:', err);
    return deny(REASON.ACTOR_UNRESOLVED, 'evaluation error');
  }
}

/** Which Community a resource belongs to. `undefined` means "no such resource". */
function resourceCommunity(db, resource) {
  if (!resource || !resource.type || !resource.id) return undefined;
  switch (resource.type) {
    case 'channel': {
      const row = db.getChannelById(resource.id);
      return row ? row.community_id : undefined;
    }
    case 'membership': {
      const row = db.db.prepare('SELECT community_id FROM community_memberships WHERE id = ?').get(resource.id);
      return row ? row.community_id : undefined;
    }
    case 'role': {
      const row = db.db.prepare('SELECT community_id FROM community_roles WHERE id = ?').get(resource.id);
      return row ? row.community_id : undefined;
    }
    case 'wave': {
      // Present so a handler can confirm a wave is filed in this Community.
      // This says nothing about whether the actor may READ it — see the header.
      const row = db.db.prepare('SELECT community_id FROM waves WHERE id = ?').get(resource.id);
      return row ? row.community_id : undefined;
    }
    default:
      return undefined;
  }
}

// ===== A-3: privilege escalation within a Community =====
//
// Each of these is a specific authorization question with a wrong answer that is
// easy to arrive at by accident, so each gets a named function rather than being
// left to callers to remember.

/**
 * May `actor` act on `target` at all — remove, ban, change roles?
 *
 * Strictly greater priority. EQUAL priority is refused on purpose: two admins
 * who can remove each other is a Community that can be decapitated in one
 * exchange, and self-action is handled by the caller (leaving is not removal).
 */
export function canActOnMember(db, actorUserId, targetUserId, communityId) {
  if (actorUserId === targetUserId) return deny(REASON.OUTRANKED, 'self');
  const actorPriority = db.getMemberPriority(communityId, actorUserId);
  const targetPriority = db.getMemberPriority(communityId, targetUserId);
  if (actorPriority <= targetPriority) return deny(REASON.OUTRANKED);
  return allow();
}

/**
 * May `actor` grant `role` to someone?
 *
 * **You cannot grant a capability you do not hold.** Without this an admin
 * grants themselves owner, or a moderator mints a role holding powers they were
 * never given — the role table is data, and data a user controls.
 *
 * The role must also sit strictly below the granter's own priority, so nobody
 * can create a peer who then outranks nobody but can never be removed either.
 */
export function canGrantRole(db, actorUserId, communityId, role) {
  const held = db.getMemberCapabilities(communityId, actorUserId);
  if (!held.has(CAPABILITIES.MANAGE_ROLES)) return deny(REASON.MISSING_CAPABILITY, CAPABILITIES.MANAGE_ROLES);

  const granting = parsePermissions(role && role.permissions);
  const unheld = granting.filter(cap => !held.has(cap));
  if (unheld.length) return deny(REASON.CANNOT_GRANT_UNHELD, unheld.join(','));

  const actorPriority = db.getMemberPriority(communityId, actorUserId);
  if (Number(role.priority) >= actorPriority) return deny(REASON.OUTRANKED, 'role priority');

  return allow();
}

/**
 * May `actor` edit this role's definition?
 *
 * Priority inversion is the trap: a moderator editing the admin role's
 * permission list rewrites the powers of people above them without ever
 * touching a membership. Managed roles are not editable at all — `owner`
 * especially, since an owner who revokes their own management capability has no
 * route back that does not involve a node admin.
 */
export function canEditRole(db, actorUserId, communityId, role, changes = {}) {
  if (!role) return deny(REASON.WRONG_COMMUNITY, 'unknown role');
  if (role.community_id !== communityId) return deny(REASON.WRONG_COMMUNITY);
  if (role.managed) return deny(REASON.MISSING_CAPABILITY, 'role is managed');

  const held = db.getMemberCapabilities(communityId, actorUserId);
  if (!held.has(CAPABILITIES.MANAGE_ROLES)) return deny(REASON.MISSING_CAPABILITY, CAPABILITIES.MANAGE_ROLES);

  const actorPriority = db.getMemberPriority(communityId, actorUserId);
  if (Number(role.priority) >= actorPriority) return deny(REASON.OUTRANKED, 'role priority');

  // CORTEX-COMM-004 — judge the role it is about to BECOME, not only the one
  // it is now.
  //
  // This checked the role's current priority and its proposed permissions, and
  // never saw the proposed priority at all. So an admin could take a harmless
  // role they already held, raise it to 1000, and outrank the owner — their
  // existing admin capabilities then supplying the remove and ban powers to
  // act on them. The escalation needed no capability nobody had granted; it
  // needed only a number the guard never looked at.
  if (changes.priority !== undefined && changes.priority !== null) {
    const nextPriority = Number(changes.priority);
    if (!Number.isInteger(nextPriority)) return deny(REASON.OUTRANKED, 'priority must be a whole number');
    if (nextPriority >= actorPriority) return deny(REASON.OUTRANKED, 'proposed role priority');
  }

  if (changes.permissions) {
    const unheld = parsePermissions(changes.permissions).filter(cap => !held.has(cap));
    if (unheld.length) return deny(REASON.CANNOT_GRANT_UNHELD, unheld.join(','));
  }
  return allow();
}

/**
 * Roles an invite may confer. Brief §17: never OWNER or ADMIN.
 *
 * An invite link is a bearer token that travels through chat and email. A link
 * that makes its redeemer an administrator is a link that gives the Community
 * away to whoever forwards it.
 */
export function canInviteConferRole(role) {
  if (!role) return allow();
  if (role.managed && (role.name === 'owner' || role.name === 'admin')) {
    return deny(REASON.INVITE_CANNOT_CONFER, role.name);
  }
  const granting = parsePermissions(role.permissions);
  // A custom role that holds administrative powers is the same problem wearing
  // a different name, so this checks capabilities rather than trusting the label.
  for (const cap of [CAPABILITIES.MANAGE_ROLES, CAPABILITIES.MANAGE_COMMUNITY,
                     CAPABILITIES.DELETE_COMMUNITY, CAPABILITIES.TRANSFER_OWNER]) {
    if (granting.includes(cap)) return deny(REASON.INVITE_CANNOT_CONFER, cap);
  }
  return allow();
}

/**
 * Would this leave the Community with no owner?
 *
 * Must be evaluated inside the same transaction as the mutation it guards —
 * checking first and writing afterwards is a race, and the failure mode is a
 * Community nobody can administer, which is unrecoverable without a node admin.
 */
export function wouldLeaveNoOwner(db, communityId, departingUserId) {
  const ownerRole = db.getCommunityRole(communityId, 'owner');
  if (!ownerRole) return true;
  const owners = db.db.prepare(`
    SELECT m.user_id FROM community_membership_roles mr
    JOIN community_memberships m ON m.id = mr.membership_id
    WHERE mr.role_id = ? AND m.state = 'active'
  `).all(ownerRole.id).map(r => r.user_id);
  return owners.length <= 1 && owners.includes(departingUserId);
}


/**
 * What an actor may do IN A PARTICULAR CHANNEL (v2.103.3).
 *
 * CORTEX-COMM-011 — `visibility: 'restricted'` and the `channel_permissions`
 * table both shipped in Phase 1, and nothing ever read them. A restricted
 * channel restricted nothing: an ordinary member could list it, and create or
 * file waves in it, on their Community-wide capabilities alone. The schema
 * described a control that did not exist, which is worse than not offering one.
 *
 * The rule now:
 *
 *   * start from what the member holds across the Community;
 *   * apply any per-role overrides stored for this channel — `deny` removes,
 *     `allow` adds;
 *   * and for a RESTRICTED channel, hold nothing at all unless a role they
 *     hold was explicitly allowed to view it, or they may manage channels.
 *
 * Restricted controls ADMISSION, not enumeration. Being let in means the
 * member's ordinary Community role governs what they do inside — otherwise
 * every restricted channel would need each capability listed separately before
 * it was usable at all, and the common case (let this role into the staff room)
 * would be the awkward one. `deny` remains for taking a single thing away
 * without shutting the door.
 *
 * Staff who manage channels keep access on purpose: a restricted channel that
 * its own Community's administrators cannot see is a place to hide things from
 * the people answerable for them.
 *
 * NOTE — this decides the CHANNEL, never the waves inside it. A member who may
 * see a channel still gets nothing from it they could not already read; wave
 * privacy and participants remain the content authority, exactly as in §2b.
 */
export function channelCapabilities(db, actor, channel) {
  if (!channel) return new Set();
  // A node-level channel belongs to no Community, so there is no membership to
  // consult; whether the node lists it is the caller's business.
  if (!channel.community_id) return new Set();

  const base = effectiveCapabilities(db, actor, channel.community_id);
  if (!base.size) return new Set();

  const userId = resolveActor(db, actor);
  if (!userId) return new Set();

  const effective = new Set(base);
  let viewExplicitlyAllowed = false;

  for (const role of db.getMemberRoles(channel.community_id, userId)) {
    const row = db.getChannelPermission(channel.id, role.id);
    if (!row) continue;
    for (const cap of parsePermissions(row.deny)) effective.delete(cap);
    for (const cap of parsePermissions(row.allow)) {
      effective.add(cap);
      if (cap === CAPABILITIES.VIEW_CHANNEL) viewExplicitlyAllowed = true;
    }
  }

  if (channel.visibility === 'restricted'
      && !viewExplicitlyAllowed
      && !base.has(CAPABILITIES.MANAGE_CHANNELS)) {
    return new Set();
  }

  // A deny on view takes everything with it — being unable to see a channel
  // and still being able to post into it is not a coherent state.
  if (!effective.has(CAPABILITIES.VIEW_CHANNEL)) return new Set();

  return effective;
}

/** Convenience: may this actor do `capability` in this channel? */
export function canInChannel(db, actor, channel, capability) {
  return channelCapabilities(db, actor, channel).has(capability);
}

/**
 * Channel DISCOVERY only — whether a channel is listed for this actor.
 *
 * Never call this to decide whether a wave inside the channel may be opened.
 * See the module header: a private wave in a visible channel stays private.
 */
export function canDiscoverChannel(db, actor, channelId) {
  const channel = db.getChannelById(channelId);
  if (!channel) return deny(REASON.WRONG_COMMUNITY, 'unknown channel');

  // A node-level channel has no Community to be a member of. Whether the node
  // itself lists it is the caller's business — this evaluator covers
  // Communities, and says so rather than inventing an answer.
  if (channel.community_id === null) return allow({ nodeLevel: true });

  const gate = authorize(db, actor, channel.community_id, CAPABILITIES.VIEW_CHANNEL,
    { resource: { type: 'channel', id: channelId } });
  if (!gate.allowed) return gate;

  // Community-wide view is necessary but no longer sufficient: a restricted
  // channel asks again, per channel (CORTEX-COMM-011).
  if (!canInChannel(db, actor, channel, CAPABILITIES.VIEW_CHANNEL)) {
    return deny(REASON.MISSING_CAPABILITY, 'channel is restricted');
  }
  return gate;
}

/**
 * A guard with a name, so that removing it is a deliberate act.
 *
 * Returns the wave-access decision this module is permitted to make, which is
 * none. If a future caller reaches for Community membership to decide whether
 * someone may read a wave, they have to delete this to do it.
 */
export function assertNeverGrantsWaveAccess() {
  return {
    allowed: false,
    reason: 'community_membership_never_confers_wave_access',
    detail: 'Wave privacy and participants decide who may read a wave. See plan §2b.',
  };
}
