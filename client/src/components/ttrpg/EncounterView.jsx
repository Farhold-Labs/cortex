import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { derive, d20Roll, CONDITIONS, isDnd5e } from '../../ttrpg/dnd5e2024.js';
import {
  blankEncounter, blankEncounterGm, combatant, initiativeRef, encounterRefPrefix, statusFromHp,
  sortByInitiative, nextTurn, previousTurn, applyInitiativeRolls,
} from '../../ttrpg/encounter.js';
import { initiativeBonus, averageOf } from '../../ttrpg/monster.js';
import { listTableDocs, createTableDoc, deleteTableDoc, onTableDocUpdated, onTableRoll, useTableDoc, newDocId } from '../../utils/tableDocs.js';
import { listSheets, openSheet, onSheetUpdated } from '../../utils/sheets.js';
import { plainText } from '../../utils/plainText.js';
import { btn, rollBtn, labelStyle, inputStyle, box } from './sheetUi.jsx';
import { useMonsters, StatBlock } from './MonsterViews.jsx';

/**
 * Initiative and encounters (v2.160.0). The GM runs it; everyone at the table
 * follows the order live. A monster's hit points stay in the GMs' half; the
 * table sees Bloodied or Down.
 */

const STATUS = { bloodied: { word: 'Bloodied', color: 'var(--accent-amber)' }, down: { word: 'Down', color: 'var(--accent-orange)' } };
const small = { ...btn(), minHeight: '28px', padding: '2px 8px' };

