import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ABILITIES, signed, mod, newId } from '../../ttrpg/dnd5e2024.js';
import { blankMonster, averageOf, SECTIONS } from '../../ttrpg/monster.js';
import { listTableDocs, createTableDoc, deleteTableDoc, onTableDocUpdated, useTableDoc } from '../../utils/tableDocs.js';
import { plainText } from '../../utils/plainText.js';
import { btn, rollBtn, labelStyle, box, sectionTitle, Field, ListRows } from './sheetUi.jsx';

/**
 * Monster stat blocks (v2.160.0): the GM's library at a table, GM-only. A
 * stat block's actions are roll buttons; the GM's rolls go to the wave as
 * "for the GM" unless the GM chooses public.
 */

/** The library: every stat block at the table. */
export function useMonsters({ fetchAPI, e2ee, wave }) {
  const [monsters, setMonsters] = useState(null);
  const e2eeRef = useRef(e2ee); e2eeRef.current = e2ee;
  const load = useCallback(async () => {
    try { setMonsters(await listTableDocs(fetchAPI, e2eeRef.current, wave.id, 'monster')); } catch { setMonsters([]); }
  }, [fetchAPI, wave.id, e2ee?.isUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => onTableDocUpdated(({ waveId, kind }) => { if (waveId === wave.id && kind === 'monster') load(); }), [wave.id, load]);
  return monsters;
}

export function MonsterLibrary({ wave, fetchAPI, e2ee, showToast, roll, isMobile }) {
  const monsters = useMonsters({ fetchAPI, e2ee, wave });
  const [openId, setOpenId] = useState(null);
  const fileRef = useRef(null);

  const create = async (data) => {
    try {
      const doc = await createTableDoc(fetchAPI, e2ee, wave, { kind: 'monster', data });
      setOpenId(doc.id);
    } catch (err) { showToast?.(err.message || 'Could not add the monster', 'error'); }
  };
  const importJson = async (file) => {
    try {
      if (file.size > 500 * 1024) throw new Error('That file is too large');
      const parsed = JSON.parse(await file.text());
      const list = Array.isArray(parsed) ? parsed : parsed?.monsters || [parsed?.monster || parsed];
      let n = 0;
      for (const m of list.slice(0, 100)) {
        if (!m || typeof m !== 'object' || !m.name) continue;
        await createTableDoc(fetchAPI, e2ee, wave, { kind: 'monster', data: { ...blankMonster(), ...m, schema: 1 } });
        n++;
      }
      showToast?.(n ? `Imported ${n} stat block${n === 1 ? '' : 's'}` : 'No stat blocks in that file', n ? 'success' : 'error');
    } catch (err) { showToast?.(err.message || 'Could not import', 'error'); }
  };
  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ format: 'cortex-monsters', version: 1, monsters: (monsters || []).filter(m => m.body).map(m => m.body) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'monsters.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (openId) return <MonsterEditor wave={wave} docId={openId} fetchAPI={fetchAPI} e2ee={e2ee} roll={roll} isMobile={isMobile} showToast={showToast} onBack={() => setOpenId(null)} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => create(blankMonster('New monster'))} style={btn(true)}>+ New stat block</button>
        <button type="button" onClick={() => fileRef.current?.click()} style={btn()}>Import JSON</button>
        {monsters?.length > 0 && <button type="button" onClick={exportAll} style={btn()}>Export all</button>}
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importJson(f); }} />
      </div>
      {!monsters && <div style={{ color: 'var(--text-dim)' }}>Loading…</div>}
      {monsters && !monsters.length && <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>No stat blocks yet. Only the GMs can see them.</div>}
      {(monsters || []).slice().sort((a, b) => String(a.body?.name || '').localeCompare(String(b.body?.name || ''))).map(m => (
        <button key={m.id} type="button" onClick={() => setOpenId(m.id)}
          style={{ ...box, textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'monospace', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span>{m.body ? plainText(m.body.name || '') || 'Unnamed' : '🔒 Unlock encryption to read'}</span>
          {m.body && <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>{m.body.size} {m.body.type} · CR {m.body.cr} · AC {m.body.ac} · HP {m.body.hp}</span>}
        </button>
      ))}
    </div>
  );
}

