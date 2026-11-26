import React, { useMemo, useState } from 'react';
import {
  ABILITIES, SKILLS, CLASSES, CONDITIONS, editionInfo,
  derive, signed, d20Roll, attackBonus, damageRoll, applyHp, shortRest, longRest, newId, cantripDice,
} from '../../ttrpg/dnd5e2024.js';
import { editionOf, findSrd, srdFeatureText } from '../../srd/index.js';
import { SrdPicker, SrdEntry } from './SrdBrowser.jsx';
import FillFromSrd from './FillFromSrd.jsx';
import { asiKind } from '../../ttrpg/fill.js';
import { btn, rollBtn, labelStyle, inputStyle, box, sectionTitle, Field, Counter, Pips, ListRows } from './sheetUi.jsx';

/**
 * A D&D 5e character sheet (v2.159.0; the 2014 rules too since v2.160.0). Numbers that follow from others
 * (modifiers, saves, skills, spell DC, slots) are worked out here; every roll
 * goes to the server as finished dice, with the label in the ping.
 */

const TABS = [
  ['main', 'Abilities'], ['actions', 'Actions'], ['spells', 'Spells'], ['gear', 'Gear'], ['features', 'Features'], ['about', 'About'],
];

export default function Dnd5eSheet({ data, canEdit, change, roll, isMobile }) {
  const d = useMemo(() => derive(data), [data]);
  const [tab, setTab] = useState('main');
  const [mode, setMode] = useState('normal'); // the next d20 roll: normal, adv, dis
  const [amount, setAmount] = useState('');
  const [picker, setPicker] = useState(null); // an SRD list to pick from: 'spells' | 'equipment' | 'magic-items'
  const [fill, setFill] = useState(null); // fill from the SRD: { levelUp: { index } | null } (v2.163.0)
  const edition = editionOf(data.system);
  const name = data.name || 'Unnamed';

  // Taking something from the SRD (v2.161.0): a copy of what a sheet needs,
  // and the SRD id, so its full text can be shown without storing it.
  const spellEntry = (x) => ({
    id: newId(), name: x.name, level: x.level, prepared: true, concentration: x.concentration, ritual: x.ritual,
    damage: x.damage || x.heal || '', scales: x.scales || null, attack: x.attack || null, save: x.save || null,
    notes: [x.time, x.range, x.duration].filter(Boolean).join(' · '), srd: x.id,
  });
  // Several spells at once (v2.163.0), from the class's list up to the highest slot level.
  const [classSpellsOnly, setClassSpellsOnly] = useState(true);
  const casterNames = (data.classes || []).map(c => c.name);
  const maxSpellLevel = Math.max(0, ...d.slotsMax.map((n, i) => (n > 0 ? i + 1 : 0)), d.pact?.level || 0);
  const spellFilter = (x) => !classSpellsOnly || (x.classes.some(c => casterNames.includes(c)) && x.level <= maxSpellLevel);
  const takenSpells = new Set((data.spells || []).map(sp => sp.srd).filter(Boolean));
  const pick = (x) => {
    if (picker === 'spells') {
      now(s => { s.spells = [...(s.spells || []), spellEntry(x)]; });
    } else if (picker === 'equipment') {
      now(s => {
        s.inventory = [...(s.inventory || []), {
          id: newId(), name: x.name, qty: 1, weight: Number(x.weight) || 0, equipped: false, srd: x.id,
          notes: [x.cost, x.damage && `${x.damage} ${x.damageType}`.trim(), x.ac && `AC ${x.ac}`, x.properties.join(', ')].filter(Boolean).join(' · '),
        }];
        if (x.weapon && x.damage) {
          // Finesse uses the better of Strength and Dexterity; ranged weapons Dexterity.
          const dd = derive(s);
          const ability = x.finesse ? (dd.mods.dex >= dd.mods.str ? 'dex' : 'str') : x.ranged ? 'dex' : 'str';
          s.attacks = [...(s.attacks || []), {
            id: newId(), name: x.name, ability, proficient: true, bonus: 0, damage: x.damage, damageType: (x.damageType || '').toLowerCase(),
            damageAbility: true, damageBonus: 0, notes: [x.properties.join(', '), x.range, x.mastery && `Mastery: ${x.mastery}`, x.versatile && `Two-handed ${x.versatile}`].filter(Boolean).join(' · '),
          }];
        }
      });
    } else if (picker === 'magic-items') {
      now(s => { s.inventory = [...(s.inventory || []), {
        id: newId(), name: x.name, qty: 1, weight: 0, equipped: false, srd: `mi:${x.id}`,
        notes: [x.rarity, x.attunement ? 'requires attunement' : ''].filter(Boolean).join(' · '),
      }]; });
    }
    setPicker(null);
  };

  // A d20 Test uses the mode once, then goes back to normal.
  const test = (bonus, what) => { const m = mode; setMode('normal'); return roll(d20Roll(bonus, d, m), `${name}: ${what}${m === 'adv' ? ' (advantage)' : m === 'dis' ? ' (disadvantage)' : ''}`); };
  const set = (fn) => change(fn);
  const now = (fn) => change(fn, { now: true });

  const hp = data.hp || { max: 0, current: 0, temp: 0 };
  const hpColor = hp.current === 0 ? 'var(--accent-orange)' : hp.current <= hp.max / 2 ? 'var(--accent-amber)' : 'var(--accent-green)';
  const n = Math.floor(Number(amount));

  const deathSave = async () => {
    const r = await test(0, 'Death saving throw');
    if (!r || r.hidden) return;
    const face = r.terms?.find(t => t.type === 'dice')?.dice?.find(x => x.kept)?.value;
    now((s) => {
      const ds = { successes: 0, failures: 0, ...s.deathSaves };
      if (face === 20) { s.hp = { ...s.hp, current: 1 }; s.deathSaves = { successes: 0, failures: 0 }; return; }
      if (face === 1) ds.failures = Math.min(3, ds.failures + 2);
      else if (r.total >= 10) ds.successes = Math.min(3, ds.successes + 1);
      else ds.failures = Math.min(3, ds.failures + 1);
      s.deathSaves = ds;
    });
  };

  const spendHitDie = async (die) => {
    const r = await roll(`1${die}${d.mods.con ? signed(d.mods.con) : ''}`, `${name}: Hit Point Die`);
    if (!r || r.hidden) return;
    now((s) => { s.hitDiceUsed = { ...s.hitDiceUsed, [die]: (Number(s.hitDiceUsed?.[die]) || 0) + 1 }; applyHp(s, Math.max(0, r.total)); });
  };

  const stat = (label, value, onRoll) => (
    <div style={{ ...box, textAlign: 'center', padding: '6px 4px', minWidth: 0 }}>
      <div style={{ ...labelStyle, marginBottom: '2px' }}>{label}</div>
      {onRoll ? <button type="button" onClick={onRoll} style={{ ...rollBtn, width: '100%', fontSize: '1rem' }}>{value}</button>
        : <div style={{ fontSize: '1.05rem', color: 'var(--text-primary)', padding: '4px 0' }}>{value}</div>}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: 'monospace', fontSize: '0.82rem' }}>
      {/* What matters every turn stays on top: HP, AC, initiative, conditions. */}
      <div style={{ ...box, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.6rem', color: hpColor, fontWeight: 700 }} aria-label="Hit points">{hp.current}</span>
          <span style={{ color: 'var(--text-dim)' }}>/ {hp.max} HP</span>
          {hp.temp > 0 && <span style={{ color: 'var(--accent-teal, #5eead4)' }}>+{hp.temp} temp</span>}
          <span style={{ flex: 1 }} />
          {canEdit && (
            <span style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
              <input
                aria-label="Amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                placeholder="0" style={{ ...inputStyle, width: '4.5em' }}
              />
              <button type="button" disabled={!n} onClick={() => { now(s => applyHp(s, -n)); setAmount(''); }} style={{ ...btn(), color: 'var(--accent-orange)' }}>Damage</button>
              <button type="button" disabled={!n} onClick={() => { now(s => applyHp(s, n)); setAmount(''); }} style={{ ...btn(), color: 'var(--accent-green)' }}>Heal</button>
              <button type="button" disabled={!n} onClick={() => { now(s => { s.hp = { ...s.hp, temp: Math.max(Number(s.hp?.temp) || 0, n) }; }); setAmount(''); }} style={btn()}>Temp</button>
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '6px' }}>
          {stat('AC', data.ac)}
          {stat('INIT', signed(d.initiative), () => test(d.initiative, 'Initiative'))}
          {stat('SPEED', `${d.speed}`)}
          {stat('PROF', signed(d.prof))}
          {stat('PASSIVE', d.passivePerception)}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>NEXT d20:</span>
          {[['normal', 'Normal'], ['adv', 'ADV'], ['dis', 'DIS']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} style={{ ...btn(mode === k), minHeight: '30px', padding: '2px 10px' }}>{l}</button>
          ))}
          <span style={{ flex: 1 }} />
          <button type="button" disabled={!canEdit} aria-pressed={!!data.heroicInspiration} onClick={() => now(s => { s.heroicInspiration = !s.heroicInspiration; })}
            style={{ ...btn(!!data.heroicInspiration, 'var(--accent-amber)'), minHeight: '30px', padding: '2px 10px' }}>✦ {d.edition === 2024 ? 'Heroic Inspiration' : 'Inspiration'}</button>
        </div>
        {hp.current === 0 && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--accent-orange)' }}>DEATH SAVES</span>
            <span>✓ <Pips total={3} used={3 - (data.deathSaves?.successes || 0)} color="var(--accent-green)" label="Successes" disabled={!canEdit}
              onChange={(u) => now(s => { s.deathSaves = { ...s.deathSaves, successes: 3 - u }; })} /></span>
            <span>✗ <Pips total={3} used={3 - (data.deathSaves?.failures || 0)} color="var(--accent-orange)" label="Failures" disabled={!canEdit}
              onChange={(u) => now(s => { s.deathSaves = { ...s.deathSaves, failures: 3 - u }; })} /></span>
            {canEdit && <button type="button" onClick={deathSave} style={rollBtn}>Roll death save</button>}
          </div>
        )}
        <Conditions data={data} canEdit={canEdit} now={now} d={d} />
      </div>

      <div role="tablist" style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px' }}>
        {TABS.filter(([k]) => k !== 'spells' || d.hasSpells || canEdit).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} style={{ ...btn(tab === k), flex: '1 0 auto', padding: '6px 7px' }}>{l}</button>
        ))}
      </div>

      {fill && (
        <FillFromSrd data={data} edition={edition} change={change} levelUp={fill.levelUp} asiFor={fill.asiFor} addClass={fill.addClass} onClose={() => setFill(null)} />
      )}

      {!fill && picker && (
        <SrdPicker edition={edition} kind={picker} onClose={() => setPicker(null)} onPick={pick} pickLabel="Add to this sheet"
          {...(picker === 'spells' ? {
            filter: spellFilter, taken: takenSpells,
            onPickMany: (list) => { now(s => { s.spells = [...(s.spells || []), ...list.map(spellEntry)]; }); setPicker(null); },
            extra: (
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={classSpellsOnly} onChange={(e) => setClassSpellsOnly(e.target.checked)} />
                Only {casterNames.join(' / ') || 'my class'} spells up to level {maxSpellLevel} (tick several, then Add)
              </label>
            ),
          } : {})}
          title={{ spells: 'Spells from the SRD', equipment: 'Equipment from the SRD', 'magic-items': 'Magic items from the SRD' }[picker]} />
      )}

      {!fill && !picker && tab === 'main' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, minmax(0, 1fr))' : 'repeat(6, minmax(0, 1fr))', gap: '6px' }}>
            {ABILITIES.map(a => (
              <div key={a.key} style={{ ...box, textAlign: 'center', padding: '6px 4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={labelStyle}>{a.short}</div>
                <button type="button" onClick={() => test(d.mods[a.key], `${a.name} check`)} style={{ ...rollBtn, fontSize: '1.05rem' }} aria-label={`${a.name} check`}>{signed(d.mods[a.key])}</button>
                {canEdit ? <Field type="number" ariaLabel={`${a.name} score`} value={data.abilities?.[a.key]} onChange={(v) => set(s => { s.abilities = { ...s.abilities, [a.key]: Math.max(1, Math.min(30, v)) }; })} style={{ textAlign: 'center', padding: '4px' }} />
                  : <div style={{ color: 'var(--text-dim)' }}>{data.abilities?.[a.key]}</div>}
              </div>
            ))}
          </div>

          <div style={sectionTitle}>SAVING THROWS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '6px' }}>
            {ABILITIES.map(a => (
              <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input type="checkbox" aria-label={`Proficient in ${a.name} saves`} disabled={!canEdit} checked={!!data.saveProf?.[a.key]}
                  onChange={(e) => now(s => { s.saveProf = { ...s.saveProf, [a.key]: e.target.checked }; })} />
                <span style={{ flex: 1 }}>{a.short}</span>
                <button type="button" onClick={() => test(d.saves[a.key], `${a.name} save`)} style={rollBtn}>{signed(d.saves[a.key])}</button>
              </div>
            ))}
          </div>

          <div style={sectionTitle}>SKILLS {canEdit && <span style={{ color: 'var(--text-dim)' }}>(tap the dot: proficient, expertise)</span>}</div>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '4px 12px' }}>
            {SKILLS.map(k => {
              const rank = Number(data.skills?.[k.key]) || 0;
              return (
                <div key={k.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button" disabled={!canEdit} aria-label={`${k.name}: ${['not proficient', 'proficient', 'expertise'][rank]}`}
                    onClick={() => now(s => { s.skills = { ...s.skills, [k.key]: (rank + 1) % 3 }; })}
                    style={{ width: '16px', height: '16px', borderRadius: '50%', padding: 0, cursor: canEdit ? 'pointer' : 'default',
                      border: '1px solid var(--accent-purple)', background: rank ? 'var(--accent-purple)' : 'transparent',
                      boxShadow: rank === 2 ? '0 0 0 2px var(--bg-elevated), 0 0 0 3px var(--accent-purple)' : 'none' }}
                  />
                  <span style={{ flex: 1 }}>{k.name} <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem' }}>{k.ability.toUpperCase()}</span></span>
                  <button type="button" onClick={() => test(d.skills[k.key], k.name)} style={rollBtn}>{signed(d.skills[k.key])}</button>
                </div>
              );
            })}
          </div>
          {canEdit && (
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '8px', color: 'var(--text-dim)' }}>
              <input type="checkbox" checked={!!data.jackOfAllTrades} onChange={(e) => now(s => { s.jackOfAllTrades = e.target.checked; })} />
              Jack of All Trades (half proficiency on other checks)
            </label>
          )}
        </div>
      )}

      {!fill && !picker && tab === 'actions' && (
        <div>
          <ListRows
            items={data.attacks || []} canEdit={canEdit} addLabel="Attack" empty="No attacks yet."
            onAdd={() => now(s => { s.attacks = [...(s.attacks || []), { id: newId(), name: 'Longsword', ability: 'str', proficient: true, bonus: 0, damage: '1d8', damageType: 'slashing', damageAbility: true, damageBonus: 0, notes: '' }]; })}
            onRemove={(i) => now(s => { s.attacks = s.attacks.filter((_, j) => j !== i); })}
            render={(a, i) => <AttackRow a={a} i={i} d={d} canEdit={canEdit} set={set} test={test} roll={roll} name={name} />}
          />
        </div>
      )}

      {!fill && !picker && tab === 'spells' && <Spells data={data} d={d} canEdit={canEdit} set={set} now={now} roll={roll} test={test} name={name} edition={edition} onPick={() => setPicker('spells')} />}

      {!fill && !picker && tab === 'gear' && (
        <div>
          {canEdit && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' }}>
              <button type="button" onClick={() => setPicker('equipment')} style={btn()}>+ Equipment from the SRD</button>
              <button type="button" onClick={() => setPicker('magic-items')} style={btn()}>+ Magic item</button>
            </div>
          )}
          <div style={sectionTitle}>COINS</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '6px' }}>
            {['cp', 'sp', 'ep', 'gp', 'pp'].map(c => (
              <div key={c}>
                <div style={labelStyle}>{c.toUpperCase()}</div>
                <Field type="number" disabled={!canEdit} ariaLabel={c} value={data.currency?.[c] ?? 0} onChange={(v) => set(s => { s.currency = { ...s.currency, [c]: Math.max(0, v) }; })} />
              </div>
            ))}
          </div>
          <div style={sectionTitle}>
            INVENTORY <span style={{ color: 'var(--text-dim)' }}>
              {(data.inventory || []).reduce((w, it) => w + (Number(it.weight) || 0) * (Number(it.qty) || 0), 0)} lb
              {' '}/ carry {(Number(data.abilities?.str) || 0) * 15} lb
            </span>
          </div>
          <ListRows
            items={data.inventory || []} canEdit={canEdit} addLabel="Item" empty="Nothing carried."
            onAdd={() => now(s => { s.inventory = [...(s.inventory || []), { id: newId(), name: '', qty: 1, weight: 0, equipped: false, notes: '' }]; })}
            onRemove={(i) => now(s => { s.inventory = s.inventory.filter((_, j) => j !== i); })}
            render={(it, i) => (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 4em 4.5em auto', gap: '6px', alignItems: 'center' }}>
                <Field disabled={!canEdit} ariaLabel="Item" placeholder="Item" value={it.name} onChange={(v) => set(s => { s.inventory[i].name = v.slice(0, 80); })} />
                <Field type="number" disabled={!canEdit} ariaLabel="Quantity" value={it.qty} onChange={(v) => set(s => { s.inventory[i].qty = Math.max(0, v); })} />
                <Field type="number" disabled={!canEdit} ariaLabel="Weight (lb)" value={it.weight} onChange={(v) => set(s => { s.inventory[i].weight = Math.max(0, v); })} />
                <label style={{ color: 'var(--text-dim)', fontSize: '0.7rem', display: 'flex', gap: '3px', alignItems: 'center' }}>
                  <input type="checkbox" disabled={!canEdit} checked={!!it.equipped} onChange={(e) => now(s => { s.inventory[i].equipped = e.target.checked; })} />EQ
                </label>
                <div style={{ gridColumn: '1 / -1' }}>
                  <Field disabled={!canEdit} ariaLabel="Notes" placeholder="Notes" value={it.notes} onChange={(v) => set(s => { s.inventory[i].notes = v.slice(0, 500); })} />
                </div>
              </div>
            )}
          />
        </div>
      )}

      {!fill && !picker && tab === 'features' && (
        <div>
          <SrdFeatures data={data} canEdit={canEdit} now={now} edition={edition} onFill={() => setFill({ levelUp: null })} onChoose={(id) => setFill({ asiFor: id })} />

          <div style={sectionTitle}>RESOURCES <span style={{ color: 'var(--text-dim)' }}>(Rage, Channel Divinity, Ki…)</span></div>
          <ListRows
            items={data.resources || []} canEdit={canEdit} addLabel="Resource" empty="No limited-use features."
            onAdd={() => now(s => { s.resources = [...(s.resources || []), { id: newId(), name: '', current: 1, max: 1, reset: 'long' }]; })}
            onRemove={(i) => now(s => { s.resources = s.resources.filter((_, j) => j !== i); })}
            render={(r, i) => (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 120px' }}><Field disabled={!canEdit} ariaLabel="Name" placeholder="Name" value={r.name} onChange={(v) => set(s => { s.resources[i].name = v.slice(0, 60); })} /></div>
                <Counter label={r.name || 'Resource'} value={r.current} max={r.max} disabled={!canEdit} onChange={(v) => now(s => { s.resources[i].current = v; })} />
                {r.note && <span style={{ color: 'var(--text-dim)', fontSize: '0.68rem', flexBasis: '100%' }}>{r.note}</span>}
                {canEdit && <>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>max</span>
                  <Field type="number" ariaLabel="Maximum" value={r.max} onChange={(v) => set(s => { s.resources[i].max = Math.max(0, v); })} style={{ width: '4em' }} />
                  <select aria-label="Comes back on" value={r.reset || 'long'} onChange={(e) => now(s => { s.resources[i].reset = e.target.value; })} style={{ ...inputStyle, width: 'auto' }}>
                    <option value="short">short rest</option><option value="long">long rest</option><option value="none">never</option>
                  </select>
                </>}
              </div>
            )}
          />

          <div style={sectionTitle}>HIT POINT DICE</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {Object.entries(d.hitDice).map(([die, total]) => {
              const used = Math.min(total, Number(data.hitDiceUsed?.[die]) || 0);
              return (
                <div key={die} style={{ ...box, display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span>{die}: {total - used} / {total}</span>
                  {canEdit && <button type="button" disabled={used >= total} onClick={() => spendHitDie(die)} style={rollBtn}>Spend</button>}
                </div>
              );
            })}
          </div>

          {canEdit && (
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
              <button type="button" onClick={() => { if (window.confirm('Take a short rest? Pact Magic slots and short-rest features come back.')) now(shortRest); }} style={btn()}>Short rest</button>
              <button type="button" onClick={() => { if (window.confirm(`Take a long rest? Hit points, spell slots and features come back, ${d.edition === 2024 ? 'all' : 'half your'} Hit Point Dice, and one level of Exhaustion goes.`)) now(longRest); }} style={btn()}>Long rest</button>
            </div>
          )}

          <div style={sectionTitle}>FEATURES AND TRAITS</div>
          <Field multiline rows={8} disabled={!canEdit} ariaLabel="Features and traits" value={data.features} onChange={(v) => set(s => { s.features = v.slice(0, 20000); })} />
          <div style={sectionTitle}>PROFICIENCIES AND LANGUAGES</div>
          <Field multiline rows={3} disabled={!canEdit} ariaLabel="Proficiencies and languages" value={data.proficiencies} onChange={(v) => set(s => { s.proficiencies = v.slice(0, 5000); })} />
        </div>
      )}

      {!fill && !picker && tab === 'about' && <About data={data} d={d} canEdit={canEdit} set={set} now={now} isMobile={isMobile}
        onFill={() => setFill({ levelUp: null })} onLevelUp={(index) => setFill({ levelUp: { index } })} onAddClass={() => setFill({ addClass: true })} />}
    </div>
  );
}

