import React, { useEffect, useMemo, useState } from 'react';
import { GlowText } from '../ui/SimpleComponents.jsx';
import { VISIBILITY_LABELS, SYSTEM_LABELS, rememberRoll } from '../../utils/rolls.js';
import { plainText } from '../../utils/plainText.js';

/**
 * Tabletop role-playing windows (v2.158.0, docs/ttrpg/README.md):
 *  - DiceTray: build a roll by tapping dice, then roll it into the wave.
 *  - TableSettingsModal: turn a wave into a table; the system, the GMs and who
 *    sees rolls by default.
 *  - RollLogModal: every roll at the table, newest first; hidden results stay
 *    hidden (the server decides).
 */

const Overlay = ({ onClose, isMobile, title, children, width = 420 }) => (
  <div
    role="dialog" aria-label={title}
    onClick={onClose}
    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 2000, display: 'flex',
      alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? 0 : '24px' }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ width: isMobile ? '100%' : `${width}px`, maxWidth: '100%', maxHeight: isMobile ? '88vh' : '85vh', overflowY: 'auto',
        background: 'var(--bg-surface)', border: '1px solid var(--accent-purple)', padding: isMobile ? '16px 16px calc(16px + env(safe-area-inset-bottom))' : '20px',
        fontFamily: 'monospace', boxSizing: 'border-box' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <GlowText color="var(--accent-purple)" size="1rem">{title}</GlowText>
        <button onClick={onClose} aria-label="Close" style={btn()}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

function btn(active = false, color = 'var(--accent-purple)') {
  return {
    padding: '8px 12px', minHeight: '40px', background: active ? color : 'transparent', color: active ? 'var(--bg-base)' : 'var(--text-primary)',
    border: `1px solid ${active ? color : 'var(--border-primary)'}`, cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.8rem',
  };
}
const label = { display: 'block', color: 'var(--text-dim)', fontSize: '0.7rem', margin: '12px 0 6px', letterSpacing: '0.05em' };
const input = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: 'var(--bg-base)', color: 'var(--text-primary)',
  border: '1px solid var(--border-primary)', fontFamily: 'monospace', fontSize: '0.9rem' };

const DICE = [4, 6, 8, 10, 12, 20, 100];

export function buildExpression(counts, modifier, mode) {
  const parts = [];
  for (const sides of DICE) {
    const n = counts[sides] || 0;
    if (!n) continue;
    if (sides === 20 && mode && n === 1) parts.push(mode);
    else parts.push(`${n}d${sides}`);
  }
  let expr = parts.join('+');
  if (modifier) expr += (modifier > 0 ? '+' : '') + modifier;
  return expr;
}

