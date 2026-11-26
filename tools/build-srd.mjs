#!/usr/bin/env node
/**
 * Build the rules reference (v2.161.0, docs/ttrpg/README.md phase 6) from the
 * 5e-bits SRD data: spells, monsters, equipment, magic items and conditions
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
