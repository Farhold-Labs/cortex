import React, { useEffect, useMemo, useState } from 'react';
import { loadSrd, editionOf, SRD_KINDS } from '../../srd/index.js';
import { btn, labelStyle, inputStyle, box } from './sheetUi.jsx';
import { Frame } from './SheetsPanel.jsx';
import { StatBlock } from './MonsterViews.jsx';

/**
 * The rules reference (v2.161.0, docs/ttrpg/README.md phase 6): spells,
 * monsters, equipment, magic items and conditions from the SRD, searchable,
 * for either edition. The same list is the picker in sheets and the GM screen.
 */

const LEVEL = (n) => (n === 0 ? 'Cantrip' : `Level ${n}`);
const crValue = (cr) => (String(cr).includes('/') ? Number(cr.split('/')[0]) / Number(cr.split('/')[1]) : Number(cr));
const PAGE = 60;

function summary(kind, x) {
  if (kind === 'spells') return `${LEVEL(x.level)} ${x.school}${x.concentration ? ' · concentration' : ''}${x.ritual ? ' · ritual' : ''}`;
  if (kind === 'monsters') return `${x.size} ${x.type} · CR ${x.cr} · AC ${x.ac} · HP ${x.hp}`;
  if (kind === 'equipment') return [x.category, x.damage && `${x.damage} ${x.damageType}`.trim(), x.ac && `AC ${x.ac}`, x.cost, x.weight ? `${x.weight} lb` : ''].filter(Boolean).join(' · ');
  if (kind === 'magic-items') return [x.category, x.rarity, x.attunement ? 'attunement' : ''].filter(Boolean).join(' · ');
  return '';
}

/** One entry in full. */
export function SrdEntry({ kind, x, roll }) {
  const para = { whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '6px 0 0' };
  const line = (k, v) => (v ? <div><b style={{ color: 'var(--accent-purple)' }}>{k}</b> {v}</div> : null);
  if (kind === 'monsters') return <StatBlock m={x} roll={roll} />;
  return (
    <div style={{ ...box, fontSize: '0.8rem' }}>
      <div style={{ color: 'var(--accent-amber)', fontSize: '0.95rem' }}>{x.name}</div>
      {kind === 'spells' && (
        <>
          <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>{summary(kind, x)}</div>
          {line('Casting time', x.time)}{line('Range', x.range)}{line('Components', x.components)}{line('Duration', x.duration)}
          {line('Classes', x.classes.join(', '))}
          <p style={para}>{x.text}</p>
          {x.higher && <p style={para}><b>At higher levels.</b> {x.higher}</p>}
        </>
      )}
      {kind === 'equipment' && (
        <>
          <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>{x.category}</div>
          {line('Cost', x.cost)}{line('Weight', x.weight ? `${x.weight} lb` : '')}
          {line('Damage', (x.damage || x.flatDamage) && `${x.damage || x.flatDamage} ${x.damageType}${x.versatile ? ` (${x.versatile} two-handed)` : ''}`)}
          {line('Properties', x.properties.join(', '))}{line('Mastery', x.mastery)}{line('Range', x.range)}
          {line('Armor Class', x.ac)}{line('Strength', x.strMin ? `${x.strMin} needed` : '')}{line('Stealth', x.stealthDisadvantage ? 'Disadvantage' : '')}
          {x.text && <p style={para}>{x.text}</p>}
        </>
      )}
      {kind === 'magic-items' && (
        <>
          <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>{summary(kind, x)}</div>
          <p style={para}>{x.text}</p>
        </>
      )}
      {kind === 'conditions' && <p style={para}>{x.text}</p>}
    </div>
  );
}

/**
 * A searchable list. With `onPick`, each open entry has a button to take it
 * (into a sheet or the GM's stat blocks).
 */