export const DiceTray = ({ table, isMobile, onRoll, onClose }) => {
  const [counts, setCounts] = useState({});
  const [modifier, setModifier] = useState(0);
  const [mode, setMode] = useState(null); // 'adv' | 'dis' | null — for a single d20
  const [visibility, setVisibility] = useState(table.defaultVisibility);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const expression = buildExpression(counts, modifier, counts[20] === 1 ? mode : null);
  const choices = table.isGm ? ['public', 'gm', 'gm_secret'] : ['public', 'gm'];

  const roll = async () => {
    if (!expression || busy) return;
    setBusy(true);
    try {
      await onRoll({ expression, label: text.trim(), visibility });
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <Overlay onClose={onClose} isMobile={isMobile} title="ROLL DICE">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
        {DICE.map(sides => (
          <button key={sides} style={{ ...btn(!!counts[sides]), position: 'relative', fontSize: '0.9rem' }}
            onClick={() => setCounts(c => ({ ...c, [sides]: Math.min((c[sides] || 0) + 1, 50) }))}
            onContextMenu={(e) => { e.preventDefault(); setCounts(c => ({ ...c, [sides]: Math.max((c[sides] || 0) - 1, 0) })); }}
            aria-label={`Add a d${sides}`}>
            {counts[sides] ? `${counts[sides]}×` : ''}d{sides === 100 ? '%' : sides}
          </button>
        ))}
        <button style={btn()} onClick={() => { setCounts({}); setModifier(0); setMode(null); }} aria-label="Clear the dice">CLEAR</button>
      </div>

      <span style={label}>MODIFIER</span>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button style={btn()} onClick={() => setModifier(m => m - 1)} aria-label="Lower the modifier">−</button>
        <span style={{ minWidth: '3em', textAlign: 'center', color: 'var(--text-primary)', fontSize: '1rem' }}>{modifier > 0 ? `+${modifier}` : modifier}</span>
        <button style={btn()} onClick={() => setModifier(m => m + 1)} aria-label="Raise the modifier">+</button>
        {counts[20] === 1 && (
          <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
            <button style={btn(mode === 'adv', 'var(--accent-green)')} onClick={() => setMode(m => m === 'adv' ? null : 'adv')}>ADV</button>
            <button style={btn(mode === 'dis', 'var(--accent-orange)')} onClick={() => setMode(m => m === 'dis' ? null : 'dis')}>DIS</button>
          </div>
        )}
      </div>

      <span style={label}>WHAT FOR (OPTIONAL)</span>
      <input style={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Stealth check"
        onKeyDown={(e) => { if (e.key === 'Enter') roll(); }} />

      <span style={label}>WHO SEES THE RESULT</span>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {choices.map(v => <button key={v} style={btn(visibility === v)} onClick={() => setVisibility(v)}>{VISIBILITY_LABELS[v]}</button>)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '16px' }}>
        <span style={{ flex: 1, color: expression ? 'var(--accent-amber)' : 'var(--text-dim)', fontSize: '1rem', wordBreak: 'break-all' }}>
          {expression || 'Tap dice to add them'}
        </span>
        <button onClick={roll} disabled={!expression || busy} style={{ ...btn(true), opacity: !expression || busy ? 0.5 : 1, minWidth: '90px' }}>🎲 ROLL</button>
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '10px' }}>
        Or type it: /roll 1d20+5 Stealth · /gmroll · /publicroll{table.isGm ? ' · /secretroll' : ''}
      </div>
    </Overlay>
  );
};