function Conditions({ data, canEdit, now, d }) {
  const [adding, setAdding] = useState(false);
  const list = data.conditions || [];
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
      {list.map(c => (
        <button key={c} type="button" disabled={!canEdit} onClick={() => now(s => { s.conditions = (s.conditions || []).filter(x => x !== c); })}
          aria-label={`${c}: remove`} style={{ ...btn(), minHeight: '26px', padding: '1px 8px', color: 'var(--accent-orange)', borderColor: 'var(--accent-orange)' }}>{c}{canEdit ? ' ✕' : ''}</button>
      ))}
      {d.exhaustion > 0 && <span style={{ color: 'var(--accent-orange)', fontSize: '0.75rem' }}>Exhaustion {d.exhaustion}: {d.exhaustionEffects.join('; ')}</span>}
      {canEdit && !adding && <button type="button" onClick={() => setAdding(true)} style={{ ...btn(), minHeight: '26px', padding: '1px 8px' }}>+ Condition</button>}
      {canEdit && adding && (
        <select autoFocus aria-label="Add a condition" value="" onBlur={() => setAdding(false)}
          onChange={(e) => { const c = e.target.value; setAdding(false); if (c) now(s => { s.conditions = [...new Set([...(s.conditions || []), c])]; }); }}
          style={{ ...inputStyle, width: 'auto' }}>
          <option value="">Choose…</option>
          {CONDITIONS.filter(c => !list.includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      {canEdit && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-dim)' }}>
          Exhaustion <Counter label="Exhaustion" value={d.exhaustion} max={6} onChange={(v) => now(s => { s.exhaustion = v; })} />
        </span>
      )}
    </div>
  );
}

function AttackRow({ a, i, d, canEdit, set, test, roll, name }) {
  const [editing, setEditing] = useState(!a.name);
  const bonus = attackBonus(a, d);
  const dmg = damageRoll(a, d);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: '1 1 100px', color: 'var(--text-primary)' }}>{a.name || 'Attack'}</span>
        <button type="button" onClick={() => test(bonus, `${a.name || 'Attack'} attack`)} style={rollBtn}>Hit {signed(bonus)}</button>
        {dmg && <button type="button" onClick={() => roll(dmg, `${name}: ${a.name || 'Attack'} damage${a.damageType ? ` (${a.damageType})` : ''}`)} style={rollBtn}>{dmg}</button>}
        {dmg && <button type="button" onClick={() => roll(damageRoll(a, d, true), `${name}: ${a.name || 'Attack'} critical damage`)} style={{ ...rollBtn, color: 'var(--accent-green)' }}>Crit</button>}
        {canEdit && <button type="button" onClick={() => setEditing(e => !e)} style={{ ...btn(editing), minHeight: '28px', padding: '2px 8px' }}>Edit</button>}
      </div>
      {a.notes && !editing && <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{a.notes}</div>}
      {editing && canEdit && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '6px' }}>
          <div><div style={labelStyle}>NAME</div><Field value={a.name} onChange={(v) => set(s => { s.attacks[i].name = v.slice(0, 60); })} /></div>
          <div><div style={labelStyle}>ABILITY</div>
            <select value={a.ability || 'str'} onChange={(e) => set(s => { s.attacks[i].ability = e.target.value; })} style={inputStyle}>
              {ABILITIES.map(x => <option key={x.key} value={x.key}>{x.short}</option>)}<option value="spell">Spell</option><option value="none">None</option>
            </select></div>
          <div><div style={labelStyle}>PROFICIENT</div><input type="checkbox" checked={!!a.proficient} onChange={(e) => set(s => { s.attacks[i].proficient = e.target.checked; })} /></div>
          <div><div style={labelStyle}>EXTRA TO HIT</div><Field type="number" value={a.bonus} onChange={(v) => set(s => { s.attacks[i].bonus = v; })} /></div>
          <div><div style={labelStyle}>DAMAGE DICE</div><Field value={a.damage} placeholder="1d8" onChange={(v) => set(s => { s.attacks[i].damage = v.replace(/[^0-9dD+\-]/g, '').slice(0, 30); })} /></div>
          <div><div style={labelStyle}>EXTRA DAMAGE</div><Field type="number" value={a.damageBonus} onChange={(v) => set(s => { s.attacks[i].damageBonus = v; })} /></div>
          <div><div style={labelStyle}>TYPE</div><Field value={a.damageType} placeholder="slashing" onChange={(v) => set(s => { s.attacks[i].damageType = v.slice(0, 30); })} /></div>
          <div><div style={labelStyle}>ADD ABILITY TO DAMAGE</div><input type="checkbox" checked={a.damageAbility !== false} onChange={(e) => set(s => { s.attacks[i].damageAbility = e.target.checked; })} /></div>
          <div style={{ gridColumn: '1 / -1' }}><div style={labelStyle}>NOTES</div><Field value={a.notes} placeholder="Range, properties, mastery" onChange={(v) => set(s => { s.attacks[i].notes = v.slice(0, 300); })} /></div>
        </div>
      )}
    </div>
  );
}

