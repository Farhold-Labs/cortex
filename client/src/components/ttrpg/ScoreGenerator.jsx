import React, { useState } from 'react';
import { ABILITIES, mod, signed } from '../../ttrpg/dnd5e2024.js';
import { btn, inputStyle, box, labelStyle } from './sheetUi.jsx';

/**
 * Setting a character's ability scores (v2.165.0): roll them (4d6, drop the
 * lowest, six times, rolled by the server in one roll and posted to the wave,
 * so the GM sees the dice), the standard array, or point buy; then put each
 * number where you want it.
 */

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUDGET = 27;
export const ROLL_EXPRESSION = Array(6).fill('4d6dl1').join('+');

/** The six scores in a 4d6-drop-lowest roll, from its terms. */
export function scoresFromRoll(roll) {
  return (roll?.terms || []).filter(t => t.type === 'dice').map(t => t.subtotal);
}

export function pointBuyCost(scores) {
  return Object.values(scores).reduce((n, v) => n + (POINT_COST[v] ?? 99), 0);
}

export default function ScoreGenerator({ data, roll, change, onClose }) {
  const [method, setMethod] = useState('roll');
  const [pool, setPool] = useState(null);      // the numbers to place
  const [assigned, setAssigned] = useState({}); // ability -> index into pool
  const [buy, setBuy] = useState({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 });
  const [busy, setBusy] = useState(false);
  const name = data.name || 'Unnamed';

  const doRoll = async () => {
    setBusy(true);
    try {
      const r = await roll(ROLL_EXPRESSION, `${name}: ability scores (4d6, drop the lowest)`);
      const scores = scoresFromRoll(r);
      if (scores.length === 6) { setPool(scores); setAssigned({}); }
    } finally { setBusy(false); }
  };
  const used = new Set(Object.values(assigned));
  const ready = method === 'buy' ? pointBuyCost(buy) <= POINT_BUDGET : pool && ABILITIES.every(a => assigned[a.key] != null);
  const result = method === 'buy' ? buy : pool ? Object.fromEntries(ABILITIES.map(a => [a.key, pool[assigned[a.key]]])) : null;
  const apply = () => {
    if (!ready || !result) return;
    change((s) => { s.abilities = { ...s.abilities, ...result }; }, { now: true });
    onClose();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button type="button" onClick={onClose} style={btn()} aria-label="Back">◀</button>
        <span style={{ color: 'var(--accent-purple)' }}>Ability scores</span>
      </div>
      <div role="tablist" style={{ display: 'flex', gap: '4px' }}>
        {[['roll', 'Roll 4d6'], ['array', 'Standard array'], ['buy', 'Point buy']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={method === k} type="button" onClick={() => {
            setMethod(k); setAssigned({});
            setPool(k === 'array' ? [...STANDARD_ARRAY] : null);
          }} style={{ ...btn(method === k), flex: 1 }}>{l}</button>
        ))}
      </div>

      {method === 'roll' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>The server rolls 4d6 six times and drops the lowest die of each. The roll goes into the wave like any other, so the GM can see it.</div>
          <button type="button" disabled={busy || !!pool} onClick={doRoll} style={{ ...btn(true), alignSelf: 'flex-start' }}>{busy ? 'Rolling…' : pool ? 'Rolled' : 'Roll the scores'}</button>
        </div>
      )}

      {method !== 'buy' && pool && (
        <>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }} aria-label="Scores to place">
            {pool.map((v, i) => (
              <span key={i} style={{ ...box, padding: '4px 10px', fontSize: '1rem', opacity: used.has(i) ? 0.35 : 1, color: 'var(--accent-amber)' }}>{v}</span>
            ))}
            <span style={{ color: 'var(--text-dim)', alignSelf: 'center' }}>total {pool.reduce((a, b) => a + b, 0)}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px' }}>
            {ABILITIES.map(a => (
              <label key={a.key} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ width: '3em' }}>{a.short}</span>
                <select aria-label={a.name} value={assigned[a.key] ?? ''} onChange={(e) => setAssigned(x => ({ ...x, [a.key]: e.target.value === '' ? undefined : Number(e.target.value) }))} style={{ ...inputStyle, width: 'auto' }}>
                  <option value="">–</option>
                  {pool.map((v, i) => <option key={i} value={i} disabled={used.has(i) && assigned[a.key] !== i}>{v}</option>)}
                </select>
                {assigned[a.key] != null && <span style={{ color: 'var(--text-dim)' }}>{signed(mod(pool[assigned[a.key]]))}</span>}
              </label>
            ))}
          </div>
        </>
      )}

      {method === 'buy' && (
        <>
          <div style={{ color: pointBuyCost(buy) > POINT_BUDGET ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>
            {POINT_BUDGET - pointBuyCost(buy)} of {POINT_BUDGET} points left · scores 8 to 15
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' }}>
            {ABILITIES.map(a => (
              <div key={a.key} style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ width: '3em' }}>{a.short}</span>
                <button type="button" aria-label={`${a.name} down`} disabled={buy[a.key] <= 8} onClick={() => setBuy(b => ({ ...b, [a.key]: b[a.key] - 1 }))} style={{ ...btn(), minHeight: '28px', padding: '2px 8px' }}>−</button>
                <span style={{ width: '2em', textAlign: 'center' }}>{buy[a.key]}</span>
                <button type="button" aria-label={`${a.name} up`} disabled={buy[a.key] >= 15 || pointBuyCost({ ...buy, [a.key]: buy[a.key] + 1 }) > POINT_BUDGET} onClick={() => setBuy(b => ({ ...b, [a.key]: b[a.key] + 1 }))} style={{ ...btn(), minHeight: '28px', padding: '2px 8px' }}>+</button>
                <span style={{ color: 'var(--text-dim)' }}>{signed(mod(buy[a.key]))}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
        <button type="button" disabled={!ready} onClick={apply} style={btn(true)}>Use these scores</button>
        <button type="button" onClick={onClose} style={btn()}>Cancel</button>
      </div>
      <div style={{ ...labelStyle, textTransform: 'none', letterSpacing: 0 }}>
        This replaces the six scores. Species or background increases go on top afterwards (Fill from the SRD can add 2014 racial ones).
      </div>
    </div>
  );
}
