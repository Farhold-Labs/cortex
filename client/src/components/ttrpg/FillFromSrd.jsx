import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadCharacterSrd } from '../../srd/index.js';
import { SKILLS } from '../../ttrpg/dnd5e2024.js';
import { planFill, applyFill, undoFill, matchSubclass, subclassFirstLevel, levelUpHp, featOptions, asiChoiceValid, applyAsiChoice, multiclassCheck } from '../../ttrpg/fill.js';
import { ABILITIES } from '../../ttrpg/dnd5e2024.js';
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
const muted = { color: 'var(--text-dim)', fontSize: '0.72rem' };

export default function FillFromSrd({ data, edition, change, onClose, levelUp: levelUpProp = null, asiFor = null, addClass = false }) {
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
  const [asi, setAsi] = useState({}); // choices for Ability Score Improvements and Epic Boons, by feature key
  const [mcSkills, setMcSkills] = useState({});
  const [newClass, setNewClass] = useState('');
  const undoRef = useRef(null);
  // Adding a class (multiclassing, v2.164.0) is a level-up of a new row at level 1.
  const levelUp = addClass ? (newClass ? { index: (data.classes || []).length, add: true } : null) : levelUpProp;

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
    if (levelUp.add) t.classes.push({ name: srd?.classes.find(c => c.id === newClass)?.name || newClass, level: 1, subclass: '' });
    else t.classes[levelUp.index].level = Math.min(20, (Number(t.classes[levelUp.index].level) || 1) + 1);
    return t;
  }, [data, levelUp?.index, levelUp?.add, newClass, srd]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = { include: levelUp?.add ? { features: true, resources: true, skills: true } : include, subclasses, speciesId, subspeciesId, backgroundId, applyBonuses, skills, equipment, asi, mcSkills,
    ...(levelUp ? { onlyLevel: { [levelUp.index]: target.classes[levelUp.index].level } } : {}) };
  const plan = useMemo(() => (srd ? planFill(target, srd, choices) : null), [srd, target, JSON.stringify(choices)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div style={{ color: 'var(--accent-orange)' }}>{error} <button type="button" onClick={onClose} style={btn()}>Back</button></div>;
  if (!srd) return <div style={{ color: 'var(--text-dim)' }}>Loading the SRD…</div>;
  const level = (target.classes || []).reduce((n, c) => n + (Number(c.level) || 0), 0);

  // Choosing for an Ability Score Improvement already on the sheet.
  if (asiFor) {
    const entry = (data.featureList || []).find(f => f.id === asiFor);
    if (!entry) return <div style={{ color: 'var(--text-dim)' }}>That feature is gone. <button type="button" onClick={onClose} style={btn()}>Back</button></div>;
    const kind = /epic-boon/.test(entry.srd) ? 'boon' : 'asi';
    const c = asi[entry.key];
    if (done) return <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}><div style={{ ...box, color: 'var(--accent-green)' }}>{entry.name}: {done.label}</div><button type="button" onClick={onClose} style={{ ...btn(true), alignSelf: 'flex-start' }}>Done</button></div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button type="button" onClick={onClose} style={btn()} aria-label="Back">◀</button>
          <span style={{ color: 'var(--accent-purple)' }}>{entry.name} ({entry.source})</span>
        </div>
        <AsiChooser kind={kind} edition={edition} feats={featOptions(srd.feats, data, kind, level)} abilities={data.abilities} choice={c} onChange={(v) => setAsi(a => ({ ...a, [entry.key]: v }))} />
        <div style={{ display: 'flex', gap: '6px' }}>
          <button type="button" disabled={!asiChoiceValid(c, srd.feats)} onClick={() => {
            change((s) => { applyAsiChoice(s, entry.id, c, srd.feats); }, { now: true });
            setDone({ label: c.mode === 'feat' ? srd.feats.find(f => f.id === c.feat)?.name : c.mode === 'plus2' ? `+2 ${c.a.toUpperCase()}` : `+1 ${c.a.toUpperCase()}, +1 ${c.b.toUpperCase()}` });
          }} style={btn(true)}>Apply</button>
          <button type="button" onClick={onClose} style={btn()}>Cancel</button>
        </div>
      </div>
    );
  }

  // Adding a class: choose which first.
  if (addClass && !newClass) {
    const have = new Set((data.classes || []).map(c => String(c.name).toLowerCase()));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.8rem' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button type="button" onClick={onClose} style={btn()} aria-label="Back">◀</button>
          <span style={{ color: 'var(--accent-purple)' }}>Add a class (multiclass)</span>
        </div>
        {srd.classes.filter(c => !have.has(c.id)).map(c => {
          const problems = multiclassCheck(data, srd, c.id);
          return (
            <button key={c.id} type="button" onClick={() => setNewClass(c.id)} style={{ ...box, textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
              {c.name} <span style={{ color: problems.length ? 'var(--accent-orange)' : 'var(--text-dim)', fontSize: '0.7rem' }}>{problems.length ? problems.join('; ') : `d${c.hitDie}`}</span>
            </button>
          );
        })}
        <div style={muted}>The rules need the scores shown, for the new class and the ones you have; you can still add one without them.</div>
      </div>
    );
  }
  if (!plan) return <div style={{ color: 'var(--text-dim)' }}>Loading the SRD…</div>;

  const firstClass = srd.classes.find(c => c.id === classIdOf(data.classes?.[0]?.name));
  const species = srd.species.find(x => x.id === speciesId);
  const background = srd.backgrounds.find(x => x.id === backgroundId);
  const hpGain = levelUp ? (() => {
    const cls = srd.classes.find(c => c.id === classIdOf(target.classes[levelUp.index].name));
    return cls ? levelUpHp(cls.hitDie, data.abilities?.con) : 0;
  })() : 0;

  const apply = () => {
    change((s) => {
      if (levelUp?.add) s.classes = [...(s.classes || []), { name: target.classes[levelUp.index].name, level: 1, subclass: '' }];
      else if (levelUp) {
        const row = s.classes[levelUp.index];
        if (row) row.level = Math.min(20, (Number(row.level) || 1) + 1);
      }
      if (levelUp) {
        if (hpMode === 'average' && hpGain) s.hp = { ...s.hp, max: (Number(s.hp?.max) || 0) + hpGain, current: (Number(s.hp?.current) || 0) + hpGain };
      }
      undoRef.current = { fill: applyFill(s, plan), levelUp: levelUp ? { index: levelUp.index, add: !!levelUp.add, hp: hpMode === 'average' ? hpGain : 0 } : null };
    }, { now: true });
    setDone({ features: plan.features.length, resources: plan.resources.length, items: plan.items.length, gp: plan.gp, skills: plan.skills.length });
  };
  const undo = () => {
    const u = undoRef.current;
    if (!u) return;
    change((s) => {
      undoFill(s, u.fill);
      if (u.levelUp?.add) s.classes = s.classes.filter((_, i) => i !== u.levelUp.index);
      else if (u.levelUp) {
        const row = s.classes[u.levelUp.index];
        if (row) row.level = Math.max(1, (Number(row.level) || 1) - 1);
      }
      if (u.levelUp) {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.8rem' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button type="button" onClick={onClose} style={btn()} aria-label="Back">◀</button>
        <span style={{ color: 'var(--accent-purple)', flex: 1 }}>
          {levelUp?.add ? `Add ${target.classes[levelUp.index].name} 1` : levelUp ? `Level up: ${data.classes[levelUp.index].name} ${target.classes[levelUp.index].level}` : 'Fill from the SRD'}
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
      {(include.features || levelUp) && (
        <div style={muted}>
          {plan.features.filter(f => !f.key.startsWith('trait:') && !f.key.startsWith('bg:')).map(f => `${f.name} (${f.source})`).join(' · ') || 'Nothing new.'}
        </div>
      )}
      {(include.features || levelUp) && plan.asi.map(a => (
        <div key={a.key} style={{ ...box, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span>{a.kind === 'boon' ? 'Epic Boon' : 'Ability Score Improvement'} ({a.source}) <span style={muted}>choose now, or later from the Features tab</span></span>
          <AsiChooser kind={a.kind} edition={edition} feats={featOptions(srd.feats, target, a.kind, level)} abilities={target.abilities} choice={asi[a.key]} onChange={(v) => setAsi(x => ({ ...x, [a.key]: v }))} />
        </div>
      ))}
      {levelUp?.add && (() => {
        const cls = srd.classes.find(c => c.id === newClass);
        const problems = multiclassCheck(data, srd, newClass);
        return (
          <>
            {problems.length > 0 && <div style={{ ...box, color: 'var(--accent-orange)' }}>Multiclassing needs: {problems.join('; ')}.</div>}
            {cls?.multiclass?.proficiencies?.length > 0 && <div style={muted}>You gain: {cls.multiclass.proficiencies.join(', ')}</div>}
            {cls?.multiclass?.skills && (
              <McSkillPicker cls={cls} data={data} value={mcSkills[levelUp.index] || []} onChange={(v) => setMcSkills(x => ({ ...x, [levelUp.index]: v }))} />
            )}
          </>
        );
      })()}

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

      {!levelUp && include.skills && (data.classes || []).slice(1).map((row, j) => {
        const i = j + 1;
        const cls = srd.classes.find(c => c.id === classIdOf(row.name));
        return cls?.multiclass?.skills ? <McSkillPicker key={i} cls={cls} data={data} value={mcSkills[i] || []} onChange={(v) => setMcSkills(x => ({ ...x, [i]: v }))} /> : null;
      })}
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
        <button type="button" onClick={apply} style={btn(true)}>{levelUp?.add ? `Add ${target.classes[levelUp.index].name}` : levelUp ? `Level up to ${target.classes[levelUp.index].level}` : 'Add to the sheet'}</button>
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


/** The skill a multiclass gives (Bard, Ranger, Rogue): choose as many as it allows. */
function McSkillPicker({ cls, data, value, onChange }) {
  const n = cls.multiclass.skills.choose;
  return (
    <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '0.75rem' }}>{cls.name} (multiclass): choose {n} skill{n === 1 ? '' : 's'}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
        {cls.multiclass.skills.from.map(k => {
          const on = value.includes(k); const had = Number(data.skills?.[k]) > 0;
          return (
            <label key={k} style={{ display: 'flex', gap: '4px', alignItems: 'center', color: had ? 'var(--text-dim)' : 'var(--text-primary)', fontSize: '0.75rem' }}>
              <input type="checkbox" aria-label={`${cls.name} skill ${SKILL_NAME[k] || k}`} disabled={had || (!on && value.length >= n)} checked={on || had}
                onChange={(e) => onChange(e.target.checked ? [...value, k] : value.filter(y => y !== k))} />
              {SKILL_NAME[k] || k}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/**
 * An Ability Score Improvement: +2 to one score, +1 to two, or a feat the
 * character qualifies for. An Epic Boon (2024): a boon or another feat.
 * Scores stop at 20 (a feat may say otherwise).
 */
export function AsiChooser({ kind, feats, abilities, choice, onChange }) {
  const c = choice || { mode: kind === 'boon' ? 'feat' : '' };
  const set = (patch) => onChange({ ...c, ...patch });
  const score = (k) => Number(abilities?.[k]) || 10;
  const abilitySelect = (key, label, exclude, max = 20) => (
    <select aria-label={label} value={c[key] || ''} onChange={(e) => set({ [key]: e.target.value })} style={{ ...inputStyle, width: 'auto' }}>
      <option value="">{label}…</option>
      {ABILITIES.filter(a => a.key !== exclude).map(a => <option key={a.key} value={a.key} disabled={score(a.key) >= max}>{a.short} ({score(a.key)})</option>)}
    </select>
  );
  const feat = feats.find(f => f.id === c.feat);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {kind !== 'boon' && <button type="button" aria-pressed={c.mode === 'plus2'} onClick={() => set({ mode: 'plus2' })} style={{ ...btn(c.mode === 'plus2'), minHeight: '30px' }}>+2 to one</button>}
        {kind !== 'boon' && <button type="button" aria-pressed={c.mode === 'plus1x2'} onClick={() => set({ mode: 'plus1x2' })} style={{ ...btn(c.mode === 'plus1x2'), minHeight: '30px' }}>+1 to two</button>}
        {feats.length > 0 && <button type="button" aria-pressed={c.mode === 'feat'} onClick={() => set({ mode: 'feat' })} style={{ ...btn(c.mode === 'feat'), minHeight: '30px' }}>{kind === 'boon' ? 'Boon or feat' : 'A feat'}</button>}
      </div>
      {c.mode === 'plus2' && abilitySelect('a', 'Score')}
      {c.mode === 'plus1x2' && <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>{abilitySelect('a', 'First', c.b)}{abilitySelect('b', 'Second', c.a)}</div>}
      {c.mode === 'feat' && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <select aria-label="Feat" value={c.feat || ''} onChange={(e) => set({ feat: e.target.value, featAbility: '' })} style={{ ...inputStyle, width: 'auto' }}>
            <option value="">Choose a feat…</option>
            {feats.filter(f => f.id !== 'feat-ability-score-improvement').map(f => (
              <option key={f.id} value={f.id} disabled={!f.meetsScores}>
                {f.name}{f.meetsScores ? '' : ` (needs ${f.scores.map(p => `${p.ability.toUpperCase()} ${p.min}`).join(', ')})`}
              </option>
            ))}
          </select>
          {feat?.increase?.from && (
            <select aria-label="Score the feat raises" value={c.featAbility || ''} onChange={(e) => set({ featAbility: e.target.value })} style={{ ...inputStyle, width: 'auto' }}>
              <option value="">+{feat.increase.by} to…</option>
              {feat.increase.from.map(k => <option key={k} value={k} disabled={score(k) >= feat.increase.max}>{k.toUpperCase()} ({score(k)})</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