function Spells({ data, d, canEdit, set, now, roll, test, name, edition, onPick }) {
  const used = data.spellcasting?.slotsUsed || {};
  const levels = d.slotsMax.map((max, i) => ({ level: i + 1, max })).filter(x => x.max > 0);
  const spells = data.spells || [];
  const [filter, setFilter] = useState('all');
  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>Ability:{' '}
          {canEdit ? (
            <select aria-label="Spellcasting ability" value={data.spellcasting?.ability || 'auto'} onChange={(e) => now(s => { s.spellcasting = { ...s.spellcasting, ability: e.target.value }; })} style={{ ...inputStyle, width: 'auto' }}>
              <option value="auto">From class{d.spellAbility ? ` (${d.spellAbility.toUpperCase()})` : ''}</option>
              {ABILITIES.map(a => <option key={a.key} value={a.key}>{a.short}</option>)}
            </select>
          ) : (d.spellAbility || '—').toUpperCase()}
        </span>
        {d.spellDC != null && <span>Save DC <b style={{ color: 'var(--accent-amber)' }}>{d.spellDC}</b></span>}
        {d.spellAttack != null && <button type="button" onClick={() => test(d.spellAttack, 'Spell attack')} style={rollBtn}>Spell attack {signed(d.spellAttack)}</button>}
      </div>

      <div style={sectionTitle}>SPELL SLOTS</div>
      {!levels.length && !d.pact && <div style={{ color: 'var(--text-dim)' }}>No spell slots at this level.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {levels.map(({ level, max }) => (
          <div key={level} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ width: '4.5em' }}>Level {level}</span>
            <Pips total={max} used={Math.min(max, Number(used[level]) || 0)} label={`Level ${level} slots`} disabled={!canEdit}
              onChange={(u) => now(s => { s.spellcasting = { ...s.spellcasting, slotsUsed: { ...(s.spellcasting?.slotsUsed || {}), [level]: Math.max(0, u) } }; })} />
          </div>
        ))}
        {d.pact && (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <span style={{ width: '4.5em' }}>Pact {d.pact.level}</span>
            <Pips total={d.pact.count} used={Math.min(d.pact.count, Number(data.spellcasting?.pactUsed) || 0)} label="Pact Magic slots" disabled={!canEdit}
              onChange={(u) => now(s => { s.spellcasting = { ...s.spellcasting, pactUsed: Math.max(0, u) }; })} />
          </div>
        )}
      </div>

      <div style={{ ...sectionTitle, display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>SPELLS</span>
        {canEdit && <button type="button" onClick={onPick} style={{ ...btn(), minHeight: '26px', padding: '1px 8px' }}>+ From the SRD</button>}
        {['all', 'prepared'].map(f => <button key={f} type="button" onClick={() => setFilter(f)} style={{ ...btn(filter === f), minHeight: '26px', padding: '1px 8px' }}>{f}</button>)}
      </div>
      <ListRows
        items={spells.filter(sp => filter === 'all' || sp.prepared || Number(sp.level) === 0).slice().sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0))}
        canEdit={canEdit} addLabel="Spell" empty="No spells yet. Add the ones your character knows or has prepared."
        onAdd={() => now(s => { s.spells = [...(s.spells || []), { id: newId(), name: '', level: 1, prepared: true, concentration: false, ritual: false, damage: '', notes: '' }]; })}
        onRemove={(shownIndex) => {
          const shown = spells.filter(sp => filter === 'all' || sp.prepared || Number(sp.level) === 0).slice().sort((a, b) => (Number(a.level) || 0) - (Number(b.level) || 0));
          const id = shown[shownIndex]?.id;
          now(s => { s.spells = s.spells.filter(sp => sp.id !== id); });
        }}
        render={(sp) => <SpellRow sp={sp} d={d} canEdit={canEdit} set={set} now={now} roll={roll} test={test} name={name} edition={edition} />}
      />
    </div>
  );
}