export function SrdList({ edition, kind, onPick, pickLabel = 'Add', roll, filter: fixedFilter }) {
  const [all, setAll] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [facet, setFacet] = useState('');
  const [open, setOpen] = useState(null);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => {
    let live = true; setAll(null); setOpen(null); setFacet('');
    loadSrd(edition, kind).then(d => { if (live) setAll(d); }).catch(() => { if (live) setError('Could not load the reference. Check your connection.'); });
    return () => { live = false; };
  }, [edition, kind]);

  // The second filter: spell level, monster CR, equipment category, item rarity.
  const facets = useMemo(() => {
    if (!all) return [];
    if (kind === 'spells') return [...new Set(all.map(x => x.level))].sort((a, b) => a - b).map(l => [String(l), LEVEL(l)]);
    if (kind === 'monsters') return [...new Set(all.map(x => x.cr))].sort((a, b) => crValue(a) - crValue(b)).map(c => [c, `CR ${c}`]);
    if (kind === 'equipment') return [...new Set(all.map(x => x.category))].sort().map(c => [c, c]);
    if (kind === 'magic-items') return [...new Set(all.map(x => x.rarity).filter(Boolean))].map(r => [r, r]);
    return [];
  }, [all, kind]);

  const results = useMemo(() => {
    if (!all) return [];
    const needle = q.trim().toLowerCase();
    return all.filter(x => (!fixedFilter || fixedFilter(x))
      && (!needle || x.name.toLowerCase().includes(needle) || (kind === 'spells' && x.classes.some(c => c.toLowerCase() === needle)))
      && (!facet || String(kind === 'spells' ? x.level : kind === 'monsters' ? x.cr : kind === 'equipment' ? x.category : x.rarity) === facet));
  }, [all, q, facet, kind, fixedFilter]);
  useEffect(() => { setShown(PAGE); }, [q, facet]);

  if (error) return <div style={{ color: 'var(--accent-orange)' }}>{error}</div>;
  if (!all) return <div style={{ color: 'var(--text-dim)' }}>Loading the reference…</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input value={q} onChange={(e) => setQ(e.target.value.slice(0, 60))} placeholder={kind === 'spells' ? 'Search, or a class: wizard' : 'Search'} aria-label="Search the reference" style={inputStyle} />
        {facets.length > 1 && (
          <select value={facet} onChange={(e) => setFacet(e.target.value)} aria-label="Filter" style={{ ...inputStyle, width: 'auto', maxWidth: '45%' }}>
            <option value="">All</option>
            {facets.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        )}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>{results.length} of {all.length}</div>
      {results.slice(0, shown).map(x => (
        <div key={x.id}>
          <button type="button" onClick={() => setOpen(open === x.id ? null : x.id)} aria-expanded={open === x.id}
            style={{ ...box, width: '100%', textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span>{x.name}</span>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>{summary(kind, x)}</span>
          </button>
          {open === x.id && (
            <div style={{ margin: '4px 0 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {onPick && <button type="button" onClick={() => onPick(x)} style={{ ...btn(true), alignSelf: 'flex-start' }}>{pickLabel}</button>}
              <SrdEntry kind={kind} x={x} roll={roll} />
            </div>
          )}
        </div>
      ))}
      {results.length > shown && <button type="button" onClick={() => setShown(n => n + PAGE)} style={btn()}>Show more</button>}
    </div>
  );
}

/** A picker that takes over a panel's body, with a way back. */
export function SrdPicker({ edition, kind, onPick, onClose, pickLabel, title, filter }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button type="button" onClick={onClose} style={btn()} aria-label="Back">◀</button>
        <span style={{ color: 'var(--accent-purple)' }}>{title}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>SRD {edition === '2014' ? '5.1 (2014)' : '5.2 (2024)'}</span>
      </div>
      <SrdList edition={edition} kind={kind} onPick={onPick} pickLabel={pickLabel} filter={filter} />
    </div>
  );
}

/** The reference on its own, from a table's ⋮ menu. */
export default function RulesPanel({ table, isMobile, onClose }) {
  const [edition, setEdition] = useState(editionOf(table?.system));
  const [kind, setKind] = useState('spells');
  return (
    <Frame isMobile={isMobile} onClose={onClose} title="Rules reference" label="Close the rules reference"
      right={(
        <select aria-label="Rules edition" value={edition} onChange={(e) => setEdition(e.target.value)} style={{ ...inputStyle, width: 'auto', fontSize: '0.72rem', padding: '4px' }}>
          <option value="2024">2024 rules</option><option value="2014">2014 rules</option>
        </select>
      )}>
      <div role="tablist" style={{ display: 'flex', gap: '4px', marginBottom: '10px', overflowX: 'auto' }}>
        {SRD_KINDS.map(([k, l]) => <button key={k} role="tab" aria-selected={kind === k} type="button" onClick={() => setKind(k)} style={{ ...btn(kind === k), flex: '1 0 auto', padding: '6px 8px' }}>{l}</button>)}
      </div>
      <SrdList edition={edition} kind={kind} />
      <div style={{ ...labelStyle, marginTop: '14px', textTransform: 'none', letterSpacing: 0 }}>
        From the System Reference Document {edition === '2014' ? '5.1' : '5.2'} by Wizards of the Coast LLC, CC-BY-4.0.
      </div>
    </Frame>
  );
}