function MonsterEditor({ wave, docId, fetchAPI, e2ee, roll, isMobile, showToast, onBack }) {
  const { data, error, saving, change } = useTableDoc({ fetchAPI, e2ee, wave, docId, kind: 'monster' });
  const [editing, setEditing] = useState(false);
  const set = (fn) => change(fn);
  const now = (fn) => change(fn, { now: true });
  const remove = async () => {
    if (!window.confirm(`Delete ${data?.name || 'this stat block'}?`)) return;
    try { await deleteTableDoc(fetchAPI, wave.id, docId); onBack(); } catch (err) { showToast?.(err.message || 'Could not delete', 'error'); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button type="button" onClick={onBack} style={btn()} aria-label="All stat blocks">◀</button>
        <span style={{ flex: 1 }} />
        {saving && <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>saving…</span>}
        <button type="button" onClick={() => setEditing(e => !e)} style={btn(editing)}>{editing ? 'Done' : 'Edit'}</button>
        <button type="button" onClick={remove} style={{ ...btn(), color: 'var(--accent-orange)' }}>Delete</button>
      </div>
      {error && <div style={{ color: error === 'locked' ? 'var(--text-dim)' : 'var(--accent-orange)' }}>{error === 'locked' ? '🔒 Unlock encryption to read this.' : error}</div>}
      {data && !editing && <StatBlock m={data} roll={roll} />}
      {data && editing && <MonsterForm m={data} set={set} now={now} isMobile={isMobile} />}
    </div>
  );
}

/** A stat block, read-only, with roll buttons. `who` prefixes roll labels (e.g. "Goblin 2"). */
export function StatBlock({ m, roll, who }) {
  const name = who || plainText(m.name || '') || 'Monster';
  const line = (label, value) => value ? <div><b style={{ color: 'var(--accent-purple)' }}>{label}</b> {value}</div> : null;
  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem', lineHeight: 1.5 }}>
      <div style={{ fontSize: '1rem', color: 'var(--accent-amber)' }}>{m.name}</div>
      <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>{[m.size, m.type].filter(Boolean).join(' ')}{m.alignment ? `, ${m.alignment}` : ''}</div>
      {line('AC', m.ac)}
      {line('HP', `${m.hp}${m.hpFormula ? ` (${m.hpFormula})` : ''}`)}
      {line('Speed', m.speed)}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '4px', margin: '4px 0' }}>
        {ABILITIES.map(a => (
          <button key={a.key} type="button" onClick={() => roll(`1d20${mod(m.abilities?.[a.key]) ? signed(mod(m.abilities?.[a.key])) : ''}`, `${name}: ${a.name} check`)}
            style={{ ...rollBtn, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '2px' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>{a.short}</span>
            <span>{m.abilities?.[a.key] ?? 10} ({signed(mod(m.abilities?.[a.key]))})</span>
          </button>
        ))}
      </div>
      {line('Saving Throws', m.saves)}
      {line('Skills', m.skills)}
      {line('Senses', m.senses)}
      {line('Languages', m.languages)}
      {line('CR', m.cr)}
      {SECTIONS.map(([key, title]) => (m[key] || []).length > 0 && (
        <div key={key}>
          <div style={sectionTitle}>{title.toUpperCase()}</div>
          {(m[key] || []).map(a => (
            <div key={a.id || a.name} style={{ marginBottom: '6px' }}>
              <b style={{ color: 'var(--text-primary)' }}>{a.name}.</b> <span style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)' }}>{a.text}</span>
              {(a.attack != null && a.attack !== '' || a.damage) && (
                <span style={{ display: 'inline-flex', gap: '4px', marginLeft: '6px', flexWrap: 'wrap' }}>
                  {a.attack != null && a.attack !== '' && <button type="button" onClick={() => roll(`1d20${Number(a.attack) ? signed(Number(a.attack)) : ''}`, `${name}: ${a.name} (to hit)`)} style={rollBtn}>Hit {signed(Number(a.attack) || 0)}</button>}
                  {a.damage && <button type="button" onClick={() => roll(a.damage, `${name}: ${a.name} (damage)`)} style={rollBtn}>{a.damage}</button>}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MonsterForm({ m, set, now, isMobile }) {
  const text = (label, key, max = 120) => (
    <div><div style={labelStyle}>{label}</div><Field value={m[key]} onChange={(v) => set(s => { s[key] = v.slice(0, max); })} /></div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: '8px' }}>
        <div style={{ gridColumn: '1 / -1' }}>{text('NAME', 'name', 60)}</div>
        {text('SIZE', 'size', 20)}{text('TYPE', 'type', 40)}{text('ALIGNMENT', 'alignment', 40)}
        <div><div style={labelStyle}>AC</div><Field type="number" value={m.ac} onChange={(v) => set(s => { s.ac = Math.max(0, v); })} /></div>
        <div><div style={labelStyle}>HIT DICE</div><Field value={m.hpFormula} placeholder="2d8+2" onChange={(v) => set(s => {
          s.hpFormula = v.replace(/[^0-9dD+\-]/g, '').slice(0, 30);
          const avg = averageOf(s.hpFormula); if (avg) s.hp = avg;
        })} /></div>
        <div><div style={labelStyle}>HP (AVERAGE)</div><Field type="number" value={m.hp} onChange={(v) => set(s => { s.hp = Math.max(1, v); })} /></div>
        {text('SPEED', 'speed', 60)}{text('CR', 'cr', 8)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '4px' }}>
        {ABILITIES.map(a => (
          <div key={a.key}><div style={{ ...labelStyle, textAlign: 'center' }}>{a.short}</div>
            <Field type="number" ariaLabel={a.name} value={m.abilities?.[a.key]} onChange={(v) => set(s => { s.abilities = { ...s.abilities, [a.key]: Math.max(1, Math.min(30, v)) }; })} style={{ textAlign: 'center', padding: '4px 2px' }} />
          </div>
        ))}
      </div>
      {text('SAVING THROWS', 'saves')}{text('SKILLS', 'skills')}{text('SENSES', 'senses')}{text('LANGUAGES', 'languages')}
      {SECTIONS.map(([key, title]) => (
        <div key={key}>
          <div style={sectionTitle}>{title.toUpperCase()}</div>
          <ListRows
            items={m[key] || []} canEdit addLabel={title.replace(/s$/, '').replace(/ actions$/, ' action')} empty="None."
            onAdd={() => now(s => { s[key] = [...(s[key] || []), { id: newId(), name: '', text: '', attack: key === 'traits' ? null : '', damage: '' }]; })}
            onRemove={(i) => now(s => { s[key] = s[key].filter((_, j) => j !== i); })}
            render={(a, i) => (
              <div style={{ display: 'grid', gridTemplateColumns: key === 'traits' ? '1fr' : 'minmax(0, 1fr) 5em 7em', gap: '6px' }}>
                <Field ariaLabel="Name" placeholder="Name" value={a.name} onChange={(v) => set(s => { s[key][i].name = v.slice(0, 60); })} />
                {key !== 'traits' && <Field ariaLabel="Attack bonus" placeholder="+hit" value={a.attack ?? ''} onChange={(v) => set(s => { const n = v.replace(/[^0-9-]/g, '').slice(0, 3); s[key][i].attack = n === '' || n === '-' ? '' : Number(n); })} />}
                {key !== 'traits' && <Field ariaLabel="Damage dice" placeholder="1d6+2" value={a.damage} onChange={(v) => set(s => { s[key][i].damage = v.replace(/[^0-9dD+\-]/g, '').slice(0, 30); })} />}
                <div style={{ gridColumn: '1 / -1' }}><Field multiline rows={2} ariaLabel="Text" placeholder="What it does" value={a.text} onChange={(v) => set(s => { s[key][i].text = v.slice(0, 2000); })} /></div>
              </div>
            )}
          />
        </div>
      ))}
      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>Attack bonus and damage dice become roll buttons.</div>
    </div>
  );
}
