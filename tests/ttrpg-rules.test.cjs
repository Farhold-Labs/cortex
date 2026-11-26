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
