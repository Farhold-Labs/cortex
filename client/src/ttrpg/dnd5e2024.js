/**
 * D&D 5e, 2024 rules (v2.159.0, docs/ttrpg/README.md phase 2), and the 2014
 * rules (v2.160.0) where they differ.
 *
 * Only what the System Reference Documents give (SRD 5.2 for 2024, SRD 5.1
 * for 2014; both CC-BY-4.0, Wizards of the Coast): the names of classes,
 * species, backgrounds, skills and conditions, and the rules tables a sheet
 * works numbers out from. No book text. Everything derived here is worked
 * out on the device, because in an encrypted wave the server can't read the
 * sheet. A sheet's `system` says which edition: 'dnd5e-2024' or 'dnd5e-2014'.
 */

export const DND5E_SYSTEMS = ['dnd5e-2024', 'dnd5e-2014'];
export const isDnd5e = (system) => DND5E_SYSTEMS.includes(system);
const is2014 = (s) => s?.system === 'dnd5e-2014';

export const ABILITIES = [
  { key: 'str', name: 'Strength', short: 'STR' },
  { key: 'dex', name: 'Dexterity', short: 'DEX' },
  { key: 'con', name: 'Constitution', short: 'CON' },
  { key: 'int', name: 'Intelligence', short: 'INT' },
  { key: 'wis', name: 'Wisdom', short: 'WIS' },
  { key: 'cha', name: 'Charisma', short: 'CHA' },
];

export const SKILLS = [
  { key: 'acrobatics', name: 'Acrobatics', ability: 'dex' },
  { key: 'animalHandling', name: 'Animal Handling', ability: 'wis' },
  { key: 'arcana', name: 'Arcana', ability: 'int' },
  { key: 'athletics', name: 'Athletics', ability: 'str' },
  { key: 'deception', name: 'Deception', ability: 'cha' },
  { key: 'history', name: 'History', ability: 'int' },
  { key: 'insight', name: 'Insight', ability: 'wis' },
  { key: 'intimidation', name: 'Intimidation', ability: 'cha' },
  { key: 'investigation', name: 'Investigation', ability: 'int' },
  { key: 'medicine', name: 'Medicine', ability: 'wis' },
  { key: 'nature', name: 'Nature', ability: 'int' },
  { key: 'perception', name: 'Perception', ability: 'wis' },
  { key: 'performance', name: 'Performance', ability: 'cha' },
  { key: 'persuasion', name: 'Persuasion', ability: 'cha' },
  { key: 'religion', name: 'Religion', ability: 'int' },
  { key: 'sleightOfHand', name: 'Sleight of Hand', ability: 'dex' },
  { key: 'stealth', name: 'Stealth', ability: 'dex' },
  { key: 'survival', name: 'Survival', ability: 'wis' },
];

// caster: full, half (2024 Paladin and Ranger cast from level 1), pact, or none.
export const CLASSES = {
  Barbarian: { hitDie: 12, saves: ['str', 'con'], caster: null },
  Bard: { hitDie: 8, saves: ['dex', 'cha'], caster: 'full', spellAbility: 'cha' },
  Cleric: { hitDie: 8, saves: ['wis', 'cha'], caster: 'full', spellAbility: 'wis' },
  Druid: { hitDie: 8, saves: ['int', 'wis'], caster: 'full', spellAbility: 'wis' },
  Fighter: { hitDie: 10, saves: ['str', 'con'], caster: null },
  Monk: { hitDie: 8, saves: ['str', 'dex'], caster: null },
  Paladin: { hitDie: 10, saves: ['wis', 'cha'], caster: 'half', spellAbility: 'cha' },
  Ranger: { hitDie: 10, saves: ['str', 'dex'], caster: 'half', spellAbility: 'wis' },
  Rogue: { hitDie: 8, saves: ['dex', 'int'], caster: null },
  Sorcerer: { hitDie: 6, saves: ['con', 'cha'], caster: 'full', spellAbility: 'cha' },
  Warlock: { hitDie: 8, saves: ['wis', 'cha'], caster: 'pact', spellAbility: 'cha' },
  Wizard: { hitDie: 6, saves: ['int', 'wis'], caster: 'full', spellAbility: 'int' },
};

export const SPECIES = ['Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Goliath', 'Halfling', 'Human', 'Orc', 'Tiefling'];
export const BACKGROUNDS = ['Acolyte', 'Criminal', 'Sage', 'Soldier'];
// SRD 5.1 (2014): races, not species, and one background.
export const RACES_2014 = ['Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Half-Elf', 'Half-Orc', 'Halfling', 'Human', 'Tiefling'];
export const BACKGROUNDS_2014 = ['Acolyte'];

/** What a sheet's edition calls things and lists. */
export function editionInfo(system) {
  return system === 'dnd5e-2014'
    ? { year: 2014, speciesLabel: 'RACE', species: RACES_2014, backgrounds: BACKGROUNDS_2014, inspiration: 'Inspiration' }
    : { year: 2024, speciesLabel: 'SPECIES', species: SPECIES, backgrounds: BACKGROUNDS, inspiration: 'Inspiration' };
}

