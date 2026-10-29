import React, { useState, useEffect, useCallback } from 'react';
import CollapsibleSection from '../ui/CollapsibleSection.jsx';
import { T } from '../../config/terminology.js';

// ============ COMMUNITY WAVE REPORT (v2.131.0) ============
// Read-only, for node admins: in each Community, how many waves filed in its
// channels include people who cannot see the channel (docs/wave-access,
// phase 2). Before those Communities switch to "only people who can see the
// channel", each owner decides those waves one by one; this says how big that
// review is. Numbers only: a node admin is not a member of these Communities,
// so no wave titles and no names.

const CommunityWaveReportPanel = ({ fetchAPI, showToast, isMobile, isOpen, onToggle }) => {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchAPI('/admin/communities/wave-report'));
    } catch (err) {
      showToast(err.message || 'Failed to load the report', 'error');
    } finally {
      setLoading(false);
    }
  }, [fetchAPI, showToast]);

  useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

  const affected = (report?.communities || []).filter(c => c.affectedWaves > 0);

  return (
    <CollapsibleSection title={`COMMUNITY ${T.WAVES}`} isOpen={isOpen} onToggle={onToggle} isMobile={isMobile}
      badge={report?.totals?.waves ? String(report.totals.waves) : undefined}>
      {loading && !report ? (
        <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', padding: '8px 0' }}>Counting…</div>
      ) : !report ? null : (
        <>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45, marginBottom: '0.6rem' }}>
            {report.totals.waves === 0
              ? `No community has a ${T.wave} with people who can't see its channel. Nothing to review.`
              : `${report.totals.waves} ${report.totals.waves === 1 ? T.wave : T.waves} in ${report.totals.communities} ${report.totals.communities === 1 ? 'community' : 'communities'} include people who can't see the channel they are filed in: ${report.totals.outsiders} ${report.totals.outsiders === 1 ? 'person' : 'people'} in all. Each community's owner will decide those ${T.waves}; until then nobody loses access.`}
          </div>
          {affected.map(c => (
            <div key={c.id} style={{ padding: '0.4rem 0', borderTop: '1px solid var(--border-subtle)', fontSize: '0.78rem' }}>
              <div style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                {c.name}
                {c.status !== 'active' && <span style={{ color: 'var(--accent-orange)', marginLeft: 6, fontSize: '0.65rem' }}>{c.status.toUpperCase()}</span>}
                <span style={{ color: 'var(--text-dim)', marginLeft: 6, fontSize: '0.65rem' }}>{c.visibility === 'public' ? 'PUBLIC' : 'PRIVATE'}</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                <span style={{ color: 'var(--accent-orange)' }}>{c.affectedWaves} to review</span>
                {c.crewWaves > 0 && ` (${c.crewWaves} ${T.crew})`}
                {` · ${c.outsiders} ${c.outsiders === 1 ? 'person' : 'people'} outside · ${c.channelWaves} non-public in channels`}
              </div>
            </div>
          ))}
          <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.5rem', lineHeight: 1.4 }}>
            {`Public ${T.waves} in a channel already follow the channel, so only non-public ones are counted. Numbers only: titles and names stay with each community's owner.`}
          </div>
          <button onClick={load} disabled={loading} style={{ marginTop: '0.5rem', padding: '4px 10px', background: 'transparent', border: '1px solid var(--border-primary)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.7rem' }}>
            {loading ? 'COUNTING…' : 'REFRESH'}
          </button>
        </>
      )}
    </CollapsibleSection>
  );
};

export default CommunityWaveReportPanel;
