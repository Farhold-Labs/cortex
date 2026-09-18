/**
 * Community capabilities and built-in roles (v2.94.0, Communities Phase 1)
 *
 * The vocabulary of "what may be done inside a Community", and the four roles a
 * new Community is seeded with. Deliberately data only — this module decides
 * nothing. The evaluator that answers "may THIS actor do THIS here" is
 * `authorize.js`, which is Phase 2, and per the implementation plan §3 there
 * must be exactly one of it: no controller may compute permissions inline.
 * Cortex has lost real time to duplicated permission logic before (the wave row
 * menu existing twice in v2.84.1, notification defaults in three places in
 * v2.66.0).
 *
 * CAPABILITIES, NOT A LADDER
 * The instance-wide ROLES ladder (admin > moderator > user) and the per-wave
 * ladder (owner > admin > moderator) both work by rank, which is fine when the
 * powers are nested. Community powers are not: a Community may perfectly well
 * want someone who can manage events but not members, or moderate messages but
 * not touch channels. So a role holds a SET of capabilities, and `priority`
 * exists only to answer "may this member act on that member" — never to imply
 * that a higher role holds a lower role's powers.
 *
 * THREE LAYERS, ONE RULE
 * A capability held here is necessary but not sufficient. Per §2b of the plan:
 *
 *     Channel visibility gates DISCOVERY. Wave privacy gates CONTENT.
 *
 * `COMMUNITY_VIEW_CHANNEL` decides whether a channel is listed. Whether a
 * member may open a given wave inside it is still the wave's own decision, made
 * by the existing wave authorization — a private wave in a visible channel stays
 * private. Nothing in this file may be used to overrule a wave's participants,
 * and that is the property which makes moving a wave into a Community safe.
 */

/**
 * Capability strings. Stored in `community_roles.permissions` as a JSON array,
 * so these values are persisted data: rename one and every existing role in
 * every database is silently stripped of that power. Add, do not rename.
 */
export const CAPABILITIES = {
  // Community itself
  MANAGE_COMMUNITY:  'community.manage',        // name, description, visibility
  DELETE_COMMUNITY:  'community.delete',
  TRANSFER_OWNER:    'community.transfer',
  REQUEST_MIGRATION: 'community.migrate',       // ask another node to import this

  // Membership
  INVITE_MEMBER:     'member.invite',
  REMOVE_MEMBER:     'member.remove',
  BAN_MEMBER:        'member.ban',
  MANAGE_ROLES:      'member.roles',            // grant and revoke roles
  VIEW_MEMBERS:      'member.view',

  // Channels — containers, not conversations
  MANAGE_CHANNELS:   'channel.manage',          // create, rename, reorder, delete
  VIEW_CHANNEL:      'channel.view',            // see it listed at all
  CREATE_WAVE:       'channel.create_wave',     // start a wave inside a channel
  MOVE_WAVE:         'channel.move_wave',       // attach or detach a wave

  // Moderation of content already covered by wave rules; these are the
  // Community-wide equivalents, applied across every channel at once.
  MODERATE_CONTENT:  'content.moderate',
  MANAGE_EVENTS:     'event.manage',

  // Audit
  VIEW_AUDIT_LOG:    'audit.view',
};

export const CAPABILITY_VALUES = Object.freeze(Object.values(CAPABILITIES));

/** Every capability — what OWNER holds, and the only legitimate use of "all". */
const ALL = CAPABILITY_VALUES;

const C = CAPABILITIES;

/**
 * Seeded with every new Community. `managed: true` means built-in: the role
 * cannot be deleted, and OWNER's capability set cannot be edited, because a
 * Community whose owner has revoked their own ability to manage it has no way
 * back that does not involve a node admin.
 *
 * `priority` answers only "may A act on B" — B is actionable by A when A's
 * highest priority is strictly greater than B's. Equal priority means neither
 * can act on the other, which is what stops two admins removing each other.
 */
export const BUILT_IN_ROLES = Object.freeze([
  {
    name: 'owner',
    priority: 400,
    managed: true,
    permissions: ALL,
  },
  {
    name: 'admin',
    priority: 300,
    managed: true,
    // Everything except ending or handing over the Community. An admin runs it;
    // only the owner disposes of it.
    permissions: [
      C.MANAGE_COMMUNITY, C.REQUEST_MIGRATION,
      C.INVITE_MEMBER, C.REMOVE_MEMBER, C.BAN_MEMBER, C.MANAGE_ROLES, C.VIEW_MEMBERS,
      C.MANAGE_CHANNELS, C.VIEW_CHANNEL, C.CREATE_WAVE, C.MOVE_WAVE,
      C.MODERATE_CONTENT, C.MANAGE_EVENTS,
      C.VIEW_AUDIT_LOG,
    ],
  },
  {
    name: 'moderator',
    priority: 200,
    managed: true,
    // Polices what is there. Cannot restructure the Community or change who
    // belongs to it beyond removing and banning.
    permissions: [
      C.REMOVE_MEMBER, C.BAN_MEMBER, C.VIEW_MEMBERS,
      C.VIEW_CHANNEL, C.CREATE_WAVE, C.MOVE_WAVE,
      C.MODERATE_CONTENT, C.MANAGE_EVENTS,
      C.VIEW_AUDIT_LOG,
    ],
  },
  {
    name: 'member',
    priority: 100,
    managed: true,
    // The default. Note it can start a wave in a channel: a Community where
    // only staff may begin a conversation is a noticeboard, and Cortex already
    // has announcement waves for that.
    permissions: [C.VIEW_MEMBERS, C.VIEW_CHANNEL, C.CREATE_WAVE],
  },
]);

export const BUILT_IN_ROLE_NAMES = Object.freeze(BUILT_IN_ROLES.map(r => r.name));

/** Guards against a typo becoming a silently powerless role. */
export function isCapability(value) {
  return CAPABILITY_VALUES.includes(value);
}

/**
 * Parse a stored `permissions` blob.
 *
 * Returns an array whatever it is handed. A role row with corrupt JSON must
 * read as "holds nothing" rather than throwing inside an authorization check —
 * an exception there is an outage, while an empty set merely denies, which is
 * the direction a permission system is supposed to fail in.
 */
export function parsePermissions(raw) {
  if (Array.isArray(raw)) return raw.filter(isCapability);
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCapability) : [];
  } catch {
    return [];
  }
}

/** Union of several roles' capabilities — a member may hold more than one. */
export function unionCapabilities(roles) {
  const out = new Set();
  for (const role of roles || []) {
    for (const cap of parsePermissions(role && role.permissions)) out.add(cap);
  }
  return out;
}