function SpellRow({ sp, d, canEdit, set, now, roll, test, name, edition }) {
  const [editing, setEditing] = useState(!sp.name);
  const [details, setDetails] = useState(null); // the SRD entry, once asked for
  const showDetails = async () => {
    if (details) { setDetails(null); return; }
    setDetails((await findSrd(edition, 'spells', sp.srd).catch(() => null)) || false);
  };
  // A cantrip's dice grow with character level.
  const dice = sp.damage && Number(sp.level) === 0 && sp.scales === 'character' ? cantripDice(sp.damage, d.level) : sp.damage;
  const at = (s) => s.spells.findIndex(x => x.id === sp.id);
  const edit = (fn) => set(s => { const i = at(s); if (i >= 0) fn(s.spells[i]); });
  const level = Number(sp.level) || 0;
  const cast = () => {
    if (level === 0) return;
    // Uses the lowest slot of the spell's level or higher that's left.
    now(s => {
      const dd = derive(s);
      const usedNow = s.spellcasting?.slotsUsed || {};
      for (let l = level; l <= 9; l++) {
        if ((Number(usedNow[l]) || 0) < dd.slotsMax[l - 1]) {
          s.spellcasting = { ...s.spellcasting, slotsUsed: { ...usedNow, [l]: (Number(usedNow[l]) || 0) + 1 } };
          return;
        }
      }
      if (dd.pact && dd.pact.level >= level && (Number(s.spellcasting?.pactUsed) || 0) < dd.pact.count) {
        s.spellcasting = { ...s.spellcasting, pactUsed: (Number(s.spellcasting.pactUsed) || 0) + 1 };
      }
    });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-dim)', width: '2.2em' }}>{level === 0 ? 'C' : level}</span>
        <span style={{ flex: '1 1 100px', color: 'var(--text-primary)' }}>
          {sp.name || 'Spell'}{sp.concentration ? ' ◆' : ''}{sp.ritual ? ' ®' : ''}
        </span>
        {sp.attack && d.spellAttack != null && <button type="button" onClick={() => test(d.spellAttack, `${sp.name || 'Spell'} attack`)} style={rollBtn}>Hit {signed(d.spellAttack)}</button>}
        {sp.save && d.spellDC != null && <span style={{ color: 'var(--accent-amber)', fontSize: '0.72rem' }}>DC {d.spellDC} {sp.save.toUpperCase()}</span>}
        {dice && <button type="button" onClick={() => roll(dice, `${name}: ${sp.name || 'Spell'}`)} style={rollBtn}>{dice}</button>}
        {sp.srd && <button type="button" onClick={showDetails} aria-expanded={!!details} style={{ ...btn(!!details), minHeight: '28px', padding: '2px 8px' }}>Details</button>}
        {canEdit && level > 0 && <button type="button" onClick={cast} style={{ ...btn(), minHeight: '28px', padding: '2px 8px' }}>Cast</button>}
        {canEdit && <button type="button" onClick={() => setEditing(e => !e)} style={{ ...btn(editing), minHeight: '28px', padding: '2px 8px' }}>Edit</button>}
      </div>
      {sp.notes && !editing && <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>{sp.notes}</div>}
      {details && <SrdEntry kind="spells" x={details} />}
      {details === false && <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>Not in the reference.</div>}
      {editing && canEdit && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '6px' }}>
          <div style={{ gridColumn: 'span 2' }}><div style={labelStyle}>NAME</div><Field value={sp.name} onChange={(v) => edit(x => { x.name = v.slice(0, 60); })} /></div>
          <div><div style={labelStyle}>LEVEL (0 = CANTRIP)</div><Field type="number" min={0} max={9} value={sp.level} onChange={(v) => edit(x => { x.level = Math.max(0, Math.min(9, v)); })} /></div>
          <div><div style={labelStyle}>DICE</div><Field value={sp.damage} placeholder="8d6" onChange={(v) => edit(x => { x.damage = v.replace(/[^0-9dD+\-]/g, '').slice(0, 30); })} /></div>
          <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}><input type="checkbox" checked={!!sp.prepared} onChange={(e) => edit(x => { x.prepared = e.target.checked; })} />Prepared</label>
          <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}><input type="checkbox" checked={!!sp.concentration} onChange={(e) => edit(x => { x.concentration = e.target.checked; })} />Concentration</label>
          <label style={{ display: 'flex', gap: '4px', alignItems: 'center' }}><input type="checkbox" checked={!!sp.ritual} onChange={(e) => edit(x => { x.ritual = e.target.checked; })} />Ritual</label>
          <div style={{ gridColumn: '1 / -1' }}><div style={labelStyle}>NOTES</div><Field multiline rows={3} value={sp.notes} placeholder="Range, components, what it does" onChange={(v) => edit(x => { x.notes = v.slice(0, 2000); })} /></div>
        </div>
      )}
    </div>
  );
}