export function EncounterTab(props) {
  const { wave, isGm, fetchAPI, e2ee, showToast } = props;
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [name, setName] = useState('');
  const e2eeRef = useRef(e2ee); e2eeRef.current = e2ee;
  const load = useCallback(async () => {
    try { setList(await listTableDocs(fetchAPI, e2eeRef.current, wave.id, 'encounter')); } catch { setList([]); }
  }, [fetchAPI, wave.id, e2ee?.isUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => onTableDocUpdated(({ waveId, kind }) => { if (waveId === wave.id && kind === 'encounter') load(); }), [wave.id, load]);
  // A player lands on the running encounter: the one the GM touched last, if
  // more than one is open.
  useEffect(() => {
    if (openId || !list) return;
    const running = list.filter(d => d.body?.active).sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)))[0];
    if (running && !isGm) setOpenId(running.id);
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    try {
      const id = newDocId(); const gmId = newDocId();
      await createTableDoc(fetchAPI, e2ee, wave, { kind: 'encounter_gm', id: gmId, data: blankEncounterGm(id) });
      await createTableDoc(fetchAPI, e2ee, wave, { kind: 'encounter', id, data: blankEncounter(name.trim(), gmId) });
      setName(''); setOpenId(id);
    } catch (err) { showToast?.(err.message || 'Could not start the encounter', 'error'); }
  };

  if (openId) return <EncounterView {...props} encounterId={openId} onBack={() => { setOpenId(null); load(); }} />;
  const sorted = (list || []).slice().sort((a, b) => (b.body?.active ? 1 : 0) - (a.body?.active ? 1 : 0) || String(b.createdAt).localeCompare(String(a.createdAt)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {isGm && (
        <div style={{ display: 'flex', gap: '6px' }}>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} placeholder="Encounter name" aria-label="Encounter name" style={inputStyle} />
          <button type="button" onClick={create} style={{ ...btn(true), whiteSpace: 'nowrap' }}>+ New</button>
        </div>
      )}
      {!list && <div style={{ color: 'var(--text-dim)' }}>Loading…</div>}
      {list && !list.length && <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>{isGm ? 'No encounters yet.' : 'No encounter is running.'}</div>}
      {sorted.map(d => (
        <button key={d.id} type="button" onClick={() => setOpenId(d.id)}
          style={{ ...box, textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'monospace', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>{d.body ? plainText(d.body.name || '') || 'Encounter' : '🔒 Unlock encryption to read'}</span>
          {d.body?.active && <span style={{ color: 'var(--accent-green)', fontSize: '0.7rem' }}>{d.body.round ? `ROUND ${d.body.round}` : 'SETTING UP'}</span>}
          {d.body && !d.body.active && <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>ENDED</span>}
        </button>
      ))}
    </div>
  );
}

function EncounterView(props) {
  const { wave, encounterId, isGm, fetchAPI, e2ee, onBack } = props;
  const pub = useTableDoc({ fetchAPI, e2ee, wave, docId: encounterId, kind: 'encounter' });
  if (pub.error) return <div><button type="button" onClick={onBack} style={btn()}>◀</button> <span style={{ color: 'var(--accent-orange)' }}>{pub.error === 'locked' ? '🔒 Unlock encryption to read this.' : pub.error}</span></div>;
  if (!pub.data) return <div style={{ color: 'var(--text-dim)' }}>Loading…</div>;
  if (isGm && pub.data.gmDocId) return <WithGmHalf {...props} pub={pub} />;
  return <EncounterBody {...props} pub={pub} gm={null} />;
}

function WithGmHalf(props) {
  const gm = useTableDoc({ fetchAPI: props.fetchAPI, e2ee: props.e2ee, wave: props.wave, docId: props.pub.data.gmDocId, kind: 'encounter_gm' });
  return <EncounterBody {...props} gm={gm} />;
}

/** Sheets this person can read, opened: for PCs' HP, conditions and initiative bonus. */
function useSheets(fetchAPI, e2ee, waveId) {
  const [sheets, setSheets] = useState({});
  const e2eeRef = useRef(e2ee); e2eeRef.current = e2ee;
  const load = useCallback(async () => {
    try {
      const list = await listSheets(fetchAPI, waveId);
      const out = {};
      await Promise.all(list.map(async (s) => { try { out[s.id] = { meta: s, data: await openSheet(e2eeRef.current, waveId, s) }; } catch { /* unreadable */ } }));
      setSheets(out);
    } catch { /* keep what we have */ }
  }, [fetchAPI, waveId, e2ee?.isUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => onSheetUpdated(({ waveId: w }) => { if (w === waveId) load(); }), [waveId, load]);
  return sheets;
}

function EncounterBody({ wave, table, isGm, names, currentUser, fetchAPI, e2ee, isMobile, showToast, roll, rollQuiet, notifyTurn, gmRollVisibility, pub, gm, onBack, encounterId }) {
  const e = pub.data;
  const g = gm?.data || null;
  const sheets = useSheets(fetchAPI, e2ee, wave.id);
  const monsters = useMonsters({ fetchAPI, e2ee: isGm ? e2ee : null, wave: isGm ? wave : { id: '' } });
  const [adding, setAdding] = useState(null); // 'pc' | 'monster' | 'other'
  const [openBlock, setOpenBlock] = useState(null);
  const [notify, setNotify] = useState(true);
  const [rolled, setRolled] = useState({}); // this device's initiative rolls waiting for the GM
  const now = (fn) => pub.change(fn, { now: true });
  const nowGm = (fn) => gm?.change(fn, { now: true });

  // The GM's device fills players' initiative from their rolls.
  const fillInitiative = useCallback(async () => {
    if (!isGm || !pub.data) return;
    try {
      const { rolls } = await fetchAPI(`/waves/${encodeURIComponent(wave.id)}/rolls?ref=${encodeURIComponent(encounterRefPrefix(encounterId))}&limit=200`);
      const probe = JSON.parse(JSON.stringify(pub.data));
      if (!applyInitiativeRolls(probe, rolls, encounterId)) return;
      pub.change((d) => { applyInitiativeRolls(d, rolls, encounterId); if (!d.round) d.combatants = sortByInitiative(d.combatants); }, { now: true });
    } catch { /* tried again on the next roll */ }
  }, [isGm, fetchAPI, wave.id, encounterId, pub]);
  useEffect(() => { fillInitiative(); }, [isGm, !!pub.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => onTableRoll(({ waveId, ref }) => {
    if (waveId === wave.id && typeof ref === 'string' && ref.startsWith(encounterRefPrefix(encounterId))) fillInitiative();
  }), [wave.id, encounterId, fillInitiative]);

  const all = useMemo(() => [
    ...e.combatants.map(c => ({ ...c, hidden: false })),
    ...(isGm && g ? (g.hidden || []).map(c => ({ ...c, hidden: true })) : []),
  ], [e, g, isGm]);
  const current = e.combatants.find(c => c.id === e.turn);
  const myTurn = current && current.ownerId === currentUser?.id;

  const advance = (back = false) => {
    const probe = JSON.parse(JSON.stringify(e));
    (back ? previousTurn : nextTurn)(probe);
    now(d => { (back ? previousTurn : nextTurn)(d); });
    const next = probe.combatants.find(c => c.id === probe.turn);
    if (!back && notify && next?.ownerId) notifyTurn(next.ownerId);
  };

  const stat = (id) => g?.stats?.[id] || null;
  const setHp = (c, delta) => {
    const st = stat(c.id); if (!st) return;
    const hp = Math.max(0, Math.min(st.maxHp, (Number(st.hp) || 0) + delta));
    nowGm(d => { d.stats = { ...d.stats, [c.id]: { ...d.stats[c.id], hp: Math.max(0, Math.min(d.stats[c.id].maxHp, (Number(d.stats[c.id].hp) || 0) + delta)) } }; });
    const status = statusFromHp(hp, st.maxHp);
    if (!c.hidden) now(d => { const x = d.combatants.find(y => y.id === c.id); if (x) x.status = status; });
    else nowGm(d => { const x = d.hidden.find(y => y.id === c.id); if (x) x.status = status; });
  };

  const edit = (c, fn) => {
    if (c.hidden) nowGm(d => { const x = (d.hidden || []).find(y => y.id === c.id); if (x) fn(x); });
    else now(d => { const x = d.combatants.find(y => y.id === c.id); if (x) fn(x); });
  };
  const hide = (c, hidden) => {
    const { hidden: _h, ...plain } = c;
    if (hidden) {
      now(d => { d.combatants = d.combatants.filter(x => x.id !== c.id); if (d.turn === c.id) d.turn = null; });
      nowGm(d => { d.hidden = [...(d.hidden || []), plain]; });
    } else {
      nowGm(d => { d.hidden = (d.hidden || []).filter(x => x.id !== c.id); });
      now(d => { d.combatants = d.round ? [...d.combatants, plain] : sortByInitiative([...d.combatants, plain]); });
    }
  };
  const remove = (c) => {
    if (!window.confirm(`Remove ${c.name}?`)) return;
    if (c.hidden) nowGm(d => { d.hidden = (d.hidden || []).filter(x => x.id !== c.id); });
    else now(d => { d.combatants = d.combatants.filter(x => x.id !== c.id); if (d.turn === c.id) d.turn = null; });
    nowGm(d => { const { [c.id]: _gone, ...rest } = d.stats || {}; d.stats = rest; });
  };
  const move = (c, by) => now(d => {
    const i = d.combatants.findIndex(x => x.id === c.id); const j = i + by;
    if (i < 0 || j < 0 || j >= d.combatants.length) return;
    [d.combatants[i], d.combatants[j]] = [d.combatants[j], d.combatants[i]];
  });

  const rollMonsters = async () => {
    for (const c of all.filter(x => x.kind !== 'pc' && x.initiative == null)) {
      const r = await rollQuiet({ expression: `1d20${c.initBonus ? (c.initBonus > 0 ? `+${c.initBonus}` : c.initBonus) : ''}`, visibility: 'gm_secret', ref: initiativeRef(encounterId, c.id) });
      if (r && !r.hidden) edit(c, x => { x.initiative = r.total; });
    }
    if (!e.round) now(d => { d.combatants = sortByInitiative(d.combatants); });
  };

  const rollMine = async (c) => {
    const sheet = c.sheetId ? sheets[c.sheetId]?.data : null;
    const expression = isDnd5e(sheet?.system)
      ? (() => { const dd = derive(sheet); return d20Roll(dd.initiative, dd); })()
      : `1d20${c.initBonus ? (c.initBonus > 0 ? `+${c.initBonus}` : c.initBonus) : ''}`;
    const r = await roll({ expression, label: `${plainText(c.name)}: Initiative`, visibility: 'public', ref: initiativeRef(encounterId, c.id) });
    if (r) setRolled(x => ({ ...x, [c.id]: r.total }));
  };

  const end = () => { if (window.confirm(e.active ? 'End this encounter?' : 'Open this encounter again?')) now(d => { d.active = !d.active; }); };
  const removeEncounter = async () => {
    if (!window.confirm('Delete this encounter?')) return;
    try {
      if (e.gmDocId) await deleteTableDoc(fetchAPI, wave.id, e.gmDocId).catch(() => {});
      await deleteTableDoc(fetchAPI, wave.id, encounterId); onBack();
    } catch (err) { showToast?.(err.message || 'Could not delete', 'error'); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={btn()} aria-label="All encounters">◀</button>
        <span style={{ flex: 1, color: 'var(--accent-amber)', fontSize: '0.95rem' }}>{plainText(e.name || '') || 'Encounter'}</span>
        <span style={{ color: 'var(--text-dim)' }}>{!e.active ? 'ENDED' : e.round ? `ROUND ${e.round}` : 'SETTING UP'}</span>
        {(pub.saving || gm?.saving) && <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>saving…</span>}
      </div>

      {myTurn && e.active && <div role="status" style={{ ...box, borderColor: 'var(--accent-green)', color: 'var(--accent-green)' }}>▶ It's your turn{current ? `: ${plainText(current.name)}` : ''}</div>}

      {isGm && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" disabled={!e.active || !e.combatants.length} onClick={() => advance()} style={btn(true)}>{e.round ? 'Next turn ▶' : 'Start ▶'}</button>
          {e.round > 0 && <button type="button" onClick={() => advance(true)} style={btn()} aria-label="Previous turn">◀ Back</button>}
          <button type="button" onClick={rollMonsters} style={btn()}>Roll for monsters</button>
          <button type="button" onClick={() => now(d => { d.combatants = sortByInitiative(d.combatants); })} style={btn()}>Sort</button>
          <label style={{ display: 'flex', gap: '4px', alignItems: 'center', color: 'var(--text-dim)', fontSize: '0.72rem' }}>
            <input type="checkbox" checked={notify} onChange={(ev) => setNotify(ev.target.checked)} />Tell players it's their turn
          </label>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} role="list" aria-label="Initiative order">
        {!all.length && <div style={{ color: 'var(--text-dim)' }}>{isGm ? 'Add characters and monsters below.' : 'Nobody in the order yet.'}</div>}
        {all.map((c) => {
          const isTurn = e.turn === c.id && e.active;
          const sheet = c.sheetId ? sheets[c.sheetId] : null;
          const st = stat(c.id);
          const mine = c.ownerId === currentUser?.id;
          const conditions = c.kind === 'pc' && sheet?.data?.conditions ? sheet.data.conditions : c.conditions || [];
          const block = c.monsterId ? monsters?.find(m => m.id === c.monsterId)?.body : null;
          return (
            <div key={c.id} role="listitem" aria-current={isTurn ? 'true' : undefined}
              style={{ ...box, borderColor: isTurn ? 'var(--accent-green)' : 'var(--border-secondary)', borderLeft: `3px solid ${isTurn ? 'var(--accent-green)' : 'transparent'}`, opacity: c.hidden ? 0.6 : 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {isGm ? (
                  <input aria-label={`${c.name} initiative`} inputMode="numeric" value={c.initiative ?? ''} placeholder="–"
                    onChange={(ev) => { const v = ev.target.value.replace(/[^0-9-]/g, '').slice(0, 3); edit(c, x => { x.initiative = v === '' || v === '-' ? null : Number(v); }); }}
                    style={{ ...inputStyle, width: '3.2em', textAlign: 'center', padding: '4px' }} />
                ) : (
                  <span style={{ width: '2.4em', textAlign: 'center', color: 'var(--accent-amber)', fontSize: '1rem' }}>{c.initiative ?? (rolled[c.id] != null ? `${rolled[c.id]}*` : '–')}</span>
                )}
                <span style={{ flex: '1 1 100px', color: 'var(--text-primary)' }}>
                  {isTurn ? '▶ ' : ''}{plainText(c.name)}
                  {c.kind === 'pc' && c.ownerId && <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}> · {mine ? 'you' : names[c.ownerId] || ''}</span>}
                  {c.hidden && <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}> · hidden</span>}
                </span>
                {c.kind === 'pc' && sheet?.data?.hp && <span style={{ color: 'var(--text-secondary)' }}>HP {sheet.data.hp.current}/{sheet.data.hp.max}</span>}
                {c.status && STATUS[c.status] && <span style={{ color: STATUS[c.status].color, border: `1px solid ${STATUS[c.status].color}`, padding: '0 6px', fontSize: '0.7rem' }}>{STATUS[c.status].word}</span>}
                {!isGm && mine && c.initiative == null && rolled[c.id] == null && e.active && <button type="button" onClick={() => rollMine(c)} style={rollBtn}>Roll initiative</button>}
              </div>
              {isGm && st && (
                <HpRow c={c} st={st} setHp={setHp} />
              )}
              {(conditions.length > 0 || (isGm && c.kind !== 'pc')) && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {conditions.map(x => (
                    <button key={x} type="button" disabled={!isGm || c.kind === 'pc'} onClick={() => edit(c, y => { y.conditions = (y.conditions || []).filter(z => z !== x); })}
                      style={{ ...small, minHeight: '22px', padding: '0 6px', color: 'var(--accent-orange)', borderColor: 'var(--accent-orange)' }}>{x}{isGm && c.kind !== 'pc' ? ' ✕' : ''}</button>
                  ))}
                  {isGm && c.kind !== 'pc' && (
                    <select aria-label={`Add a condition to ${c.name}`} value="" onChange={(ev) => { const x = ev.target.value; if (x) edit(c, y => { y.conditions = [...new Set([...(y.conditions || []), x])]; }); }}
                      style={{ ...inputStyle, width: 'auto', padding: '2px 4px', fontSize: '0.72rem' }}>
                      <option value="">+ condition</option>
                      {CONDITIONS.filter(x => !conditions.includes(x)).map(x => <option key={x} value={x}>{x}</option>)}
                    </select>
                  )}
                </div>
              )}
              {isGm && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {!c.hidden && <button type="button" onClick={() => move(c, -1)} style={small} aria-label={`Move ${c.name} up`}>▲</button>}
                  {!c.hidden && <button type="button" onClick={() => move(c, 1)} style={small} aria-label={`Move ${c.name} down`}>▼</button>}
                  <button type="button" onClick={() => hide(c, !c.hidden)} style={small}>{c.hidden ? 'Reveal' : 'Hide'}</button>
                  {block && <button type="button" onClick={() => setOpenBlock(openBlock === c.id ? null : c.id)} style={small}>Stat block</button>}
                  <button type="button" onClick={() => remove(c)} style={{ ...small, color: 'var(--text-dim)' }} aria-label={`Remove ${c.name}`}>✕</button>
                </div>
              )}
              {isGm && block && openBlock === c.id && (
                <StatBlock m={block} who={plainText(c.name)} roll={(expression, label) => roll({ expression, label, visibility: gmRollVisibility })} />
              )}
            </div>
          );
        })}
      </div>

      {isGm && e.active && (
        <AddCombatants adding={adding} setAdding={setAdding} sheets={sheets} names={names} monsters={monsters} e={e} g={g}
          rollQuiet={rollQuiet} onAdd={(list, stats, hidden) => {
            if (stats && Object.keys(stats).length) nowGm(d => { d.stats = { ...(d.stats || {}), ...stats }; if (hidden) d.hidden = [...(d.hidden || []), ...list]; });
            else if (hidden) nowGm(d => { d.hidden = [...(d.hidden || []), ...list]; });
            if (!hidden) now(d => { d.combatants = d.round ? [...d.combatants, ...list] : [...d.combatants, ...list]; });
          }} />
      )}

      {isGm && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
          <button type="button" onClick={end} style={btn()}>{e.active ? 'End encounter' : 'Open again'}</button>
          <button type="button" onClick={removeEncounter} style={{ ...btn(), color: 'var(--accent-orange)' }}>Delete</button>
        </div>
      )}
    </div>
  );
}

function HpRow({ c, st, setHp }) {
  const [amount, setAmount] = useState('');
  const n = Math.floor(Number(amount));
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ color: statusFromHp(st.hp, st.maxHp) === 'down' ? 'var(--accent-orange)' : 'var(--text-primary)' }} aria-label={`${c.name} hit points`}>HP {st.hp}/{st.maxHp}</span>
      {st.ac != null && <span style={{ color: 'var(--text-dim)' }}>AC {st.ac}</span>}
      <input aria-label={`Amount for ${c.name}`} inputMode="numeric" value={amount} placeholder="0" onChange={(ev) => setAmount(ev.target.value.replace(/[^0-9]/g, '').slice(0, 4))} style={{ ...inputStyle, width: '3.6em', padding: '3px 6px' }} />
      <button type="button" disabled={!n} onClick={() => { setHp(c, -n); setAmount(''); }} style={{ ...small, color: 'var(--accent-orange)' }}>Damage</button>
      <button type="button" disabled={!n} onClick={() => { setHp(c, n); setAmount(''); }} style={{ ...small, color: 'var(--accent-green)' }}>Heal</button>
      <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>(GMs only)</span>
    </div>
  );
}