export const TableSettingsModal = ({ waveId, table, participants, currentUserId, fetchAPI, showToast, isMobile, onClose, onSaved }) => {
  const [system, setSystem] = useState(table?.system || 'dnd5e-2024');
  const [defaultVisibility, setDefaultVisibility] = useState(table?.defaultVisibility || 'gm');
  const [gms, setGms] = useState(() => new Set(table?.gms?.length ? table.gms : [currentUserId]));
  const [busy, setBusy] = useState(false);
  const people = useMemo(() => [...participants].sort((a, b) => (a.name || a.handle || '').localeCompare(b.name || b.handle || '')), [participants]);

  const save = async () => {
    setBusy(true);
    try {
      await fetchAPI(`/waves/${encodeURIComponent(waveId)}/table`, { method: 'PUT', body: { system, defaultVisibility, gms: [...gms] } });
      showToast(table ? 'Table updated' : 'This wave is now a table. Roll with /roll or the 🎲 in the ⋮ menu', 'success');
      onSaved?.(); onClose();
    } catch (err) { showToast(err.message || 'Could not save the table', 'error'); }
    finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      await fetchAPI(`/waves/${encodeURIComponent(waveId)}/table`, { method: 'DELETE' });
      showToast('The table is off. Its rolls are kept.', 'success');
      onSaved?.(); onClose();
    } catch (err) { showToast(err.message || 'Could not turn the table off', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <Overlay onClose={onClose} isMobile={isMobile} title={table ? 'TABLE SETTINGS' : 'MAKE THIS A TABLE'}>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.5 }}>
        A table is a wave for a tabletop game. The server rolls the dice, so nobody can fake a roll.
        In an encrypted wave, the server sees the dice and results, never what a roll was for.
      </div>

      <span style={label}>GAME</span>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {Object.entries(SYSTEM_LABELS).map(([k, v]) => <button key={k} style={btn(system === k)} onClick={() => setSystem(k)}>{v}</button>)}
      </div>

      <span style={label}>WHO SEES A ROLL BY DEFAULT</span>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {['gm', 'public'].map(v => <button key={v} style={btn(defaultVisibility === v)} onClick={() => setDefaultVisibility(v)}>{VISIBILITY_LABELS[v]}</button>)}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', marginTop: '6px' }}>Anyone can still choose for a single roll.</div>

      <span style={label}>GMS</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '220px', overflowY: 'auto' }}>
        {people.map(p => (
          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 4px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={gms.has(p.id)}
              onChange={(e) => setGms(prev => { const next = new Set(prev); if (e.target.checked) next.add(p.id); else next.delete(p.id); return next; })} />
            {plainText(p.name || p.handle)} <span style={{ color: 'var(--text-dim)' }}>@{p.handle}</span>
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '18px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {table && <button onClick={turnOff} disabled={busy} style={{ ...btn(), color: 'var(--accent-orange)', borderColor: 'var(--accent-orange)', marginRight: 'auto' }}>TURN OFF</button>}
        <button onClick={onClose} style={btn()}>CANCEL</button>
        <button onClick={save} disabled={busy || gms.size === 0} style={{ ...btn(true), opacity: busy || gms.size === 0 ? 0.5 : 1 }}>{table ? 'SAVE' : 'MAKE A TABLE'}</button>
      </div>
    </Overlay>
  );
};

export const RollLogModal = ({ waveId, participants, fetchAPI, isMobile, onClose }) => {
  const [rolls, setRolls] = useState(null);
  const [roller, setRoller] = useState('');
  const [more, setMore] = useState(false);
  const names = useMemo(() => Object.fromEntries(participants.map(p => [p.id, plainText(p.name || p.handle)])), [participants]);

  const load = async (before = null) => {
    const q = new URLSearchParams({ limit: '50' });
    if (roller) q.set('roller', roller);
    if (before) q.set('before', before);
    const data = await fetchAPI(`/waves/${encodeURIComponent(waveId)}/rolls?${q}`);
    for (const r of data.rolls || []) rememberRoll(r);
    setMore((data.rolls || []).length === 50);
    return data.rolls || [];
  };
  useEffect(() => { let live = true; setRolls(null); load().then(r => { if (live) setRolls(r); }).catch(() => { if (live) setRolls([]); }); return () => { live = false; }; }, [roller]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Overlay onClose={onClose} isMobile={isMobile} title="ROLL LOG" width={520}>
      <select value={roller} onChange={(e) => setRoller(e.target.value)} style={{ ...input, marginBottom: '10px' }} aria-label="Whose rolls">
        <option value="">Everyone</option>
        {participants.map(p => <option key={p.id} value={p.id}>{plainText(p.name || p.handle)}</option>)}
      </select>
      {rolls === null ? <div style={{ color: 'var(--text-dim)' }}>Loading…</div>
        : rolls.length === 0 ? <div style={{ color: 'var(--text-dim)' }}>No rolls yet.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rolls.map(r => (
              <div key={r.id} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', padding: '8px 2px', borderBottom: '1px solid var(--border-subtle)', fontSize: '0.8rem' }}>
                <span style={{ color: 'var(--text-dim)', minWidth: isMobile ? '64px' : '120px' }}>
                  {new Date(r.createdAt).toLocaleString([], isMobile ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ color: 'var(--accent-teal)', minWidth: '70px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names[r.rollerId] || 'Someone'}</span>
                <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{r.expression || '—'}</span>
                {r.hidden
                  ? <span style={{ color: 'var(--text-dim)' }}>hidden</span>
                  : <span style={{ color: r.crit === 'success' ? 'var(--accent-green)' : r.crit === 'failure' ? 'var(--accent-orange)' : 'var(--accent-amber)', fontWeight: 700 }}>{r.total}</span>}
                {r.visibility !== 'public' && <span title={VISIBILITY_LABELS[r.visibility]} style={{ color: 'var(--text-dim)' }}>{r.visibility === 'gm_secret' ? '🔒' : '👁'}</span>}
                {!r.pingId && <span title="Rolled but not posted" style={{ color: 'var(--text-dim)' }}>·</span>}
              </div>
            ))}
            {more && (
              <button style={{ ...btn(), marginTop: '10px' }} onClick={async () => { const older = await load(rolls[rolls.length - 1].createdAt); setRolls(prev => [...prev, ...older]); }}>OLDER</button>
            )}
          </div>
        )}
    </Overlay>
  );
};
