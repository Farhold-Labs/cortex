'use strict';

// The 5e (2024) numbers a sheet works out on the device, and the generic
// sheet's {field} dice (v2.159.0). Wrong numbers here are wrong rolls, so the
// rules tables are checked against SRD 5.2.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = () => import('../client/src/ttrpg/dnd5e2024.js');
const generic = () => import('../client/src/ttrpg/generic.js');

test('5e: modifiers, proficiency, saves, skills, passive Perception', async () => {
  const { blankSheet, derive, mod, profBonus } = await rules();
  assert.deepEqual([1, 8, 9, 10, 11, 15, 20, 30].map(mod), [-5, -1, -1, 0, 0, 2, 5, 10]);
  assert.deepEqual([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(profBonus), [2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
  const s = blankSheet('Vex');
  s.classes = [{ name: 'Rogue', level: 5 }];
  s.abilities = { str: 8, dex: 18, con: 14, int: 12, wis: 13, cha: 10 };
  s.saveProf = { dex: true, int: true };
  s.skills = { stealth: 2, perception: 1 };
  const d = derive(s);
  assert.equal(d.level, 5); assert.equal(d.prof, 3);
  assert.equal(d.saves.dex, 7); assert.equal(d.saves.str, -1);
  assert.equal(d.skills.stealth, 10); assert.equal(d.skills.perception, 4); assert.equal(d.skills.arcana, 1);
  assert.equal(d.passivePerception, 14); assert.equal(d.initiative, 4);
  s.jackOfAllTrades = true;
  assert.equal(derive(s).skills.arcana, 2);
  assert.deepEqual(derive(s).hitDice, { d8: 5 });
});

test('5e: spell slots for full, half (2024: from level 1, rounded up) and pact casters', async () => {
  const { blankSheet, derive } = await rules();
  const slots = (classes) => { const s = blankSheet(); s.classes = classes; return derive(s); };
  assert.deepEqual(slots([{ name: 'Wizard', level: 1 }]).slotsMax.slice(0, 2), [2, 0]);
  assert.deepEqual(slots([{ name: 'Wizard', level: 5 }]).slotsMax.slice(0, 4), [4, 3, 2, 0]);
  assert.deepEqual(slots([{ name: 'Wizard', level: 20 }]).slotsMax, [4, 3, 3, 3, 3, 2, 2, 1, 1]);
  assert.deepEqual(slots([{ name: 'Paladin', level: 1 }]).slotsMax.slice(0, 2), [2, 0]);
  assert.deepEqual(slots([{ name: 'Ranger', level: 5 }]).slotsMax.slice(0, 3), [4, 2, 0]);
  // Multiclass: Paladin 3 (2, rounded up) + Sorcerer 3 = caster level 5.
  assert.deepEqual(slots([{ name: 'Paladin', level: 3 }, { name: 'Sorcerer', level: 3 }]).slotsMax.slice(0, 4), [4, 3, 2, 0]);
  assert.deepEqual(slots([{ name: 'Fighter', level: 5 }]).slotsMax, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const w = slots([{ name: 'Warlock', level: 5 }]);
  assert.deepEqual(w.pact, { count: 2, level: 3 }); assert.deepEqual(w.slotsMax[0], 0);
  assert.deepEqual(slots([{ name: 'Warlock', level: 1 }]).pact, { count: 1, level: 1 });
  assert.deepEqual(slots([{ name: 'Warlock', level: 11 }]).pact, { count: 3, level: 5 });
  assert.deepEqual(slots([{ name: 'Warlock', level: 17 }]).pact, { count: 4, level: 5 });
  const s = blankSheet(); s.classes = [{ name: 'Cleric', level: 5 }]; s.abilities.wis = 16;
  const dc = derive(s);
  assert.equal(dc.spellAbility, 'wis'); assert.equal(dc.spellDC, 14); assert.equal(dc.spellAttack, 6);
});

test('5e: rolls built from the sheet, with Exhaustion and criticals', async () => {
  const { blankSheet, derive, d20Roll, attackBonus, damageRoll } = await rules();
  const s = blankSheet(); s.abilities.str = 16; s.classes = [{ name: 'Fighter', level: 1 }];
  let d = derive(s);
  assert.equal(d20Roll(5, d), '1d20+5'); assert.equal(d20Roll(0, d), '1d20');
  assert.equal(d20Roll(-1, d, 'adv'), '2d20kh1-1'); assert.equal(d20Roll(2, d, 'dis'), '2d20kl1+2');
  s.exhaustion = 2; d = derive(s);
  assert.equal(d20Roll(3, d), '1d20-1'); assert.equal(d.speed, 20);
  s.exhaustion = 0; d = derive(s);
  const sword = { ability: 'str', proficient: true, bonus: 1, damage: '1d8', damageAbility: true };
  assert.equal(attackBonus(sword, d), 6);
  assert.equal(damageRoll(sword, d), '1d8+3');
  assert.equal(damageRoll({ ...sword, damage: '2d6+1d4' }, d, true), '4d6+2d4+3');
  assert.equal(damageRoll({ ...sword, damage: 'd6' }, d, true), '2d6+3');
  assert.equal(damageRoll({ ...sword, damageAbility: false }, d), '1d8');
  assert.equal(damageRoll({ ...sword, damage: '' }, d), null);
});

test('5e: damage takes temporary hit points first; rests restore what 2024 says', async () => {
  const { blankSheet, applyHp, longRest, shortRest } = await rules();
  const s = blankSheet(); s.hp = { max: 20, current: 15, temp: 5 };
  applyHp(s, -7); assert.deepEqual(s.hp, { max: 20, current: 13, temp: 0 });
  applyHp(s, -50); assert.equal(s.hp.current, 0);
  s.deathSaves = { successes: 1, failures: 2 };
  applyHp(s, 30); assert.equal(s.hp.current, 20); assert.deepEqual(s.deathSaves, { successes: 0, failures: 0 });
  s.hp.current = 3; s.hitDiceUsed = { d10: 2 }; s.exhaustion = 2;
  s.spellcasting = { slotsUsed: { 1: 2 }, pactUsed: 1 };
  s.resources = [{ name: 'Action Surge', current: 0, max: 1, reset: 'short' }, { name: 'Lay on Hands', current: 0, max: 5, reset: 'long' }, { name: 'Wish', current: 0, max: 1, reset: 'none' }];
  shortRest(s);
  assert.equal(s.spellcasting.pactUsed, 0); assert.equal(s.spellcasting.slotsUsed[1], 2);
  assert.deepEqual(s.resources.map(r => r.current), [1, 0, 0]);
  longRest(s);
  assert.equal(s.hp.current, 20); assert.deepEqual(s.hitDiceUsed, {}); assert.equal(s.exhaustion, 1);
  assert.deepEqual(s.spellcasting.slotsUsed, {}); assert.deepEqual(s.resources.map(r => r.current), [1, 5, 0]);
});

test('generic: {field} dice take whole numbers from fields, nothing else', async () => {
  const { fillRoll } = await generic();
  const sheet = { fields: [{ label: 'Agility', value: '3' }, { label: 'Wits', value: '-2' }, { label: 'Name', value: 'Bob' }], resources: [{ name: 'Edge', current: 2 }] };
  assert.deepEqual(fillRoll('1d20+{Agility}', sheet), { expression: '1d20+3' });
  assert.deepEqual(fillRoll('1d20+{ wits }', sheet), { expression: '1d20-2' });
  assert.deepEqual(fillRoll('{Edge}d6', sheet), { expression: '2d6' });
  assert.deepEqual(fillRoll('1d20-{Wits}', sheet), { expression: '1d20+2' });
  assert.ok(fillRoll('1d20+{Name}', sheet).error);
  assert.ok(fillRoll('1d20+{Luck}', sheet).error);
  assert.ok(fillRoll('1d20{Agility}', sheet).error);
});

// ---------------------------------------------------------------- v2.160.0

const encounter = () => import('../client/src/ttrpg/encounter.js');
const monster = () => import('../client/src/ttrpg/monster.js');

test('encounters: turns, rounds, skipping the fallen, going back', async () => {
  const { blankEncounter, combatant, nextTurn, previousTurn } = await encounter();
  const e = blankEncounter('Ambush', 'doc-gm');
  const [a, b, c] = ['Vex', 'Goblin', 'Zoe'].map((name, i) => combatant({ name, kind: i === 1 ? 'monster' : 'pc' }));
  e.combatants = [a, b, c];
  nextTurn(e); assert.equal(e.round, 1); assert.equal(e.turn, a.id);
  nextTurn(e); assert.equal(e.turn, b.id);
  nextTurn(e); assert.equal(e.turn, c.id);
  nextTurn(e); assert.equal(e.round, 2); assert.equal(e.turn, a.id);
  // A downed monster loses its turn; a downed PC keeps it (death saves).
  b.status = 'down'; c.status = 'down';
  nextTurn(e); assert.equal(e.turn, c.id);
  nextTurn(e); assert.equal(e.round, 3); assert.equal(e.turn, a.id);
  previousTurn(e); assert.equal(e.round, 2); assert.equal(e.turn, c.id);
  previousTurn(e); assert.equal(e.turn, a.id); assert.equal(e.round, 2);
  previousTurn(e); previousTurn(e); assert.equal(e.round, 1); assert.equal(e.turn, a.id);
  // The one whose turn it was removed: the next in line goes.
  e.combatants = [b, c]; b.status = null; e.turn = a.id;
  nextTurn(e); assert.equal(e.turn, b.id);
});

test('encounters: sorting, Bloodied, and initiative only from its owner\'s first roll', async () => {
  const { combatant, sortByInitiative, statusFromHp, applyInitiativeRolls, initiativeRef } = await encounter();
  const list = [
    combatant({ name: 'slow', initBonus: 0 }), combatant({ name: 'tie-low', initBonus: 1 }),
    combatant({ name: 'none' }), combatant({ name: 'tie-high', initBonus: 3 }), combatant({ name: 'fast' }),
  ];
  [5, 12, null, 12, 20].forEach((v, i) => { list[i].initiative = v; });
  assert.deepEqual(sortByInitiative(list).map(c => c.name), ['fast', 'tie-high', 'tie-low', 'slow', 'none']);
  assert.deepEqual([[10, 10], [6, 10], [5, 10], [1, 10], [0, 10], [5, 0]].map(([h, m]) => statusFromHp(h, m)), [null, null, 'bloodied', 'bloodied', 'down', null]);

  const vex = combatant({ name: 'Vex', kind: 'pc', ownerId: 'ann' });
  const zoe = combatant({ name: 'Zoe', kind: 'pc', ownerId: 'bob' });
  const gob = combatant({ name: 'Goblin', kind: 'monster' });
  const e = { combatants: [vex, zoe, gob] };
  const rolls = [
    { ref: initiativeRef('E', vex.id), rollerId: 'ann', total: 3, createdAt: '2026-01-01T00:00:02Z' },
    { ref: initiativeRef('E', vex.id), rollerId: 'ann', total: 19, createdAt: '2026-01-01T00:00:05Z' }, // a re-roll
    { ref: initiativeRef('E', zoe.id), rollerId: 'ann', total: 20, createdAt: '2026-01-01T00:00:01Z' }, // not hers
    { ref: initiativeRef('OTHER', zoe.id), rollerId: 'bob', total: 18, createdAt: '2026-01-01T00:00:01Z' },
    { ref: initiativeRef('E', gob.id), rollerId: 'bob', total: 20, createdAt: '2026-01-01T00:00:01Z' }, // no owner
    { ref: initiativeRef('E', zoe.id), rollerId: 'bob', hidden: true, createdAt: '2026-01-01T00:00:00Z' },
  ];
  assert.equal(applyInitiativeRolls(e, rolls, 'E'), 1);
  assert.equal(vex.initiative, 3); assert.equal(zoe.initiative, null); assert.equal(gob.initiative, null);
});

test('stat blocks: average hit points from hit dice', async () => {
  const { averageOf, initiativeBonus, blankMonster } = await monster();
  assert.equal(averageOf('2d8+2'), 11); assert.equal(averageOf('3d6'), 10); assert.equal(averageOf('d12-1'), 5);
  assert.equal(averageOf('10d10+30'), 85); assert.equal(averageOf('1d4-5'), 1);
  assert.equal(averageOf(''), null); assert.equal(averageOf('lots'), null); assert.equal(averageOf('7'), null);
  const m = blankMonster('Wolf'); m.abilities.dex = 15;
  assert.equal(initiativeBonus(m), 2);
});

test('5e 2014: half casters from level 2, rounded down multiclassed; Exhaustion and long rests by 2014', async () => {
  const { blankSheet, derive, d20Roll, longRest, isDnd5e } = await rules();
  assert.ok(isDnd5e('dnd5e-2014')); assert.ok(!isDnd5e('generic'));
  const s14 = (classes) => { const s = blankSheet('', 'dnd5e-2014'); s.classes = classes; return s; };
  assert.equal(blankSheet('', 'dnd5e-2014').system, 'dnd5e-2014');
  assert.equal(blankSheet('', 'pathfinder').system, 'dnd5e-2024');
  assert.deepEqual(derive(s14([{ name: 'Paladin', level: 1 }])).slotsMax.slice(0, 2), [0, 0]);
  assert.deepEqual(derive(s14([{ name: 'Paladin', level: 2 }])).slotsMax.slice(0, 2), [2, 0]);
  assert.deepEqual(derive(s14([{ name: 'Ranger', level: 5 }])).slotsMax.slice(0, 3), [4, 2, 0]);
  // Multiclass 2014: Paladin 3 counts as 1 (rounded down) + Sorcerer 3 = caster level 4.
  assert.deepEqual(derive(s14([{ name: 'Paladin', level: 3 }, { name: 'Sorcerer', level: 3 }])).slotsMax.slice(0, 3), [4, 3, 0]);
  assert.deepEqual(derive(s14([{ name: 'Wizard', level: 5 }])).slotsMax.slice(0, 4), [4, 3, 2, 0]);

  const s = s14([{ name: 'Fighter', level: 6 }]); s.speed = 30; s.exhaustion = 2;
  const d = derive(s);
  assert.equal(d.d20Penalty, 0); assert.equal(d20Roll(5, d), '1d20+5'); assert.equal(d.speed, 15);
  assert.deepEqual(d.exhaustionEffects, ['Disadvantage on ability checks', 'Speed halved']);
  s.exhaustion = 5; assert.equal(derive(s).speed, 0);
  // Long rest, 2014: half the total Hit Dice back (6 d10 → 3).
  s.exhaustion = 1; s.hitDiceUsed = { d10: 5 }; s.hp = { max: 50, current: 4, temp: 0 };
  longRest(s);
  assert.deepEqual(s.hitDiceUsed, { d10: 2 }); assert.equal(s.hp.current, 50); assert.equal(s.exhaustion, 0);
  const one = s14([{ name: 'Wizard', level: 1 }]); one.hitDiceUsed = { d6: 1 }; longRest(one);
  assert.deepEqual(one.hitDiceUsed, { d6: 0 });
});

test('generic: the FASERIP starting layout', async () => {
  const { blankGenericSheet, GENERIC_PRESETS, fillRoll } = await generic();
  const s = blankGenericSheet('Captain Test', 'faserip');
  assert.equal(s.name, 'Captain Test'); assert.equal(s.system, 'generic');
  assert.deepEqual(s.fields.slice(0, 7).map(f => f.label[0]).join(''), 'FASERIP');
  assert.deepEqual(s.resources.map(r => r.name), ['Health', 'Karma']);
  assert.deepEqual(fillRoll(s.rolls[0].expression, s), { expression: '1d100' });
  assert.equal(blankGenericSheet('x', 'nope').fields[0].label, 'Level');
  assert.ok(GENERIC_PRESETS.blank && GENERIC_PRESETS.faserip.label);
});

// ---------------------------------------------------------------- v2.165.0

test('armor class: equipped armour, Dex caps, shields, Unarmored Defense, set by hand', async () => {
  const { blankSheet, derive, parseArmor } = await rules();
  assert.deepEqual(parseArmor('14 + Dex (max 2)'), { base: 14, dex: true, max: 2 });
  assert.deepEqual(parseArmor('11 + dex'), { base: 11, dex: true, max: null });
  assert.deepEqual(parseArmor('16'), { base: 16, dex: false, max: null });
  assert.deepEqual(parseArmor('+2'), { bonus: 2 });
  assert.equal(parseArmor('heavy'), null);

  const s = blankSheet('Ac', 'dnd5e-2024'); s.abilities.dex = 16; s.abilities.con = 14; s.abilities.wis = 16;
  assert.equal(derive(s).armorClass.value, 13, 'unarmoured 10 + Dex');
  s.inventory = [
    { name: 'Scale Mail', ac: '14 + Dex (max 2)', equipped: false },
    { name: 'Plate Armor', ac: '18', equipped: false },
    { name: 'Shield', ac: '+2', equipped: false },
  ];
  assert.equal(derive(s).armorClass.value, 13, 'carried, not worn');
  s.inventory[0].equipped = true;
  assert.equal(derive(s).armorClass.value, 16, 'Dex capped at 2');
  s.inventory[1].equipped = true;
  assert.equal(derive(s).armorClass.value, 18, 'the best armour worn counts');
  s.inventory[2].equipped = true; s.acBonus = 1;
  assert.equal(derive(s).armorClass.value, 21);
  assert.match(derive(s).armorClass.parts.join(' '), /Plate Armor 18.*Shield \+2.*Other \+1/);

  const barb = blankSheet('', 'dnd5e-2014'); barb.classes = [{ name: 'Barbarian', level: 1 }]; barb.abilities.dex = 14; barb.abilities.con = 16;
  assert.equal(derive(barb).armorClass.value, 15, 'Barbarian: 10 + Dex + Con');
  barb.inventory = [{ name: 'Shield', ac: '+2', equipped: true }];
  assert.equal(derive(barb).armorClass.value, 17, 'a Barbarian keeps it with a shield');
  const monk = blankSheet('', 'dnd5e-2024'); monk.classes = [{ name: 'Monk', level: 1 }]; monk.abilities.dex = 16; monk.abilities.wis = 14;
  assert.equal(derive(monk).armorClass.value, 15, 'Monk: 10 + Dex + Wis');
  monk.inventory = [{ name: 'Shield', ac: '+2', equipped: true }];
  assert.equal(derive(monk).armorClass.value, 15, 'a Monk loses it with a shield (13 + 2)');

  // Set by hand: kept, and a sheet from before with a typed AC stays as typed.
  s.acMode = 'manual'; s.ac = 12;
  assert.equal(derive(s).armorClass.value, 12); assert.equal(derive(s).armorClass.auto, 21);
  const old = blankSheet(); delete old.acMode; old.ac = 17;
  assert.equal(derive(old).armorClass.value, 17);
  delete old.acMode; old.ac = 10; old.abilities.dex = 14;
  assert.equal(derive(old).armorClass.value, 12, 'the blank 10 is worked out');
});

test('armour from the SRD carries its AC', async () => {
  const { itemEntries } = await import('../client/src/ttrpg/fill.js');
  const { blankSheet } = await rules();
  const eq = JSON.parse(require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../client/src/srd/2024/equipment.json'), 'utf8'));
  const get = (n) => eq.find(x => x.name === n);
  assert.equal(itemEntries(get('Breastplate'), 1, blankSheet()).inventory.ac, '14 + Dex (max 2)');
  assert.equal(itemEntries(get('Shield'), 1, blankSheet()).inventory.ac, '+2');
  assert.equal(itemEntries(get('Longsword'), 1, blankSheet()).inventory.ac, undefined);
});

test('ability scores: rolled 4d6 drop lowest on the server, standard array, point buy', async () => {
  const { rollDice } = await import('../server/lib/dice.js');
  // The generator's maths, without React.
  const ROLL_EXPRESSION = Array(6).fill('4d6dl1').join('+');
  const faces = [1, 6, 6, 6, 2, 3, 4, 5, 1, 1, 1, 1, 6, 6, 6, 6, 3, 3, 3, 3, 2, 4, 6, 1];
  let i = 0;
  const r = rollDice(ROLL_EXPRESSION, () => faces[i++]);
  const scores = r.terms.filter(t => t.type === 'dice').map(t => t.subtotal);
  assert.deepEqual(scores, [18, 12, 3, 18, 9, 12]);
  for (let n = 0; n < 200; n++) {
    for (const v of rollDice(ROLL_EXPRESSION).terms.map(t => t.subtotal)) assert.ok(v >= 3 && v <= 18);
  }
  const POINT_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
  const cost = (s) => Object.values(s).reduce((n, v) => n + POINT_COST[v], 0);
  assert.equal(cost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }), 27);
  assert.equal(cost({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }), 27, 'the standard array costs exactly 27');
  // The generator's own constants agree with these.
  const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../client/src/components/ttrpg/ScoreGenerator.jsx'), 'utf8');
  assert.match(src, /STANDARD_ARRAY = \[15, 14, 13, 12, 10, 8\]/);
  assert.match(src, /POINT_COST = \{ 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 \}/);
  assert.match(src, /ROLL_EXPRESSION = Array\(6\)\.fill\('4d6dl1'\)/);
});

test('maps: squares, snapping, 5e distance, fog painting and what players see', async () => {
  const m = await import('../client/src/ttrpg/map.js');
  const grid = { size: 50, offsetX: 10, offsetY: -5 };
  assert.deepEqual(m.cellAt(10, -5, grid), { x: 0, y: 0 });
  assert.deepEqual(m.cellAt(59, 44, grid), { x: 0, y: 0 });
  assert.deepEqual(m.cellAt(60, 45, grid), { x: 1, y: 1 });
  assert.deepEqual(m.cellAt(9, -6, grid), { x: -1, y: -1 });
  assert.deepEqual(m.cellOrigin(2, 3, grid), { x: 110, y: 145 });
  // A 2x2 token dropped with its centre at a square corner covers the four around it.
  assert.deepEqual(m.snapToken(110, 145, 2, grid), { x: 1, y: 2 });
  assert.deepEqual(m.snapToken(135, 170, 1, grid), { x: 2, y: 3 });
  assert.equal(m.squaresBetween({ x: 0, y: 0 }, { x: 3, y: 2 }), 3, 'a diagonal is one square');
  const map = { image: { width: 1000, height: 500 }, grid: { size: 100, offsetX: 0, offsetY: 0 }, fog: { enabled: true, revealed: [] } };
  assert.deepEqual(m.gridSize(map), { cols: 10, rows: 5 });
  map.fog.revealed = m.paintFog([], [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 1 }], true);
  assert.deepEqual(map.fog.revealed, ['1,1', '2,1']);
  assert.deepEqual(m.paintFog(map.fog.revealed, [{ x: 2, y: 1 }], false), ['1,1']);
  const goblin = { x: 5, y: 3, size: 1 };
  assert.equal(m.tokenVisibleToPlayer(goblin, map, 'ann', null), false, 'in the fog');
  assert.equal(m.tokenVisibleToPlayer({ x: 1, y: 1, size: 1 }, map, 'ann', null), true);
  assert.equal(m.tokenVisibleToPlayer({ x: 0, y: 0, size: 2 }, map, 'ann', null), true, 'part of it is in the open');
  assert.equal(m.tokenVisibleToPlayer(goblin, map, 'ann', 'ann'), true, 'your own token always');
  map.fog.enabled = false;
  assert.equal(m.tokenVisibleToPlayer(goblin, map, 'ann', null), true);
});

test('map tokens follow the encounter: whose turn, Bloodied and Down', async () => {
  const m = await import('../client/src/ttrpg/map.js');
  const enc = {
    active: true, round: 2, turn: 'c-gob',
    combatants: [
      { id: 'c-gob', name: 'Goblin 1', kind: 'monster', status: 'bloodied' },
      { id: 'c-kay', name: 'Kaylee', kind: 'pc', sheetId: 'sheet-k', status: null },
      { id: 'c-orc', name: 'Orc', kind: 'monster', status: 'down' },
    ],
  };
  assert.deepEqual(
    (({ turn, status }) => ({ turn, status }))(m.tokenStatus({ combatantId: 'c-gob' }, enc)),
    { turn: true, status: 'bloodied' });
  assert.equal(m.tokenStatus({ combatantId: 'c-orc' }, enc).status, 'down');
  // A character's token, by its sheet; the sheet's HP decides when it can be read.
  assert.equal(m.tokenStatus({ sheetId: 'sheet-k' }, enc).combatant.id, 'c-kay');
  assert.equal(m.tokenStatus({ sheetId: 'sheet-k' }, enc, { 'sheet-k': { hp: { current: 4, max: 10 } } }).status, 'bloodied');
  assert.equal(m.tokenStatus({ sheetId: 'sheet-k' }, enc, { 'sheet-k': { hp: { current: 0, max: 10 } } }).status, 'down');
  assert.equal(m.tokenStatus({ sheetId: 'sheet-k' }, enc, { 'sheet-k': { hp: { current: 8, max: 10 } } }).status, null);
  // Not in the encounter, or no encounter running, or not started: nothing.
  assert.deepEqual(m.tokenStatus({ combatantId: 'nobody' }, enc), { combatant: null, turn: false, status: null });
  assert.equal(m.tokenStatus({ combatantId: 'c-gob' }, { ...enc, active: false }).turn, false);
  assert.equal(m.tokenStatus({ combatantId: 'c-gob' }, { ...enc, round: 0 }).turn, false);
  // The map follows the running encounter touched last.
  const list = [
    { id: 'a', updatedAt: '2026-01-02', body: { active: false } },
    { id: 'b', updatedAt: '2026-01-01', body: { active: true } },
    { id: 'c', updatedAt: '2026-01-03', body: { active: true } },
  ];
  assert.equal(m.currentEncounter(list).id, 'c');
  assert.equal(m.currentEncounter([list[0]]), null);
});
