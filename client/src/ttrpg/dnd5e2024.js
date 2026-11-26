/**
 * D&D 5e, 2024 rules (v2.159.0, docs/ttrpg/README.md phase 2).
 *
 * Only what the System Reference Document 5.2 gives (CC-BY-4.0, Wizards of
 * the Coast): the names of classes, species, backgrounds, skills and
 * conditions, and the rules tables a sheet works numbers out from. No book
 * text. Everything derived here is worked out on the device, because in an
 * encrypted wave the server can't read the sheet.
 */

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

export function blankSheet(name = '') {
  return {
    schema: 1, system: 'dnd5e-2024',
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

  // Spellcasting: the multiclass caster level (2024: half casters round up),
  // and Pact Magic on its own.
  let casterLevel = 0; let casters = 0; let pactLevel = 0; let spellAbility = null;
  for (const c of classes) {
    const info = CLASSES[c.name]; const lv = Number(c.level) || 0;
    if (info.caster === 'full') { casterLevel += lv; casters++; }
    else if (info.caster === 'half') { casterLevel += Math.ceil(lv / 2); casters++; }
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
  return {
    level, prof, mods, saves, skills,
    initiative: mods.dex + (Number(s.initiativeBonus) || 0),
    passivePerception: 10 + skills.perception,
    spellAbility, spellDC: spellMod == null ? null : 8 + prof + spellMod, spellAttack: spellMod == null ? null : prof + spellMod,
    slotsMax, pact: PACT(pactLevel), hasSpells: casters > 0 || pactLevel > 0 || (s.spells || []).length > 0,
    hitDice,
    exhaustion,
    // 2024: each level of Exhaustion is -2 to every d20 Test and -5 feet of speed.
    d20Penalty: exhaustion * 2,
    speed: Math.max(0, (Number(s.speed) || 0) - exhaustion * 5),
    casters,
  };
}

/** A d20 Test's dice: the bonus less Exhaustion, with advantage or disadvantage. */
export function d20Roll(bonus, d, mode = 'normal') {
  const n = bonus - d.d20Penalty;
  const dice = mode === 'adv' ? '2d20kh1' : mode === 'dis' ? '2d20kl1' : '1d20';
  return n ? `${dice}${signed(n)}` : dice;
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

// 2024 Long Rest: all hit points and all spent Hit Dice back, spell slots
// back, and one level of Exhaustion off.
export function longRest(s) {
  shortRest(s);
  s.hp = { ...s.hp, current: Number(s.hp?.max) || 0, temp: 0 };
  s.hitDiceUsed = {};
  s.spellcasting = { ...s.spellcasting, slotsUsed: {}, pactUsed: 0 };
  s.resources = (s.resources || []).map(r => (r.reset === 'long' || r.reset === 'short' ? { ...r, current: r.max } : r));
  s.deathSaves = { successes: 0, failures: 0 };
  s.exhaustion = Math.max(0, (Number(s.exhaustion) || 0) - 1);
}
