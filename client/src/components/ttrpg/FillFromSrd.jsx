import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadCharacterSrd } from '../../srd/index.js';
import { SKILLS } from '../../ttrpg/dnd5e2024.js';
import { planFill, applyFill, undoFill, matchSubclass, subclassFirstLevel, levelUpHp } from '../../ttrpg/fill.js';
import { btn, labelStyle, inputStyle, box, sectionTitle } from './sheetUi.jsx';

/**
 * Fill a 5e sheet from the SRD (v2.163.0), or level up one class. Shows what
 * it would add, adds it in one change, and offers Undo. Never replaces what a
 * player wrote: features already on the sheet aren't added twice, resources
 * already there have their maximum raised, skills only go up.
 */

const SKILL_NAME = Object.fromEntries(SKILLS.map(k => [k.key, k.name]));
const RESET = { short: 'short rest', long: 'long rest', none: '—' };
const classIdOf = (name) => String(name || '').trim().toLowerCase();

export default function FillFromSrd({ data, edition, change, onClose, levelUp = null }) {
  const [srd, setSrd] = useState(null);
  const [error, setError] = useState(null);
  const [include, setInclude] = useState({ features: true, resources: true, skills: false, species: false, background: false, equipment: false });
  const [subclasses, setSubclasses] = useState({});
  const [speciesId, setSpeciesId] = useState('');
  const [subspeciesId, setSubspeciesId] = useState('');
  const [applyBonuses, setApplyBonuses] = useState(false);
  const [backgroundId, setBackgroundId] = useState('');
  const [skills, setSkills] = useState([]);
  const [equipment, setEquipment] = useState({ class: [], background: [] });
  const [hpMode, setHpMode] = useState('average');
  const [done, setDone] = useState(null);
  const undoRef = useRef(null);

  useEffect(() => {
    let live = true;
    loadCharacterSrd(edition).then((s) => {
      if (!live) return;
      setSrd(s);
      // Start from what the sheet already says.
      const sp = s.species.find(x => String(data.species || '').toLowerCase().startsWith(x.name.toLowerCase()));
      const have = new Set((data.featureList || []).map(f => f.key));
      if (sp) { setSpeciesId(sp.id); if (!sp.traits.some(t => have.has(`trait:${t}`))) setInclude(i => ({ ...i, species: !levelUp })); }
      const bg = s.backgrounds.find(x => x.name.toLowerCase() === String(data.background || '').toLowerCase());
      if (bg) { setBackgroundId(bg.id); if (!bg.feature || !have.has(`bg:${bg.feature}`)) setInclude(i => ({ ...i, background: !levelUp })); }
      if (!(data.inventory || []).length && !levelUp) setInclude(i => ({ ...i, equipment: true }));
      // Still the blank sheet's 10 HP: work them out.
      if (!levelUp && Number(data.hp?.max) === 10 && Number(data.hp?.current) === 10) setInclude(i => ({ ...i, hp: true }));
    }).catch(() => { if (live) setError('Could not load the SRD. Check your connection.'); });
    return () => { live = false; };
  }, [edition]); // eslint-disable-line react-hooks/exhaustive-deps

  // Levelling up works on the sheet as it will be: one level higher.
  const target = useMemo(() => {
    if (!levelUp) return data;
    const t = JSON.parse(JSON.stringify(data));
    t.classes[levelUp.index].level = Math.min(20, (Number(t.classes[levelUp.index].level) || 1) + 1);
    return t;
  }, [data, levelUp]);

  const choices = { include, subclasses, speciesId, subspeciesId, backgroundId, applyBonuses, skills, equipment,
    ...(levelUp ? { onlyLevel: { [levelUp.index]: target.classes[levelUp.index].level } } : {}) };
  const plan = useMemo(() => (srd ? planFill(target, srd, choices) : null), [srd, target, JSON.stringify(choices)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div style={{ color: 'var(--accent-orange)' }}>{error} <button type="button" onClick={onClose} style={btn()}>Back</button></div>;
  if (!srd || !plan) return <div style={{ color: 'var(--text-dim)' }}>Loading the SRD…</div>;

  const firstClass = srd.classes.find(c => c.id === classIdOf(data.classes?.[0]?.name));
  const species = srd.species.find(x => x.id === speciesId);
  const background = srd.backgrounds.find(x => x.id === backgroundId);
  const hpGain = levelUp ? (() => {
    const cls = srd.classes.find(c => c.id === classIdOf(data.classes[levelUp.index].name));
    return cls ? levelUpHp(cls.hitDie, data.abilities?.con) : 0;
  })() : 0;

  const apply = () => {
    change((s) => {
      if (levelUp) {
        const row = s.classes[levelUp.index];
        if (row) row.level = Math.min(20, (Number(row.level) || 1) + 1);
        if (hpMode === 'average' && hpGain) s.hp = { ...s.hp, max: (Number(s.hp?.max) || 0) + hpGain, current: (Number(s.hp?.current) || 0) + hpGain };
      }
      undoRef.current = { fill: applyFill(s, plan), levelUp: levelUp ? { index: levelUp.index, hp: hpMode === 'average' ? hpGain : 0 } : null };
    }, { now: true });
    setDone({ features: plan.features.length, resources: plan.resources.length, items: plan.items.length, gp: plan.gp, skills: plan.skills.length });
  };
  const undo = () => {
    const u = undoRef.current;
    if (!u) return;
    change((s) => {
      undoFill(s, u.fill);
      if (u.levelUp) {
        const row = s.classes[u.levelUp.index];
        if (row) row.level = Math.max(1, (Number(row.level) || 1) - 1);
        if (u.levelUp.hp) s.hp = { ...s.hp, max: Math.max(0, (Number(s.hp?.max) || 0) - u.levelUp.hp), current: Math.max(0, (Number(s.hp?.current) || 0) - u.levelUp.hp) };
      }
    }, { now: true });
    undoRef.current = null;
    setDone({ undone: true });
  };

  if (done) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ ...box, color: done.undone ? 'var(--text-secondary)' : 'var(--accent-green)' }}>
          {done.undone ? 'Taken back out.' : `Added ${[
            done.features && `${done.features} feature${done.features === 1 ? '' : 's'}`,
            done.resources && `${done.resources} resource${done.resources === 1 ? '' : 's'}`,
            done.skills && `${done.skills} skill${done.skills === 1 ? '' : 's'}`,
            done.items && `${done.items} item${done.items === 1 ? '' : 's'}`,
            done.gp && `${done.gp} GP`,
          ].filter(Boolean).join(', ') || 'nothing new'}.`}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {!done.undone && <button type="button" onClick={undo} style={btn()}>Undo</button>}
          <button type="button" onClick={onClose} style={btn(true)}>Done</button>
        </div>
      </div>
    );
  }

  const check = (key, label) => (
    <label style={{ ...sectionTitle, display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!include[key]} onChange={(e) => setInclude(i => ({ ...i, [key]: e.target.checked }))} />{label}
    </label>
  );
  const muted = { color: 'var(--text-dim)', fontSize: '0.72rem' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button type="button" onClick={onClose} style={btn()} aria-label="Back">◀</button>
        <span style={{ color: 'var(--accent-purple)', flex: 1 }}>
          {levelUp ? `Level up: ${data.classes[levelUp.index].name} ${target.classes[levelUp.index].level}` : 'Fill from the SRD'}
        </span>
        <span style={muted}>{edition} rules</span>
      </div>

      {levelUp && (
        <div style={{ ...box, display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>Hit points</span>
          <select aria-label="Hit points" value={hpMode} onChange={(e) => setHpMode(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
            <option value="average">+{hpGain} (the fixed value)</option>
            <option value="none">I'll roll and add them myself</option>
          </select>
        </div>
      )}

      {check('features', levelUp ? 'NEW FEATURES' : 'CLASS FEATURES')}
      {include.features && (data.classes || []).map((row, i) => {
        if (levelUp && i !== levelUp.index) return null;
        const cls = srd.classes.find(c => c.id === classIdOf(row.name));
        if (!cls) return <div key={i} style={muted}>{row.name}: not in the SRD.</div>;
        const lvl = target.classes[i].level;
        const matched = matchSubclass(cls, row.subclass);
        const needsChoice = lvl >= subclassFirstLevel(cls) && !matched;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {needsChoice && cls.subclasses.length > 0 && (
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>{cls.name} subclass</span>
                <select aria-label={`${cls.name} subclass`} value={subclasses[i] ?? ''} onChange={(e) => setSubclasses(x => ({ ...x, [i]: e.target.value }))} style={{ ...inputStyle, width: 'auto' }}>
                  <option value="">Not chosen yet (or not in the SRD)</option>
                  {cls.subclasses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
          </div>
        );
      })}
      {include.features && (
        <div style={muted}>
          {plan.features.filter(f => !f.key.startsWith('trait:') && !f.key.startsWith('bg:')).map(f => `${f.name} (${f.source})`).join(' · ') || 'Nothing new.'}
        </div>
      )}

      {check('resources', 'LIMITED-USE FEATURES AS RESOURCES')}
      {include.resources && (
        <div style={muted}>{plan.resources.map(r => `${r.name}: ${r.max} per ${RESET[r.reset]}${r.note ? ` (${r.note})` : ''}`).join(' · ') || 'None at this level.'}</div>
      )}

      {!levelUp && (
        <>
          {check('hp', 'HIT POINTS')}
          {include.hp && <div style={muted}>{plan.hpMax ? `Maximum ${plan.hpMax}: the whole hit die at level 1, the fixed value after, plus Constitution each level.` : 'Every class has to be one from the SRD.'}</div>}
        </>
      )}

      {!levelUp && firstClass?.skills && (
        <>
          {check('skills', `CLASS SKILLS (choose ${firstClass.skills.choose})`)}
          {include.skills && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
              {firstClass.skills.from.map(k => {
                const on = skills.includes(k); const had = Number(data.skills?.[k]) > 0;
                return (
                  <label key={k} style={{ display: 'flex', gap: '4px', alignItems: 'center', color: had ? 'var(--text-dim)' : 'var(--text-primary)' }}>
                    <input type="checkbox" disabled={had || (!on && skills.length >= firstClass.skills.choose)} checked={on || had}
                      onChange={(e) => setSkills(x => (e.target.checked ? [...x, k] : x.filter(y => y !== k)))} />
                    {SKILL_NAME[k] || k}
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}

      {!levelUp && (
        <>
          {check('species', edition === '2014' ? 'RACE' : 'SPECIES')}
          {include.species && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select aria-label="Species" value={speciesId} onChange={(e) => { setSpeciesId(e.target.value); setSubspeciesId(''); }} style={{ ...inputStyle, width: 'auto' }}>
                <option value="">Choose…</option>
                {srd.species.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              {species?.subspecies.length > 0 && (
                <select aria-label="Subspecies" value={subspeciesId} onChange={(e) => setSubspeciesId(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                  <option value="">{edition === '2014' ? 'Subrace…' : 'Lineage…'}</option>
                  {species.subspecies.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
              {species && (species.abilityBonuses || species.subspecies.find(x => x.id === subspeciesId)?.abilityBonuses) && (
                <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  <input type="checkbox" checked={applyBonuses} onChange={(e) => setApplyBonuses(e.target.checked)} />
                  Add {[species.abilityBonuses, species.subspecies.find(x => x.id === subspeciesId)?.abilityBonuses].filter(Boolean).join(', ')} to the scores
                </label>
              )}
              {species && <span style={muted}>Speed {species.speed} ft. · {species.size} · {plan.features.filter(f => f.key.startsWith('trait:')).map(f => f.name).join(', ') || 'traits already on the sheet'}</span>}
            </div>
          )}

          {check('background', 'BACKGROUND')}
          {include.background && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <select aria-label="Background" value={backgroundId} onChange={(e) => setBackgroundId(e.target.value)} style={{ ...inputStyle, width: 'auto' }}>
                <option value="">Choose…</option>
                {srd.backgrounds.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              {background && (
                <span style={muted}>
                  Skills: {background.skills.map(k => SKILL_NAME[k] || k).join(', ')}
                  {background.tools.length ? ` · Tools: ${background.tools.join(', ')}` : ''}
                  {background.feature ? ` · ${srd.featureNames[background.feature] || ''}${background.featNote ? ` (${background.featNote})` : ''}` : ''}
                  {background.abilityScores.length ? ` · Raise ${background.abilityScores.map(a => a.toUpperCase()).join(', ')} by +2/+1 or +1/+1/+1 yourself` : ''}
                </span>
              )}
            </div>
          )}

          {check('equipment', 'STARTING EQUIPMENT')}
          {include.equipment && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <EquipmentChoices title={firstClass?.name} eq={firstClass?.equipment} value={equipment.class} onChange={(v) => setEquipment(e => ({ ...e, class: v }))} />
              {include.background && background && (
                <EquipmentChoices title={background.name} eq={background.equipment} value={equipment.background} onChange={(v) => setEquipment(e => ({ ...e, background: v }))} />
              )}
              <div style={muted}>{plan.items.length} items{plan.gp ? ` and ${plan.gp} GP` : ''}; packs are unpacked so their weight counts.</div>
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
        <button type="button" onClick={apply} style={btn(true)}>{levelUp ? `Level up to ${target.classes[levelUp.index].level}` : 'Add to the sheet'}</button>
        <button type="button" onClick={onClose} style={btn()}>Cancel</button>
      </div>
      <div style={{ ...labelStyle, marginTop: '8px', textTransform: 'none', letterSpacing: 0 }}>
        Only adds: nothing you wrote is replaced. You can undo it straight after.
      </div>
    </div>
  );
}

/** Choose between starting-equipment options, and an item for "any martial weapon". */
function EquipmentChoices({ title, eq, value = [], onChange }) {
  if (!eq || (!eq.fixed?.length && !eq.groups?.length)) return null;
  const set = (gi, next) => { const v = [...value]; v[gi] = { ...(v[gi] || { alt: 0, picks: [] }), ...next }; onChange(v); };
  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ color: 'var(--text-secondary)' }}>{title}</div>
      {eq.fixed?.length > 0 && <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>Always: {eq.fixed.map(i => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)).join(', ')}</div>}
      {eq.groups.map((g, gi) => {
        const cur = value[gi] || { alt: 0, picks: [] };
        const alt = g.alternatives[cur.alt] || g.alternatives[0];
        return (
          <div key={gi} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {g.alternatives.length > 1 ? (
              <select aria-label={`${title} equipment choice ${gi + 1}`} value={cur.alt} onChange={(e) => set(gi, { alt: Number(e.target.value), picks: [] })} style={inputStyle}>
                {g.alternatives.map((a, ai) => <option key={ai} value={ai}>{a.label}</option>)}
              </select>
            ) : <div style={{ fontSize: '0.75rem' }}>{alt.label}</div>}
            {alt.picks.map((p, pi) => (
              <select key={pi} aria-label={`Choose ${p.name}`} value={cur.picks?.[pi] || ''} onChange={(e) => { const picks = [...(cur.picks || [])]; picks[pi] = e.target.value; set(gi, { picks }); }} style={inputStyle}>
                <option value="">Choose from {p.name.toLowerCase()}…</option>
                {p.items.map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
            ))}
          </div>
        );
      })}
    </div>
  );
}