function AddCombatants({ adding, setAdding, sheets, names, monsters, e, g, rollQuiet, onAdd }) {
  const [monsterId, setMonsterId] = useState('');
  const [count, setCount] = useState(1);
  const [hpMode, setHpMode] = useState('average');
  const [hidden, setHidden] = useState(false);
  const [other, setOther] = useState('');
  const present = new Set([...e.combatants, ...((g?.hidden) || [])].map(c => c.sheetId).filter(Boolean));
  const pcs = Object.values(sheets).filter(s => !present.has(s.meta.id));

  const addPcs = (list) => onAdd(list.map(s => {
    const bonus = isDnd5e(s.data.system) ? derive(s.data).initiative : 0;
    return combatant({ name: plainText(s.data.name || '') || 'Character', kind: 'pc', ownerId: s.meta.ownerId, sheetId: s.meta.id, initBonus: bonus });
  }), null, false);

  const addMonsters = async () => {
    const doc = monsters?.find(m => m.id === monsterId); const m = doc?.body;
    if (!m) return;
    const base = plainText(m.name || '') || 'Monster';
    const taken = [...e.combatants, ...((g?.hidden) || [])].filter(c => c.monsterId === doc.id).length;
    const n = Math.max(1, Math.min(20, Number(count) || 1));
    const list = []; const stats = {};
    for (let i = 0; i < n; i++) {
      const c = combatant({ name: n > 1 || taken ? `${base} ${taken + i + 1}` : base, kind: 'monster', monsterId: doc.id, initBonus: initiativeBonus(m) });
      let hp = Number(m.hp) || averageOf(m.hpFormula) || 1;
      if (hpMode === 'roll' && m.hpFormula) {
        const r = await rollQuiet({ expression: m.hpFormula, visibility: 'gm_secret' });
        if (r && !r.hidden) hp = Math.max(1, r.total);
      }
      stats[c.id] = { hp, maxHp: hp, ac: m.ac ?? null };
      list.push(c);
    }
    onAdd(list, stats, hidden);
    setAdding(null);
  };

  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ ...labelStyle, margin: 0, alignSelf: 'center' }}>ADD</span>
        {[['pc', 'Characters'], ['monster', 'Monsters'], ['other', 'Other']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setAdding(adding === k ? null : k)} style={{ ...btn(adding === k), minHeight: '30px', padding: '2px 10px' }}>{l}</button>
        ))}
      </div>
      {adding === 'pc' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {!pcs.length && <div style={{ color: 'var(--text-dim)' }}>Every sheet at the table is in already.</div>}
          {pcs.length > 1 && <button type="button" onClick={() => { addPcs(pcs); setAdding(null); }} style={btn(true)}>Add all {pcs.length}</button>}
          {pcs.map(s => (
            <button key={s.meta.id} type="button" onClick={() => addPcs([s])} style={{ ...btn(), textAlign: 'left' }}>
              {plainText(s.data.name || '') || 'Character'} <span style={{ color: 'var(--text-dim)' }}>· {names[s.meta.ownerId] || ''}</span>
            </button>
          ))}
        </div>
      )}
      {adding === 'monster' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {!monsters?.length && <div style={{ color: 'var(--text-dim)' }}>No stat blocks yet: make some in Monsters.</div>}
          {monsters?.length > 0 && (
            <>
              <select aria-label="Monster" value={monsterId} onChange={(ev) => setMonsterId(ev.target.value)} style={inputStyle}>
                <option value="">Choose a stat block…</option>
                {monsters.filter(m => m.body).map(m => <option key={m.id} value={m.id}>{plainText(m.body.name || '')} (CR {m.body.cr})</option>)}
              </select>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>How many
                  <input aria-label="How many" inputMode="numeric" value={count} onChange={(ev) => setCount(ev.target.value.replace(/[^0-9]/g, '').slice(0, 2))} style={{ ...inputStyle, width: '3em' }} /></label>
                <select aria-label="Hit points" value={hpMode} onChange={(ev) => setHpMode(ev.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                  <option value="average">Average HP</option><option value="roll">Roll HP</option>
                </select>
                <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}><input type="checkbox" checked={hidden} onChange={(ev) => setHidden(ev.target.checked)} />Hidden</label>
              </div>
              <button type="button" disabled={!monsterId} onClick={addMonsters} style={btn(true)}>Add</button>
            </>
          )}
        </div>
      )}
      {adding === 'other' && (
        <div style={{ display: 'flex', gap: '6px' }}>
          <input aria-label="Name" value={other} placeholder="Name (an ally, a lair action…)" onChange={(ev) => setOther(ev.target.value.slice(0, 60))} style={inputStyle} />
          <button type="button" disabled={!other.trim()} onClick={() => { onAdd([combatant({ name: other.trim(), kind: 'other' })], null, false); setOther(''); setAdding(null); }} style={btn(true)}>Add</button>
        </div>
      )}
    </div>
  );
}
