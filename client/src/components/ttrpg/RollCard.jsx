import React, { useEffect, useState } from 'react';
import { getRoll, onRollsChanged, VISIBILITY_LABELS } from '../../utils/rolls.js';
import { isRollFallback } from '../../utils/diceCommand.js';
import { plainText } from '../../utils/plainText.js';

/**
 * A dice roll in a wave (v2.158.0, docs/ttrpg/README.md). The ping says what
 * the roll was for (its label); the roll itself comes from the server, which
 * decides what this reader may see. A hidden result is never sent here, so
 * there is nothing to hide on the device.
 */
const RollCard = ({ waveId, rollId, label, fetchAPI, isMobile }) => {
  const [roll, setRoll] = useState(undefined); // undefined: loading; null: unavailable
  const [version, setVersion] = useState(0);

  useEffect(() => onRollsChanged((changed) => { if (changed === waveId) setVersion(v => v + 1); }), [waveId]);
  useEffect(() => {
    let live = true;
    getRoll(fetchAPI, waveId, rollId).then(r => { if (live) setRoll(r); });
    return () => { live = false; };
  }, [fetchAPI, waveId, rollId, version]);

  const text = label && !isRollFallback(label) ? plainText(label) : null;
  const frame = {
    display: 'inline-flex', flexDirection: 'column', gap: '6px', minWidth: isMobile ? '0' : '220px', maxWidth: '100%',
    padding: '10px 12px', border: '1px solid var(--border-secondary)', borderLeft: '3px solid var(--accent-purple, #a78bfa)',
    background: 'var(--bg-elevated)', fontFamily: 'monospace',
  };
  const muted = { color: 'var(--text-dim)', fontSize: '0.75rem' };

  if (roll === undefined) return <div style={frame}><span style={muted}>🎲 Rolling…</span></div>;
  if (roll === null) return <div style={frame}><span style={muted}>🎲 This roll isn't available</span></div>;

  if (roll.hidden) {
    return (
      <div style={frame} aria-label="Hidden dice roll">
        {text && <div style={{ color: 'var(--text-primary)' }}>{text}</div>}
        <div style={muted}>
          {roll.visibility === 'gm_secret' ? '🎲 The GM rolled in secret' : `🎲 Rolled ${roll.expression || ''} for the GM`}
        </div>
      </div>
    );
  }

  const crit = roll.crit === 'success' ? { word: 'CRITICAL', color: 'var(--accent-green)' }
    : roll.crit === 'failure' ? { word: 'FUMBLE', color: 'var(--accent-orange)' } : null;
  const die = (d, sides, i) => (
    <span
      key={i}
      title={d.rerolled?.length ? `Rerolled ${d.rerolled.join(', ')}` : undefined}
      style={{
        display: 'inline-block', minWidth: '1.8em', padding: '2px 4px', textAlign: 'center',
        border: '1px solid var(--border-primary)', color: d.kept ? 'var(--text-primary)' : 'var(--text-dim)',
        textDecoration: d.kept ? 'none' : 'line-through', opacity: d.kept ? 1 : 0.6,
        ...(sides === 20 && d.kept && d.value === 20 ? { borderColor: 'var(--accent-green)', color: 'var(--accent-green)' } : {}),
        ...(sides === 20 && d.kept && d.value === 1 ? { borderColor: 'var(--accent-orange)', color: 'var(--accent-orange)' } : {}),
      }}
    >
      {d.value}{d.rerolled?.length ? '*' : ''}
    </span>
  );

  return (
    <div style={frame} aria-label={`Dice roll ${roll.expression}: ${roll.total}`}>
      {text && <div style={{ color: 'var(--text-primary)', fontFamily: 'var(--app-font)' }}>{text}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '1.6rem', fontWeight: 700, color: crit ? crit.color : 'var(--accent-amber)', lineHeight: 1 }}>{roll.total}</span>
        <span style={{ ...muted, fontSize: '0.8rem' }}>🎲 {roll.expression}</span>
        {crit && <span style={{ color: crit.color, fontSize: '0.7rem', border: `1px solid ${crit.color}`, padding: '1px 6px' }}>{crit.word}</span>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', fontSize: '0.8rem' }}>
        {roll.terms.map((t, i) => (
          <React.Fragment key={i}>
            {(i > 0 || t.sign < 0) && <span style={muted}>{t.sign < 0 ? '−' : '+'}</span>}
            {t.type === 'mod' ? <span style={{ color: 'var(--text-secondary)' }}>{t.value}</span> : t.dice.map((d, j) => die(d, t.sides, `${i}-${j}`))}
          </React.Fragment>
        ))}
      </div>
      {roll.visibility !== 'public' && <div style={muted}>Seen by: {VISIBILITY_LABELS[roll.visibility]}</div>}
    </div>
  );
};

export default RollCard;
