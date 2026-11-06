import { T } from '../../config/terminology.js';
import { plainText } from '../../utils/plainText.js';

/**
 * Community roles in words (v2.139.0).
 *
 * The capability strings are stored data (server/lib/communities/capabilities.js)
 * and mean nothing to the person choosing them, so the roles editor offers each
 * one as what it lets someone do.
 *
 * Only capabilities that do something are offered. `content.moderate`,
 * `event.manage` and `audit.view` do since v2.140.0; `community.migrate` has no
 * flow. Closing and handing over a Community stay the owner's
 * (`community.delete`, `community.transfer`). A role that already holds any of
 * these keeps them: the editor sends them back unchanged.
 */
export const CAPABILITY_GROUPS = [
  {
    title: 'COMMUNITY',
    caps: [
      ['community.manage', () => `Edit the community's details, and see and narrow every ${T.wave} in its channels`],
      ['audit.view', () => "See the community's activity: who changed what, and when"],
    ],
  },
  {
    title: 'PEOPLE',
    caps: [
      ['member.view', () => 'See who is in the community'],
      ['member.invite', () => 'Add people and make invite codes'],
      ['member.remove', () => 'Remove people ranked below them'],
      ['member.ban', () => 'Ban people ranked below them'],
      ['member.roles', () => 'Give and take away roles ranked below their own'],
    ],
  },
  {
    title: 'CHANNELS',
    caps: [
      ['channel.view', () => 'See channels'],
      ['channel.create_wave', () => `Start ${T.waves} in channels`],
      ['channel.move_wave', () => `Move their own ${T.waves} between channels, and out of them`],
      ['channel.manage', () => 'Create, rename, arrange and delete channels, and choose who sees them'],
      ['content.moderate', () => `Remove ${T.pings} in channel ${T.waves} they can read, by people ranked below them`],
      ['event.manage', () => `Run the events in channel ${T.waves} they can read: edit, cancel, invite and take the register`],
    ],
  },
  {
    title: 'VOICE',
    voice: true,
    caps: [
      ['voice.connect', () => 'Join voice channels and listen'],
      ['voice.speak', () => 'Speak'],
      ['voice.video', () => 'Turn on a camera'],
      ['voice.screen', () => 'Share a screen'],
      ['voice.moderate', () => 'Mute, disconnect and move people in voice, and run stages'],
    ],
  },
];

export const OFFERED_CAPABILITIES = CAPABILITY_GROUPS.flatMap(g => g.caps.map(([cap]) => cap));

const BUILT_IN_TITLES = { owner: 'Owner', admin: 'Admin', moderator: 'Moderator', member: 'Member' };

/** A role's name as people read it: built-ins capitalised, custom ones as typed. */
// Names are unique per Community whatever their case, so "admin" is always the built-in.
export const roleTitle = (role) => BUILT_IN_TITLES[role?.name] || plainText(role?.name || '');

/** A stored permissions value (a JSON string from the server, or an array) as an array. */
export const rolePermissions = (role) => {
  const raw = role?.permissions;
  if (Array.isArray(raw)) return raw;
  try { const parsed = JSON.parse(raw || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

/**
 * Where a role sits. Rank only decides who its holders can act on: removing,
 * banning and taking roles away reach people ranked strictly below. The
 * built-ins sit at member 100, moderator 200, admin 300, owner 400.
 */
export const RANKS = [
  { priority: 100, title: 'With members', desc: 'Its people can act on nobody: removing and banning need a higher rank.' },
  { priority: 150, title: 'Above members', desc: 'Its people can act on members, not on moderators.' },
  { priority: 250, title: 'Above moderators', desc: 'Its people can act on members and moderators, not on admins.' },
];

export const rankTitle = (priority) => {
  const p = Number(priority);
  const exact = RANKS.find(r => r.priority === p);
  if (exact) return exact.title;
  if (p <= 100) return 'With members';
  if (p < 200) return 'Above members';
  if (p < 300) return 'Above moderators';
  return 'Above admins';
};