function About({ data, d, canEdit, set, now, isMobile, onFill, onLevelUp, onAddClass }) {
  const ed = editionInfo(data.system);
  const row = (label, key, list) => (
    <div>
      <div style={labelStyle}>{label}</div>
      <Field disabled={!canEdit} value={data[key]} onChange={(v) => set(s => { s[key] = v.slice(0, 60); })} />
      {list && canEdit && <datalist id={`dnd-${key}`}>{list.map(x => <option key={x} value={x} />)}</datalist>}
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: '8px' }}>
        <div style={{ gridColumn: isMobile ? '1 / -1' : 'auto' }}>
          <div style={labelStyle}>NAME</div>
          <Field disabled={!canEdit} value={data.name} onChange={(v) => set(s => { s.name = v.slice(0, 60); })} />
        </div>
        <div>
          <div style={labelStyle}>{ed.speciesLabel}</div>
          <input list="dnd-species" disabled={!canEdit} value={data.species || ''} onChange={(e) => set(s => { s.species = e.target.value.slice(0, 40); })} style={inputStyle} />
          <datalist id="dnd-species">{ed.species.map(x => <option key={x} value={x} />)}</datalist>
        </div>
        <div>
          <div style={labelStyle}>BACKGROUND</div>
          <input list="dnd-backgrounds" disabled={!canEdit} value={data.background || ''} onChange={(e) => set(s => { s.background = e.target.value.slice(0, 40); })} style={inputStyle} />
          <datalist id="dnd-backgrounds">{ed.backgrounds.map(x => <option key={x} value={x} />)}</datalist>
        </div>
        {row('ALIGNMENT', 'alignment')}
        {row('SIZE', 'size')}
      </div>

      {canEdit && (
        <button type="button" onClick={onFill} style={{ ...btn(true), alignSelf: 'flex-start' }}>Fill from the SRD…</button>
      )}
      <div style={sectionTitle}>CLASSES <span style={{ color: 'var(--text-dim)' }}>level {d.level}</span></div>
      <ListRows
        items={data.classes || []} canEdit={canEdit} addLabel="Class (multiclass)" empty="No class."
        onAdd={onAddClass}
        onRemove={(i) => now(s => { s.classes = s.classes.filter((_, j) => j !== i); })}
        render={(c, i) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 4.5em minmax(0, 1fr)', gap: '6px' }}>
            <select disabled={!canEdit} aria-label="Class" value={c.name} onChange={(e) => now(s => {
              s.classes[i].name = e.target.value;
              // The first class sets the saving throws.
              if (i === 0) s.saveProf = Object.fromEntries(ABILITIES.map(a => [a.key, CLASSES[e.target.value].saves.includes(a.key)]));
            })} style={inputStyle}>
              {Object.keys(CLASSES).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <Field type="number" disabled={!canEdit} ariaLabel="Level" min={1} max={20} value={c.level} onChange={(v) => set(s => { s.classes[i].level = Math.max(1, Math.min(20, v)); })} />
            <Field disabled={!canEdit} ariaLabel="Subclass" placeholder="Subclass" value={c.subclass} onChange={(v) => set(s => { s.classes[i].subclass = v.slice(0, 40); })} />
            {canEdit && d.level < 20 && (
              <button type="button" onClick={() => onLevelUp(i)} style={{ ...btn(), gridColumn: '1 / -1', justifySelf: 'start', minHeight: '28px', padding: '2px 10px' }}>Level up {c.name} ▲</button>
            )}
          </div>
        )}
      />

      <div style={sectionTitle}>COMBAT</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: '8px' }}>
        <div><div style={labelStyle}>MAX HP</div><Field type="number" disabled={!canEdit} value={data.hp?.max} onChange={(v) => set(s => { s.hp = { ...s.hp, max: Math.max(0, v), current: Math.min(Number(s.hp?.current) || 0, Math.max(0, v)) }; })} /></div>
        <div><div style={labelStyle}>AC</div><Field type="number" disabled={!canEdit} value={data.ac} onChange={(v) => set(s => { s.ac = Math.max(0, v); })} /></div>
        <div><div style={labelStyle}>SPEED</div><Field type="number" disabled={!canEdit} value={data.speed} onChange={(v) => set(s => { s.speed = Math.max(0, v); })} /></div>
        <div><div style={labelStyle}>EXTRA INIT</div><Field type="number" disabled={!canEdit} value={data.initiativeBonus} onChange={(v) => set(s => { s.initiativeBonus = v; })} /></div>
      </div>
      {canEdit && (
        <>
          <div style={sectionTitle}>SPELL SLOTS BY LEVEL <span style={{ color: 'var(--text-dim)' }}>(blank: from your classes)</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, minmax(0, 1fr))', gap: '4px' }}>
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i}>
                <div style={{ ...labelStyle, textAlign: 'center' }}>{i + 1}</div>
                <input aria-label={`Level ${i + 1} slots`} inputMode="numeric" placeholder={String(d.slotsMax[i])}
                  value={data.spellcasting?.slotsMax?.[i + 1] ?? ''}
                  onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 2); set(s => { s.spellcasting = { ...s.spellcasting, slotsMax: { ...(s.spellcasting?.slotsMax || {}), [i + 1]: v === '' ? null : Number(v) } }; }); }}
                  style={{ ...inputStyle, textAlign: 'center', padding: '4px 2px' }} />
              </div>
            ))}
          </div>
        </>
      )}
      <div style={sectionTitle}>NOTES</div>
      <Field multiline rows={6} disabled={!canEdit} ariaLabel="Notes" value={data.notes} onChange={(v) => set(s => { s.notes = v.slice(0, 20000); })} />
    </div>
  );
}

