import React, { useState, useEffect, useCallback } from 'react';
import { plainText } from '../../utils/plainText.js';

/**
 * Offers to take over a Community, waiting for an answer (v2.108.0,
 * CORTEX-COMM-021).
 *
 * Ownership is never pushed onto anyone — an owner offers, and the recipient
 * decides here. A floating card rather than a section of the wave list: it is
 * rare, it needs an answer, and it must not cost the list its layout.
 * "Later" only hides it for this session; the offer itself stands until it is
 * answered, withdrawn, or lapses after seven days.
 */
const OwnershipOffers = ({ fetchAPI, showToast, onChanged, isMobile }) => {
  const [offers, setOffers] = useState([]);
  const [hidden, setHidden] = useState(() => new Set());
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchAPI('/communities/ownership-offers');
      setOffers(res.offers || []);
    } catch { /* nothing to show */ }
  }, [fetchAPI]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [load]);

  const answer = async (offer, verb) => {
    setBusy(offer.id);
    try {
      await fetchAPI(`/communities/${offer.communityId}/transfer/${offer.id}/${verb}`, { method: 'POST' });
      showToast(verb === 'accept'
        ? `You now own ${plainText(offer.communityName)}`
        : `Declined — ${plainText(offer.communityName)} stays with its owner`, 'success');
      setOffers(prev => prev.filter(o => o.id !== offer.id));
      onChanged?.();
    } catch (err) {
      showToast(err.message || 'That offer is no longer open', 'error');
      load();
    } finally {
      setBusy(null);
    }
  };

  const visible = offers.filter(o => !hidden.has(o.id));
  if (!visible.length) return null;
  const offer = visible[0];

  const button = (primary) => ({
    padding: '6px 12px', fontFamily: 'monospace', fontSize: '0.75rem', cursor: 'pointer',
    background: primary ? 'var(--accent-amber)' : 'transparent',
    color: primary ? 'var(--bg-base)' : 'var(--text-secondary)',
    border: `1px solid ${primary ? 'var(--accent-amber)' : 'var(--border-primary)'}`,
  });

  return (
    <div role="dialog" aria-label="Community ownership offer" style={{
      position: 'fixed', right: 16, left: isMobile ? 16 : 'auto', bottom: isMobile ? 76 : 16,
      maxWidth: 380, zIndex: 9000, padding: 14,
      background: 'var(--bg-elevated)', border: '1px solid var(--accent-amber)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)', fontFamily: 'monospace',
    }}>
      <div style={{ color: 'var(--accent-amber)', fontSize: '0.7rem', letterSpacing: '0.08em', marginBottom: 6 }}>
        OWNERSHIP OFFER{visible.length > 1 ? ` · 1 OF ${visible.length}` : ''}
      </div>
      <div style={{ color: 'var(--text-primary)', fontSize: '0.85rem', lineHeight: 1.4 }}>
        {plainText(offer.from.displayName)} wants to hand <strong>{plainText(offer.communityName)}</strong> over to you.
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', marginTop: 6, lineHeight: 1.4 }}>
        You would become its owner, with responsibility for its members and channels. They would stay on as an admin.
        Lapses {new Date(offer.expiresAt).toLocaleDateString()}.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button disabled={busy === offer.id} onClick={() => answer(offer, 'accept')} style={button(true)}>ACCEPT</button>
        <button disabled={busy === offer.id} onClick={() => answer(offer, 'decline')} style={button(false)}>DECLINE</button>
        <button onClick={() => setHidden(prev => new Set(prev).add(offer.id))} style={{ ...button(false), border: 'none', marginLeft: 'auto' }}>
          LATER
        </button>
      </div>
    </div>
  );
};

export default OwnershipOffers;