// 2014 Exhaustion: six levels of effects rather than a penalty to every roll.
export const EXHAUSTION_2014 = [
  '', 'Disadvantage on ability checks', 'Speed halved', 'Disadvantage on attack rolls and saving throws',
  'Hit point maximum halved', 'Speed reduced to 0', 'Death',
];

export const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious',
];

// Spell slots by caster level, 1st to 9th (the multiclass table, which is the full caster's).
const SLOTS = [
  [], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

// Pact Magic: how many slots, and their level, by Warlock level.
const PACT = (level) => level < 1 ? null : {
  count: level >= 17 ? 4 : level >= 11 ? 3 : level >= 2 ? 2 : 1,
  level: level >= 9 ? 5 : Math.ceil(level / 2),
};

export const mod = (score) => Math.floor(((Number(score) || 0) - 10) / 2);
export const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);
export const profBonus = (level) => 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);

const uid = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).slice(0, 8);
export const newId = uid;

export function blankSheet(name = '', system = 'dnd5e-2024') {
  return {
    schema: 1, system: isDnd5e(system) ? system : 'dnd5e-2024',
    name, species: '', background: '', alignment: '', size: 'Medium',
    classes: [{ name: 'Fighter', level: 1, subclass: '' }],
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveProf: { str: true, dex: false, con: true, int: false, wis: false, cha: false },
    skills: {}, jackOfAllTrades: false,
    ac: 10, initiativeBonus: 0, speed: 30,
    hp: { max: 10, current: 10, temp: 0 },
    hitDiceUsed: {},
    deathSaves: { successes: 0, failures: 0 },
    heroicInspiration: false, exhaustion: 0, conditions: [],
    attacks: [],
    spellcasting: { ability: 'auto', slotsUsed: {}, slotsMax: null, pactUsed: 0 },
    spells: [],
    resources: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    proficiencies: '', features: '', notes: '',
  };
}

/** Everything a sheet shows that isn't typed in. */
export function derive(s) {
  const classes = (s.classes || []).filter(c => c && CLASSES[c.name]);
  const level = Math.max(1, classes.reduce((n, c) => n + (Number(c.level) || 0), 0));
  const prof = profBonus(level);
  const mods = Object.fromEntries(ABILITIES.map(a => [a.key, mod(s.abilities?.[a.key])]));
  const saves = Object.fromEntries(ABILITIES.map(a => [a.key, mods[a.key] + (s.saveProf?.[a.key] ? prof : 0)]));
  const skills = Object.fromEntries(SKILLS.map(k => {
    const rank = Number(s.skills?.[k.key]) || 0; // 0 none, 1 proficient, 2 expertise
    const add = rank ? rank * prof : (s.jackOfAllTrades ? Math.floor(prof / 2) : 0);
    return [k.key, mods[k.ability] + add];
  }));

  // Spellcasting: the multiclass caster level and Pact Magic on its own.
  // Half casters: 2024 rounds up and casts from level 1; 2014 has no slots at
  // level 1, and rounds down when multiclassed.
  let casterLevel = 0; let casters = 0; let pactLevel = 0; let spellAbility = null;
  const casterClasses = classes.filter(c => CLASSES[c.name].caster === 'full' || CLASSES[c.name].caster === 'half').length;
  for (const c of classes) {
    const info = CLASSES[c.name]; const lv = Number(c.level) || 0;
    if (info.caster === 'full') { casterLevel += lv; casters++; }
    else if (info.caster === 'half') {
      casterLevel += !is2014(s) ? Math.ceil(lv / 2) : casterClasses > 1 ? Math.floor(lv / 2) : (lv < 2 ? 0 : Math.ceil(lv / 2));
      casters++;
    }
    else if (info.caster === 'pact') pactLevel += lv;
    if (info.spellAbility && !spellAbility) spellAbility = info.spellAbility;
  }
  if (s.spellcasting?.ability && s.spellcasting.ability !== 'auto') spellAbility = s.spellcasting.ability;
  const computedSlots = SLOTS[Math.min(20, casterLevel)] || [];
  const slotsMax = Array.from({ length: 9 }, (_, i) => {
    const override = s.spellcasting?.slotsMax?.[i + 1];
    return override == null || override === '' ? (computedSlots[i] || 0) : Math.max(0, Number(override) || 0);
  });
  const spellMod = spellAbility ? mods[spellAbility] : null;

  const hitDice = {};
  for (const c of classes) { const d = `d${CLASSES[c.name].hitDie}`; hitDice[d] = (hitDice[d] || 0) + (Number(c.level) || 0); }

  const exhaustion = Math.max(0, Math.min(6, Number(s.exhaustion) || 0));
  const baseSpeed = Number(s.speed) || 0;
  return {
    level, prof, mods, saves, skills,
    initiative: mods.dex + (Number(s.initiativeBonus) || 0),
    passivePerception: 10 + skills.perception,
    spellAbility, spellDC: spellMod == null ? null : 8 + prof + spellMod, spellAttack: spellMod == null ? null : prof + spellMod,
    slotsMax, pact: PACT(pactLevel), hasSpells: casters > 0 || pactLevel > 0 || (s.spells || []).length > 0,
    hitDice,
    exhaustion,
    // 2024: each level of Exhaustion is -2 to every d20 Test and -5 feet of
    // speed. 2014: no penalty to the roll; speed halved at 2, none at 5.
    d20Penalty: is2014(s) ? 0 : exhaustion * 2,
    speed: is2014(s) ? (exhaustion >= 5 ? 0 : exhaustion >= 2 ? Math.floor(baseSpeed / 2) : baseSpeed) : Math.max(0, baseSpeed - exhaustion * 5),
    exhaustionEffects: is2014(s) ? EXHAUSTION_2014.slice(1, exhaustion + 1) : (exhaustion ? [`−${exhaustion * 2} to d20 rolls`, `−${exhaustion * 5} ft. speed`] : []),
    edition: is2014(s) ? 2014 : 2024,
    casters,
  };
}

