/**
 * Community limits and per-actor mutation budgets (v2.98.0, Communities Phase 5)
 *
 * Threat model D-1 (unbounded payloads) and D-2 (federation amplification).
 *
 * THE PRINCIPLE, learned the hard way elsewhere in Cortex: **limits should
 * degrade, not discard.** `BROADCAST_PING_LIMIT` was added after a very long
 * wave produced a federation request receiving nodes rejected outright — losing
 * the entire broadcast rather than most of it. So where a limit applies to a
 * LISTING, it truncates and says so; only a limit on CREATION refuses.
 *
 * Every cap here is deliberately generous. These are not quotas meant to shape
 * behaviour, they are ceilings that stop one account turning a shared node into
 * its own resource. A number a real Community brushes against is a bug in the
 * number, not in the Community.
 */

/** Longest a user-supplied string may be. Enforced at the route. */
export const LENGTHS = Object.freeze({
  communityName: 80,
  communitySlug: 60,
  description: 500,
  channelName: 60,
  roleName: 40,
  banReason: 500,
  address: 320,          // handle@node, RFC-ish upper bound for an address
});

/** Ceilings on how many of a thing may exist. Enforced before creation. */
export const CAPS = Object.freeze({
  // Anyone may create a Community — that is the relief valve that makes
  // admin-only node channels tolerable. This stops one account creating
  // thousands, which is the abuse that openness invites.
  communitiesOwnedPerUser: 25,

  channelsPerCommunity: 200,
  rolesPerCommunity: 60,
  membersPerCommunity: 10000,

  // Live invites, not historical ones: a revoked or exhausted invite costs
  // nothing to keep and is worth keeping for the audit trail.
  activeInvitesPerCommunity: 200,
  pendingRemoteInvitationsPerCommunity: 1000,

  // Listing bounds. These TRUNCATE rather than refuse.
  auditPageSize: 200,
  memberPageSize: 500,

  // How many waves a channel listing will examine to report its count. A
  // channel has no cap on the waves inside it, and the count has to be
  // filtered by what each caller may actually read (CORTEX-COMM-014), so an
  // unbounded channel would mean an unbounded per-request scan for every
  // member who opens the sidebar. Past this the count is reported as a floor.
  channelWaveScan: 500,
});

/**
 * Per-actor budget for state-changing actions, as a sliding window.
 *
 * D-2: once a Community has participating nodes, one local action becomes N
 * signed requests, and a member creating and deleting channels in a loop is a
 * fan-out attack on peers rather than merely a noisy neighbour. HTTP rate
 * limiting does not cover that, because the limit that matters is per ACTOR per
 * COMMUNITY, not per IP.
 *
 * Deliberately separate from the HTTP limiters, and applied only to mutations —
 * reading a Community as fast as you like costs one node one query.
 */
export const MUTATION_BUDGET = Object.freeze({ windowMs: 60_000, max: 60 });

/**
 * PROCESS-LOCAL, like the HLS session state in media-proxy.js. A restart
 * forgives everyone, and a second server process keeps its own count.
 *
 * That is an accepted limit rather than an oversight: this exists to stop a
 * runaway loop, and the durable protections against a determined abuser are the
 * caps above, which are in the database. Making this shared state would mean a
 * round trip on every mutation to slow down an attack the caps already bound.
 */
const buckets = new Map();

/** Trim expired entries so an idle process does not hold every actor it saw. */
function sweep(now) {
  for (const [key, hits] of buckets) {
    const live = hits.filter(t => now - t < MUTATION_BUDGET.windowMs);
    if (live.length) buckets.set(key, live);
    else buckets.delete(key);
  }
}

let lastSweep = 0;

/**
 * Record one mutation and report whether it is within budget.
 *
 * Returns `{ ok, retryAfterSeconds }`. Call it once per mutation, at the point
 * the mutation is actually going to happen — counting attempts that were about
 * to be refused for some other reason would let a probe exhaust someone's
 * budget on their behalf.
 */
export function chargeMutation(userId, communityId, now = Date.now()) {
  if (now - lastSweep > MUTATION_BUDGET.windowMs) { sweep(now); lastSweep = now; }

  const key = `${userId}:${communityId}`;
  const hits = (buckets.get(key) || []).filter(t => now - t < MUTATION_BUDGET.windowMs);

  if (hits.length >= MUTATION_BUDGET.max) {
    const oldest = hits[0];
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((MUTATION_BUDGET.windowMs - (now - oldest)) / 1000)),
    };
  }

  hits.push(now);
  buckets.set(key, hits);
  return { ok: true };
}

/** Testing seam — never call this from a route. */
export function _resetMutationBudgets() { buckets.clear(); lastSweep = 0; }

/**
 * Is there room for one more of `what` in this Community?
 *
 * Counts live rows only where "live" is meaningful: a Community with 200
 * revoked invites has 200 rows and zero live invites, and refusing the next one
 * would punish an admin for having been diligent.
 */
export function hasRoomFor(db, what, communityId) {
  switch (what) {
    case 'channel': {
      const n = db.db.prepare('SELECT COUNT(*) n FROM channels WHERE community_id = ?').get(communityId).n;
      return { ok: n < CAPS.channelsPerCommunity, limit: CAPS.channelsPerCommunity, current: n };
    }
    case 'role': {
      const n = db.db.prepare('SELECT COUNT(*) n FROM community_roles WHERE community_id = ?').get(communityId).n;
      return { ok: n < CAPS.rolesPerCommunity, limit: CAPS.rolesPerCommunity, current: n };
    }
    case 'member': {
      const n = db.db.prepare(
        "SELECT COUNT(*) n FROM community_memberships WHERE community_id = ? AND state = 'active'"
      ).get(communityId).n;
      return { ok: n < CAPS.membersPerCommunity, limit: CAPS.membersPerCommunity, current: n };
    }
    case 'invite': {
      const n = db.db.prepare(`
        SELECT COUNT(*) n FROM community_invites
        WHERE community_id = ? AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
          AND (max_uses IS NULL OR use_count < max_uses)
      `).get(communityId, new Date().toISOString()).n;
      return { ok: n < CAPS.activeInvitesPerCommunity, limit: CAPS.activeInvitesPerCommunity, current: n };
    }
    case 'remoteInvitation': {
      const n = db.db.prepare(
        "SELECT COUNT(*) n FROM community_remote_invitations WHERE community_id = ? AND state = 'pending'"
      ).get(communityId).n;
      return {
        ok: n < CAPS.pendingRemoteInvitationsPerCommunity,
        limit: CAPS.pendingRemoteInvitationsPerCommunity, current: n,
      };
    }
    default:
      // An unknown resource is refused rather than waved through, so adding a
      // countable thing and forgetting to cap it fails loudly in testing.
      return { ok: false, limit: 0, current: 0, unknown: true };
  }
}

/** How many active Communities this person owns. */
export function ownedCommunityCount(db, userId) {
  const ownerRoles = db.db.prepare(`
    SELECT r.id FROM community_roles r
    JOIN communities c ON c.id = r.community_id
    WHERE r.name = 'owner' AND c.status = 'active'
  `).all().map(r => r.id);
  if (!ownerRoles.length) return 0;

  const placeholders = ownerRoles.map(() => '?').join(',');
  return db.db.prepare(`
    SELECT COUNT(*) n FROM community_membership_roles mr
    JOIN community_memberships m ON m.id = mr.membership_id
    WHERE mr.role_id IN (${placeholders}) AND m.user_id = ? AND m.state = 'active'
  `).get(...ownerRoles, userId).n;
}
