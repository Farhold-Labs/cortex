import React, { useState, useEffect, useCallback } from 'react';
import { T } from '../../config/terminology.js';
import { plainText } from '../../utils/plainText.js';
import { roleTitle } from './roleWords.js';

/**
 * ACTIVITY: the community's audit log in words (v2.140.0).
 *
 * The log has been written since v2.94.0 and readable through
 * GET /api/communities/:id/audit by anyone holding `audit.view` (owners,
 * admins and moderators), with no screen. The server adds names, and leaves
 * out a wave's title or a channel's name the viewer could not see otherwise.
 */

const PAGE = 50;

const nameOf = (x) => plainText(x?.name || '') || null;

function describe(e) {
  const t = e.target || {};
  const d = e.details || {};
  const person = nameOf(t) || 'someone';
  const roleName = t.type === 'role' ? t.name : d.role;
  const role = roleName ? roleTitle({ name: roleName }) : 'a role';
  const theRole = roleName ? `the role ${role}` : 'a role';
  const channel = (name) => (name ? `#${plainText(name)}` : 'a channel');
  const wave = t.type === 'wave'
    ? (t.name ? `"${plainText(t.name)}"` : t.gone ? `a deleted ${T.wave}` : `a ${T.wave} you can't see`)
    : `a ${T.wave}`;
  const where = d.channel ? ` in ${channel(d.channel)}` : '';
  switch (e.action) {
    case 'community.create': return 'made the community';
    case 'community.update': return "changed the community's details";
    case 'community.logo_set': return 'set the logo';
    case 'community.logo_removed': return 'removed the logo';
    case 'community.delete': return 'closed the community';
    case 'community.closed_by_node_admin': return 'closed the community, as server admin';
    case 'community.suspend_by_node_admin': return 'suspended the community, as server admin';
    case 'community.unsuspend_by_node_admin': return 'lifted the suspension, as server admin';
    case 'channel.create': return `made ${channel(t.name)}`;
    case 'channel.update': return `changed ${channel(t.name)}`;
    case 'channel.delete': return 'deleted a channel';
    case 'channel.reorder': return 'rearranged the channels';
    case 'channel.reorder_waves': return `rearranged the ${T.waves} in ${channel(t.name)}`;
    case 'channel.permission_set': return `set what ${role} can do in ${channel(t.name)}`;
    case 'channel.permission_cleared': return `cleared ${role}'s rules in ${channel(t.name)}`;
    case 'invite.create': return 'made an invite code';
    case 'invite.redeem': return 'joined with an invite code';
    case 'invite.revoke': return 'withdrew an invite code';
    case 'member.add': return `added ${person}`;
    case 'member.accept_invitation': return 'accepted an invitation to join';
    case 'member.join_open': return 'joined';
    case 'member.join_remote': return d.homeNode ? `joined from ${plainText(d.homeNode)}` : 'joined from another server';
    case 'member.invite_remote': return `invited ${person}`;
    case 'remote_invite.revoke': return 'withdrew an invitation to someone on another server';
    case 'member.leave': return 'left';
    case 'member.remove': return `removed ${person}`;
    case 'member.ban': return `banned ${person}${d.reason ? `: "${plainText(d.reason)}"` : ''}`;
    case 'member.unban': return `lifted ${person}'s ban`;
    case 'ownership.offer': return `offered to hand the community to ${person}`;
    case 'ownership.accept': return 'took over as owner';
    case 'ownership.decline': return 'turned down the handover';
    case 'ownership.cancel': return 'withdrew the handover offer';
    case 'role.create': return `made ${theRole}`;
    case 'role.update': return `changed ${theRole}`;
    case 'role.delete': return `deleted ${theRole}`;
    case 'role.grant': return `gave ${person} ${role}`;
    case 'role.revoke': return `took ${role} from ${person}`;
    case 'voice.mute': return `muted ${person} in voice${where}`;
    case 'voice.disconnect': return `disconnected ${person} from voice${where}`;
    case 'voice.move': return `moved ${person} to ${channel(d.to)}`;
    case 'voice.speaker': return `asked ${person} to speak${where}`;
    case 'voice.audience': return `moved ${person} to the audience${where}`;
    case 'wave.create_in_channel': return `started ${wave}${where}`;
    case 'wave.file': return `filed ${wave} in a channel`;
    case 'wave.unfile': return `moved ${wave} out of its channel`;
    case 'wave.audience_channel': return `opened ${wave} to its channel`;
    case 'wave.audience_narrow': return `narrowed who can see ${wave}`;
    case 'wave.review_invite': return `invited the people outside ${wave} to join`;
    case 'wave.review_make_role': return `made a role for the people in ${wave}`;
    case 'wave.review_move_out': return `moved ${wave} out after review`;
    case 'wave.review_settled': return `settled the review of ${wave}`;
    case 'ping.remove': return `removed a ${T.ping} in ${wave}`;
    default: return e.action;
  }
}

const when = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), hour: 'numeric', minute: '2-digit',
  });
};

const CommunityActivity = ({ community, active, fetchAPI, styles }) => {
  const { action, hint } = styles;
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchAPI(`/communities/${community.id}/audit`);
      setEntries(res?.entries || []);
    } catch (err) {
      setError(err?.data?.error || err?.message || 'Could not load the activity');
    }
  }, [community.id, fetchAPI]);

  // Only when the section is opened: nobody pays for a log they did not ask to read.
  useEffect(() => { if (active) load(); }, [active, load]);

  if (error) return <div style={hint}>{error} <button style={action} onClick={load}>Try again</button></div>;
  if (!entries) return <div style={hint}>Loading…</div>;
  if (entries.length === 0) return <div style={hint}>Nothing yet.</div>;

  return (
    <div>
      <div style={{ ...hint, marginTop: 0, marginBottom: '0.5rem' }}>
        Who changed what, newest first. Owners, admins and moderators can see this, and anyone whose role includes it.
      </div>
      {entries.slice(0, shown).map(e => (
        <div key={e.id} style={{ padding: '0.3rem 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.78rem', lineHeight: 1.4, overflowWrap: 'anywhere' }}>
          <span style={{ color: 'var(--text-primary)' }}>{nameOf(e.actor) || 'Someone'}</span>{' '}
          <span style={{ color: 'var(--text-secondary)' }}>{describe(e)}</span>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>{when(e.createdAt)}</div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {entries.length > shown && <button style={action} onClick={() => setShown(s => s + PAGE)}>Show more</button>}
        <button style={action} onClick={load}>Refresh</button>
      </div>
      {entries.length >= 200 && shown >= entries.length && (
        <div style={hint}>The 200 most recent are shown.</div>
      )}
    </div>
  );
};

export default CommunityActivity;
