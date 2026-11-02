import React, { useState } from 'react';
import { T } from '../../config/terminology.js';

/**
 * Deciding a wave in review (v2.134.0; from the wave itself since v2.135.1).
 * Used by Manage Community → WAVES TO REVIEW and by the wave's own
 * Who can see this, so the owner or an admin need not leave the wave.
 *
 * - Invite them: the people outside are invited to the community and the wave
 *   waits. Once all of them have joined it is narrowed to its people on its own.
 * - Make it a role: decided now; the people outside lose it unless invited.
 * - Move it out: the wave leaves the community; nobody's access changes.
 *
 * `w` = { id, kind, channelName, outsiders, invited }.
 */
const WaveReviewActions = ({ communityId, w, fetchAPI, showToast, onDone, styles }) => {
  const [confirming, setConfirming] = useState(null); // { action, invite }
  const [busy, setBusy] = useState(false);
  const { action: actionStyle, danger, hint } = styles;
  const outsideNotInvited = Math.max(0, (w.outsiders || 0) - (w.invited || 0));
  const many = (n) => n === 1 ? 'person' : `${n} people`;

  const run = async (action, invite = false) => {
    setBusy(true);
    try {
      const res = await fetchAPI(`/communities/${communityId}/waves/${w.id}/review`, { method: 'POST', body: { action, invite } });
      if (action === 'invite') {
        showToast(res.invited
          ? `${res.invited} invited to join. The ${T.wave} waits until they answer.`
          : `Everyone outside has already been invited.`, 'success');
      } else if (action === 'move_out') {
        showToast(`Moved out of #${w.channelName}. Nobody gained or lost access.`, 'success');
      } else {
        const parts = [res.role ? `Narrowed to the role ${res.role.name}` : `Narrowed to its people in #${w.channelName}`];
        if (res.invited) parts.push(`${res.invited} invited to join`);
        else if (res.outside) parts.push(`${res.outside} outside no longer see it`);
        showToast(parts.join('. '), 'success');
      }
      setConfirming(null);
      onDone && onDone(action, res);
    } catch (err) {
      showToast(err?.data?.error || 'Could not decide that one', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <>
        {w.invited > 0 && (
          <div style={hint}>{w.invited === w.outsiders ? 'All of them have' : `${w.invited} of them ${w.invited === 1 ? 'has' : 'have'}`} been invited to join and not answered yet.</div>
        )}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {w.kind !== 'crossServer' && outsideNotInvited > 0 && (
            <button type="button" style={actionStyle} disabled={busy} onClick={() => run('invite')}
              title={`Invite the ${many(outsideNotInvited)} outside to join the community. Nothing else changes until you decide.`}>
              {busy ? '…' : `INVITE ${outsideNotInvited === 1 ? 'THEM' : `THE ${outsideNotInvited}`} TO JOIN`}
            </button>
          )}
          {w.kind !== 'crossServer' && (
            <button type="button" style={actionStyle} disabled={busy} onClick={() => setConfirming({ action: 'make_role', invite: outsideNotInvited > 0 })}>MAKE IT A ROLE</button>
          )}
          <button type="button" style={actionStyle} disabled={busy} onClick={() => setConfirming({ action: 'move_out', invite: false })}>MOVE IT OUT</button>
        </div>
      </>
    );
  }

  return (
    <div style={{ marginTop: '0.35rem', padding: '0.45rem', border: '1px solid var(--border-subtle)' }}>
      {confirming.action === 'move_out' ? (
        <div style={{ lineHeight: 1.45 }}>Move it out of #{w.channelName}? It becomes an ordinary {T.wave} outside the community, with the same people.</div>
      ) : (
        <>
          <div style={{ lineHeight: 1.45 }}>
            {w.kind === 'crew'
              ? <>Its {T.crew}'s members who can see #{w.channelName} get a new community role, and only that role sees it.</>
              : <>Only its people who can see #{w.channelName} keep it.</>}
            {' '}Community owners and admins always see it.
          </div>
          {outsideNotInvited > 0 && (
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', marginTop: '0.4rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!confirming.invite} onChange={e => setConfirming({ ...confirming, invite: e.target.checked })} />
              <span>Invite the {many(outsideNotInvited)} outside to join the community. Until they accept, they can't see it.</span>
            </label>
          )}
          {outsideNotInvited > 0 && !confirming.invite && <div style={{ ...hint, color: 'var(--accent-orange)' }}>The {many(outsideNotInvited)} outside will lose it.</div>}
          {w.invited > 0 && <div style={hint}>The {many(w.invited)} already invited see it once they accept.</div>}
        </>
      )}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
        <button type="button" style={confirming.action === 'make_role' && outsideNotInvited > 0 && !confirming.invite ? danger : actionStyle} disabled={busy}
          onClick={() => run(confirming.action, !!confirming.invite)}>
          {busy ? '…' : confirming.action === 'move_out' ? 'MOVE OUT' : 'MAKE IT A ROLE'}
        </button>
        <button type="button" style={actionStyle} disabled={busy} onClick={() => setConfirming(null)}>CANCEL</button>
      </div>
    </div>
  );
};

export default WaveReviewActions;