/** A d20 Test's dice: the bonus less Exhaustion, with advantage or disadvantage. */
export function d20Roll(bonus, d, mode = 'normal') {
  const n = bonus - d.d20Penalty;
  const dice = mode === 'adv' ? '2d20kh1' : mode === 'dis' ? '2d20kl1' : '1d20';
  return n ? `${dice}${signed(n)}` : dice;
}

/** A cantrip's damage grows at character levels 5, 11 and 17 (both editions). */
export function cantripDice(dice, level) {
  const times = level >= 17 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
  return String(dice || '').replace(/(\d*)d(\d+)/gi, (_, n, sides) => `${(Number(n) || 1) * times}d${sides}`);
}

export function attackBonus(a, d) {
  const abilityMod = a.ability === 'spell' ? (d.spellAttack == null ? 0 : d.spellAttack - d.prof) : a.ability && a.ability !== 'none' ? d.mods[a.ability] : 0;
  return abilityMod + (a.proficient || a.ability === 'spell' ? d.prof : 0) + (Number(a.bonus) || 0);
}

export function damageRoll(a, d, crit = false) {
  let dice = String(a.damage || '').replace(/\s+/g, '');
  if (!dice) return null;
  // A critical hit rolls the damage dice twice.
  if (crit) dice = dice.replace(/(\d*)d(\d+)/gi, (_, n, sides) => `${(Number(n) || 1) * 2}d${sides}`);
  const abilityMod = a.damageAbility === false || !a.ability || a.ability === 'none' ? 0
    : a.ability === 'spell' ? (d.spellAttack == null ? 0 : d.spellAttack - d.prof) : d.mods[a.ability];
  const extra = abilityMod + (Number(a.damageBonus) || 0);
  return extra ? `${dice}${signed(extra)}` : dice;
}

/** Damage takes temporary hit points first; healing stops at the maximum. */
export function applyHp(s, amount) {
  const hp = { max: Number(s.hp?.max) || 0, current: Number(s.hp?.current) || 0, temp: Number(s.hp?.temp) || 0 };
  if (amount < 0) {
    let dmg = -amount;
    const fromTemp = Math.min(hp.temp, dmg); hp.temp -= fromTemp; dmg -= fromTemp;
    hp.current = Math.max(0, hp.current - dmg);
  } else {
    if (hp.current === 0 && amount > 0) s.deathSaves = { successes: 0, failures: 0 };
    hp.current = Math.min(hp.max, hp.current + amount);
  }
  s.hp = hp;
}

export function shortRest(s) {
  s.spellcasting = { ...(s.spellcasting || {}), pactUsed: 0 };
  s.resources = (s.resources || []).map(r => (r.reset === 'short' ? { ...r, current: r.max } : r));
}

// Long Rest: all hit points, spell slots and features back, and one level of
// Exhaustion off. Hit Dice: 2024 gives all of them back; 2014 half your total
// (at least one), largest dice first.
export function longRest(s) {
  shortRest(s);
  s.hp = { ...s.hp, current: Number(s.hp?.max) || 0, temp: 0 };
  if (is2014(s)) {
    const total = derive(s).hitDice;
    let back = Math.max(1, Math.floor(Object.values(total).reduce((a, b) => a + b, 0) / 2));
    const used = { ...(s.hitDiceUsed || {}) };
    for (const die of Object.keys(used).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))) {
      const give = Math.min(back, Number(used[die]) || 0); used[die] = (Number(used[die]) || 0) - give; back -= give;
    }
    s.hitDiceUsed = used;
  } else s.hitDiceUsed = {};
  s.spellcasting = { ...s.spellcasting, slotsUsed: {}, pactUsed: 0 };
  s.resources = (s.resources || []).map(r => (r.reset === 'long' || r.reset === 'short' ? { ...r, current: r.max } : r));
  s.deathSaves = { successes: 0, failures: 0 };
  s.exhaustion = Math.max(0, (Number(s.exhaustion) || 0) - 1);
}