/** Features and traits added from the SRD (v2.163.0): the text is read from the SRD, not stored in the sheet. */
function SrdFeatures({ data, canEdit, now, edition, onFill, onChoose }) {
  const list = data.featureList || [];
  const [open, setOpen] = useState({});
  const toggle = async (f) => {
    if (open[f.id]) { setOpen(o => ({ ...o, [f.id]: null })); return; }
    const hit = await srdFeatureText(edition, f.srd).catch(() => null);
    setOpen(o => ({ ...o, [f.id]: hit || { text: 'Not in the reference.' } }));
  };
  return (
    <div>
      <div style={{ ...sectionTitle, display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>CLASS, SPECIES AND BACKGROUND FEATURES</span>
        {canEdit && <button type="button" onClick={onFill} style={{ ...btn(), minHeight: '26px', padding: '1px 8px' }}>Fill from the SRD…</button>}
      </div>
      {!list.length && <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>None yet. Fill from the SRD adds your class, species and background features.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {list.map(f => (
          <div key={f.id} style={{ ...box, padding: '6px 8px' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <button type="button" onClick={() => toggle(f)} aria-expanded={!!open[f.id]}
                style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'monospace', padding: 0 }}>
                {open[f.id] ? '▾' : '▸'} {f.name}{f.choice ? `: ${f.choice}` : ''} <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>{f.source}</span>
              </button>
              {canEdit && !f.choice && asiKind(f.srd) && <button type="button" onClick={() => onChoose(f.id)} style={{ ...btn(true), minHeight: '24px', padding: '0 8px' }}>Choose</button>}
              {canEdit && <button type="button" aria-label={`Remove ${f.name}`} onClick={() => now(s => { s.featureList = (s.featureList || []).filter(x => x.id !== f.id); })}
                style={{ ...btn(), minHeight: '24px', padding: '0 6px', color: 'var(--text-dim)' }}>✕</button>}
            </div>
            {open[f.id] && <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', fontSize: '0.75rem', lineHeight: 1.5, marginTop: '6px' }}>{open[f.id].text}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
