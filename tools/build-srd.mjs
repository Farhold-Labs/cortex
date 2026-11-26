#!/usr/bin/env node
/**
 * Build the rules reference (v2.161.0, docs/ttrpg/README.md phase 6) from the
 * 5e-bits SRD data: spells, monsters, equipment, magic items and conditions,
 * and since v2.163.0 classes, features, species, traits and backgrounds
 * for the 2014 rules (SRD 5.1) and the 2024 rules (SRD 5.2), both released by
 * Wizards of the Coast under CC-BY-4.0 (credited on the About page).
 *
 *   node tools/build-srd.mjs <dir with 2014-*.json and 2024-*.json> <commit>
 *
 * The source files are 5e-bits/5e-database src/<edition>/en/5e-SRD-*.json at
 * the commit given, which is written into client/src/srd/SOURCE.md. Output is
 * compact JSON in the shapes Cortex already uses (a monster is a stat block
 * the GM screen can take as it is), loaded by the client on demand.
 */
import fs from 'node:fs';
import path from 'node:path';

const [srcDir, commit] = process.argv.slice(2);
if (!srcDir || !commit) { console.error('usage: build-srd.mjs <source dir> <commit>'); process.exit(2); }
const outRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../client/src/srd');
const read = (edition, name) => JSON.parse(fs.readFileSync(path.join(srcDir, `${edition}-${name}.json`), 'utf8'));
const text = (v) => (Array.isArray(v) ? v.join('\n\n') : (v || '')).replace(/[ \t]+\n/g, '\n').trim();
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const ABIL = { str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha' };
const ABIL_WORDS = { Strength: 'str', Dexterity: 'dex', Constitution: 'con', Intelligence: 'int', Wisdom: 'wis', Charisma: 'cha' };
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

function cr(n) {
  return n === 0.125 ? '1/8' : n === 0.25 ? '1/4' : n === 0.5 ? '1/2' : String(n);
}

function damageDice(list) {
  const dice = [];
  for (const d of list || []) {
    if (d?.damage_dice) dice.push(String(d.damage_dice).replace(/\s+/g, ''));
    else if (d?.from?.options) {
      const first = d.from.options.find(o => o.damage_dice);
      if (first) dice.push(String(first.damage_dice).replace(/\s+/g, ''));
    }
  }
  // Only plain notation the roller takes.
  const joined = dice.join('+');
  return /^[0-9d+-]+$/i.test(joined) && /d/i.test(joined) ? joined : '';
}

function usage(u) {
  if (!u) return '';
  if (u.type === 'per day') return ` (${u.times}/Day)`;
  if (u.type === 'recharge on roll') return ` (Recharge ${u.min_value}${u.min_value < 6 ? '–6' : ''})`;
  if (u.type === 'recharge after rest') return ` (Recharges after a ${(u.rest_types || []).join(' or ')} rest)`;
  return '';
}

function monster(m, edition) {
  const prof = m.proficiencies || [];
  const pick = (prefix) => prof.filter(p => p.proficiency?.name?.startsWith(prefix))
    .map(p => `${p.proficiency.name.slice(prefix.length).trim()} ${signed(p.value)}`).join(', ');
  const senses = Object.entries(m.senses || {}).filter(([k]) => k !== 'passive_perception')
    .map(([k, v]) => `${cap(k.replace(/_/g, ' '))} ${v}`);
  if (m.senses?.passive_perception != null) senses.push(`Passive Perception ${m.senses.passive_perception}`);
  const speed = Object.entries(m.speed || {}).filter(([, v]) => typeof v === 'string')
    .map(([k, v]) => (k === 'walk' ? v : `${cap(k)} ${v}`)).join(', ');
  const ac = (m.armor_class || [])[0] || {};
  const list = (arr, actions = false) => (arr || []).map(a => ({
    name: `${a.name}${usage(a.usage)}`,
    text: text(a.desc),
    ...(actions ? { attack: a.attack_bonus ?? '', damage: damageDice(a.damage) } : {}),
  }));
  const names = (arr) => (arr || []).map(x => (typeof x === 'string' ? x : x?.name)).filter(Boolean).join(', ');
  const defenses = [
    ['Vulnerabilities', names(m.damage_vulnerabilities)], ['Resistances', names(m.damage_resistances)],
    ['Immunities', names(m.damage_immunities)], ['Condition immunities', names(m.condition_immunities)],
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ');
  return {
    id: m.index, schema: 1, srd: `${edition}/${m.index}`, name: m.name, size: m.size,
    type: `${cap(m.type)}${m.subtype ? ` (${m.subtype})` : ''}`, alignment: m.alignment || '',
    ac: ac.value ?? 10, acNote: ac.armor ? names(ac.armor) : (ac.type && ac.type !== 'dex' ? ac.type : ''),
    hp: m.hit_points, hpFormula: String(m.hit_points_roll || m.hit_dice || '').replace(/\s+/g, ''), speed,
    abilities: { str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma },
    saves: pick('Saving Throw:'), skills: pick('Skill:'), defenses, senses: senses.join(', '), languages: m.languages || '',
    cr: cr(m.challenge_rating), xp: m.xp ?? null,
    traits: list(m.special_abilities), actions: list(m.actions, true), bonusActions: list(m.bonus_actions, true),
    reactions: list(m.reactions, true), legendary: list(m.legendary_actions, true),
  };
}

function spell(s, edition) {
  const description = text(s.desc || s.description);
  const dmg = Array.isArray(s.damage) ? s.damage[0] : s.damage;
  const levels = dmg?.damage_at_slot_level || dmg?.damage_at_character_level || null;
  const firstKey = levels ? Object.keys(levels).map(Number).sort((a, b) => a - b)[0] : null;
  const heal = s.heal_at_slot_level ? s.heal_at_slot_level[Object.keys(s.heal_at_slot_level).map(Number).sort((a, b) => a - b)[0]] : null;
  const saveWord = description.match(/\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/);
  // Only dice become roll buttons: a flat "5" (Aid) is text.
  const clean = (d) => (d && /^[0-9d+-]+$/i.test(String(d).replace(/\s+/g, '')) && /d/i.test(d) ? String(d).replace(/\s+/g, '') : '');
  return {
    id: s.index, name: s.name, level: s.level, school: s.school?.name || '',
    classes: (s.classes || []).map(c => c.name), time: s.casting_time, range: s.range,
    components: `${(s.components || []).join(', ')}${s.material ? ` (${s.material.replace(/\.$/, '')})` : ''}`,
    duration: s.duration, concentration: !!s.concentration, ritual: !!s.ritual,
    attack: s.attack_type || null,
    save: s.dc?.dc_type?.index || (saveWord ? ABIL_WORDS[saveWord[1]] : null),
    damage: levels ? clean(levels[firstKey]) : '', damageType: dmg?.damage_type?.name || '',
    scales: dmg?.damage_at_character_level ? 'character' : (dmg?.damage_at_slot_level ? 'slot' : null),
    heal: clean(heal),
    text: description, higher: text(s.higher_level),
  };
}

function cost(c) { return c ? `${c.quantity} ${c.unit}` : ''; }

function equipment(e, edition) {
  // One category, the most specific: "Martial Melee Weapons", "Heavy Armor", "Adventuring Gear".
  const all = (e.equipment_categories || []).map(c => c.name);
  const category = edition === '2014'
    ? (e.category_range ? `${e.category_range} Weapons` : e.armor_category ? (e.armor_category === 'Shield' ? 'Shield' : `${e.armor_category} Armor`)
      : e.gear_category?.name || e.tool_category || e.vehicle_category || e.equipment_category?.name || 'Gear')
    : (all.slice().sort((x, y) => y.length - x.length)[0] || 'Gear');
  const ac = e.armor_class
    ? `${e.armor_class.base}${e.armor_class.dex_bonus ? ` + Dex${e.armor_class.max_bonus ? ` (max ${e.armor_class.max_bonus})` : ''}` : ''}`
    : '';
  // A thrown weapon's range is its throw range; a ranged weapon's its own.
  const r = e.throw_range || (e.range?.long ? e.range : null);
  const range = r ? `${r.normal}/${r.long} ft.` : '';
  return {
    id: e.index, name: e.name,
    category,
    weapon: !!e.damage, armor: !!e.armor_class,
    cost: cost(e.cost), weight: e.weight ?? 0,
    // Dice only; a flat amount (a blowgun's 1) is kept as text.
    damage: /d/i.test(e.damage?.damage_dice || '') ? e.damage.damage_dice : '',
    flatDamage: e.damage?.damage_dice && !/d/i.test(e.damage.damage_dice) ? String(e.damage.damage_dice) : '',
    damageType: e.damage?.damage_type?.name || '', versatile: /d/i.test(e.two_handed_damage?.damage_dice || '') ? e.two_handed_damage.damage_dice : '',
    properties: (e.properties || []).map(p => p.name), mastery: e.mastery?.name || '',
    ranged: e.weapon_range === 'Ranged' || /Ranged/.test(category), range,
    finesse: (e.properties || []).some(p => p.index === 'finesse'),
    ac, strMin: e.str_minimum || 0, stealthDisadvantage: !!e.stealth_disadvantage,
    contents: (e.contents || []).map(c => ({ id: c.item?.index, name: c.item?.name, qty: c.quantity || 1 })).filter(c => c.id),
    text: text(e.desc || e.description),
  };
}

function magicItem(m) {
  const t = text(m.desc);
  return {
    id: m.index, name: m.name, category: m.equipment_category?.name || '', rarity: m.rarity?.name || '',
    attunement: m.attunement ?? /requires attunement/i.test(t.split('\n')[0]), text: t,
  };
}

function condition(c) { return { id: c.index, name: c.name, text: text(c.desc || c.description) }; }

// ---- Characters (v2.163.0): classes, their features by level, species,
// backgrounds and starting equipment, for "fill from the SRD" on a sheet.

const SKILL_KEY = (name) => {
  const words = String(name).replace(/^Skill:\s*/, '').split(/\s+/);
  return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('');
};
const ABILITY_KEYS = { STR: 'str', DEX: 'dex', CON: 'con', INT: 'int', WIS: 'wis', CHA: 'cha' };

// Starting equipment, flattened: a group is a choice between alternatives,
// each some items, some gold, and picks from a category ("any martial melee weapon").
function equipmentGroups(list, edition, ctx) {
  const leaf = (o, alt) => {
    if (!o) return;
    if (o.option_type === 'counted_reference') {
      const id = o.of?.index;
      if (ctx.categories[id]) alt.picks.push({ name: o.of.name, count: o.count || 1, items: ctx.categories[id] });
      else if (id) alt.items.push({ id, name: o.of.name + (o.of.note ? ` (${o.of.note})` : ''), qty: o.count || 1 });
    } else if (o.option_type === 'money') alt.gp += o.unit === 'gp' ? o.count : o.unit === 'sp' ? o.count / 10 : o.count / 100;
    else if (o.option_type === 'multiple') (o.items || []).forEach(i => leaf(i, alt));
    else if (o.option_type === 'choice') {
      const f = o.choice?.from;
      if (f?.option_set_type === 'equipment_category') alt.picks.push({ name: f.equipment_category.name, count: o.choice.choose || 1, items: ctx.categories[f.equipment_category.index] || [] });
    } else if (o.option_type === 'reference' && o.item) alt.items.push({ id: o.item.index, name: o.item.name, qty: 1 });
  };
  return (list || []).map((g) => {
    const from = g.from || {};
    const label = g.desc || '';
    let alternatives;
    if (from.option_set_type === 'equipment_category') {
      alternatives = [{ items: [], gp: 0, picks: [{ name: from.equipment_category.name, count: g.choose || 1, items: ctx.categories[from.equipment_category.index] || [] }] }];
    } else {
      alternatives = (from.options || []).map((o) => { const alt = { items: [], gp: 0, picks: [] }; leaf(o, alt); return alt; });
    }
    alternatives.forEach((alt, i) => { alt.label = describeAlt(alt) || `Option ${i + 1}`; });
    return { label, alternatives };
  }).filter(g => g.alternatives.length);
}
function describeAlt(alt) {
  return [
    ...alt.items.map(i => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)),
    ...alt.picks.map(p => `${p.count > 1 ? `${p.count} × ` : ''}any ${p.name.replace(/s$/, '').toLowerCase()}`),
    alt.gp ? `${alt.gp} GP` : '',
  ].filter(Boolean).join(', ');
}

function characterSets(edition) {
  const categories = Object.fromEntries(read(edition, 'Equipment-Categories').map(c => [c.index, (c.equipment || []).map(e => ({ id: e.index, name: e.name }))]));
  const ctx = { categories };
  const levels = read(edition, 'Levels');
  const features = new Map();
  for (const f of read(edition, 'Features')) {
    if (f.parent) continue; // an option of another feature (a Fighting Style), chosen, not gained
    features.set(f.index, { id: f.index, name: f.name, text: text(f.desc || f.description) });
  }
  for (const f of (fs.existsSync(path.join(srcDir, `${edition}-Feats.json`)) ? read(edition, 'Feats') : [])) {
    features.set(`feat-${f.index}`, { id: `feat-${f.index}`, name: `Feat: ${f.name}`, text: text(f.desc || f.description) });
  }
  const subclasses = read(edition, 'Subclasses');
  const classes = read(edition, 'Classes').map((c) => {
    const lv = {};
    for (const l of levels.filter(x => x.class?.index === c.index && !x.subclass)) {
      const counters = Object.fromEntries(Object.entries(l.class_specific || {}).filter(([, v]) => typeof v === 'number'));
      lv[l.level] = { features: (l.features || []).map(f => f.index).filter(id => features.has(id)), counters };
    }
    const subs = subclasses.filter(sc => sc.class?.index === c.index).map(sc => {
      const sl = {};
      for (const l of levels.filter(x => x.subclass?.index === sc.index)) sl[l.level] = (l.features || []).map(f => f.index).filter(id => features.has(id));
      return { id: sc.index, name: sc.name, levels: sl };
    });
    const skillChoice = (c.proficiency_choices || []).find(pc => JSON.stringify(pc).includes('Skill:'));
    const skillOptions = [];
    const collect = (o) => { if (!o) return; if (o.item?.name?.startsWith('Skill:')) skillOptions.push(SKILL_KEY(o.item.name)); if (o.choice) (o.choice.from?.options || []).forEach(collect); };
    (skillChoice?.from?.options || []).forEach(collect);
    const fixed = (c.starting_equipment || []).map(e => ({ id: e.equipment.index, name: e.equipment.name, qty: e.quantity || 1 }));
    // Multiclassing into this class (v2.164.0): the scores it needs, what it
    // grants, and the skill it lets you choose, if any.
    const mc = c.multi_classing || {};
    const prereq = (mc.prerequisites || []).map(p => ({ ability: p.ability_score?.index, min: p.minimum_score }));
    const prereqAny = (mc.prerequisite_options?.from?.options || []).map(p => ({ ability: p.ability_score?.index, min: p.minimum_score }));
    const mcSkillChoice = (mc.proficiency_choices || []).find(pc => JSON.stringify(pc).includes('Skill:'));
    const mcSkills = [];
    const mcCollect = (o) => { if (!o) return; if (o.item?.name?.startsWith('Skill:')) mcSkills.push(SKILL_KEY(o.item.name)); if (o.choice) (o.choice.from?.options || []).forEach(mcCollect); };
    (mcSkillChoice?.from?.options || []).forEach(mcCollect);
    return {
      id: c.index, name: c.name, hitDie: c.hit_die,
      skills: skillChoice ? { choose: skillChoice.choose, from: [...new Set(skillOptions)] } : null,
      multiclass: {
        all: prereq, any: prereqAny,
        proficiencies: (mc.proficiencies || []).map(p => p.name.replace(/^Tool:\s*/, '')),
        skills: mcSkillChoice ? { choose: mcSkillChoice.choose, from: [...new Set(mcSkills)] } : null,
      },
      levels: lv, subclasses: subs,
      equipment: { fixed, groups: equipmentGroups(c.starting_equipment_options, edition, ctx) },
    };
  });

  const traitsData = read(edition, 'Traits');
  const traits = traitsData.map(t => ({ id: t.index, name: t.name, text: text(t.desc || t.description) }));
  const bonuses = (list) => (list || []).map(b => `${b.ability_score?.name} +${b.bonus}`).join(', ');
  let species;
  if (edition === '2014') {
    const subraces = read(edition, 'Subraces');
    species = read(edition, 'Races').map(r => ({
      id: r.index, name: r.name, speed: r.speed, size: r.size, abilityBonuses: bonuses(r.ability_bonuses),
      traits: (r.traits || []).map(t => t.index),
      subspecies: subraces.filter(sr => sr.race?.index === r.index).map(sr => ({
        id: sr.index, name: sr.name, abilityBonuses: bonuses(sr.ability_bonuses), traits: (sr.racial_traits || []).map(t => t.index),
      })),
    }));
  } else {
    const subspecies = read(edition, 'Subspecies');
    species = read(edition, 'Species').map(r => ({
      id: r.index, name: r.name, speed: r.speed, size: r.size, abilityBonuses: '',
      traits: (r.traits || []).map(t => t.index),
      subspecies: subspecies.filter(sr => sr.species?.index === r.index).map(sr => ({ id: sr.index, name: sr.name, abilityBonuses: '', traits: (sr.traits || []).map(t => t.index) })),
    }));
  }

  const backgrounds = read(edition, 'Backgrounds').map(b => {
    const profs = b.starting_proficiencies || b.proficiencies || [];
    const feature = b.feature ? { id: `bg-${b.index}`, name: b.feature.name, text: text(b.feature.desc) } : null;
    if (feature) features.set(feature.id, feature);
    return {
      id: b.index, name: b.name,
      skills: profs.filter(p => p.name.startsWith('Skill:')).map(p => SKILL_KEY(p.name)),
      tools: profs.filter(p => !p.name.startsWith('Skill:')).map(p => p.name.replace(/^Tool:\s*/, '')),
      abilityScores: (b.ability_scores || []).map(a => ABILITY_KEYS[a.name] || a.index),
      feature: feature ? feature.id : (b.feat ? `feat-${b.feat.index}` : null),
      featNote: b.feat?.note || '',
      equipment: {
        fixed: (b.starting_equipment || []).map(e => ({ id: e.equipment.index, name: e.equipment.name, qty: e.quantity || 1 })),
        gp: b.starting_gold?.unit === 'gp' ? b.starting_gold.quantity : 0,
        groups: equipmentGroups(b.starting_equipment_options || b.equipment_options, edition, ctx),
      },
    };
  });
  // Feats (v2.164.0), with what an Ability Score Improvement or Epic Boon
  // needs to know: the kind, the level, and the score it raises.
  const ABIL_WORD = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
  const feats = (fs.existsSync(path.join(srcDir, `${edition}-Feats.json`)) ? read(edition, 'Feats') : []).map(f => {
    const t = text(f.desc || f.description);
    let increase = null;
    const any = t.match(/Increase one ability score of your choice by 1, to a maximum of (\d+)/i);
    const some = t.match(/Increase your (\w+)(?:,? (?:or )?(\w+))?(?:,? or (\w+))? score by 1, to a maximum of (\d+)/i);
    if (f.index === 'ability-score-improvement') increase = { asi: true, max: 20 };
    else if (any) increase = { from: ['str', 'dex', 'con', 'int', 'wis', 'cha'], by: 1, max: Number(any[1]) };
    else if (some) increase = { from: [some[1], some[2], some[3]].filter(Boolean).map(w => ABIL_WORD[w.toLowerCase()]).filter(Boolean), by: 1, max: Number(some[4]) };
    return {
      id: `feat-${f.index}`, name: f.name, type: f.type || 'general',
      minLevel: f.prerequisites?.minimum_level || 0,
      needsFeature: f.prerequisites?.feature_named || null,
      scores: Array.isArray(f.prerequisites) ? f.prerequisites.filter(p => p.ability_score).map(p => ({ ability: p.ability_score.index, min: p.minimum_score })) : [],
      repeatable: !!f.repeatable, increase,
    };
  });
  return { classes, features: [...features.values()], species, traits, backgrounds, feats };
}

const byName = (a, b) => a.name.localeCompare(b.name);
const counts = {};
for (const edition of ['2014', '2024']) {
  const dir = path.join(outRoot, edition);
  fs.mkdirSync(dir, { recursive: true });
  const sets = {
    spells: read(edition, 'Spells').map(s => spell(s, edition)),
    monsters: read(edition, 'Monsters').map(m => monster(m, edition)),
    equipment: read(edition, 'Equipment').map(e => equipment(e, edition)),
    'magic-items': read(edition, 'Magic-Items').filter(m => !m.variant).map(magicItem),
    conditions: read(edition, 'Conditions').map(condition),
    ...characterSets(edition),
  };
  for (const [name, list] of Object.entries(sets)) {
    list.sort(byName);
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(list));
    counts[`${edition} ${name}`] = list.length;
  }
}
fs.writeFileSync(path.join(outRoot, 'SOURCE.md'), `# Where this data comes from

Generated by \`tools/build-srd.mjs\` from [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (MIT) at commit \`${commit}\`, files \`src/2014/en\` and \`src/2024/en\`.

The rules text is from the **System Reference Document 5.1** (\`2014/\`) and **5.2** (\`2024/\`) by Wizards of the Coast LLC, licensed under the Creative Commons Attribution 4.0 International License (https://creativecommons.org/licenses/by/4.0/legalcode). The credit is on the About page. Nothing here is from outside the SRD.

| Set | Entries |
|---|---|
${Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

Don't edit these files by hand; fix the converter and run it again.
`);
console.log(counts);
