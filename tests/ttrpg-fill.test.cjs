'use strict';

// "Fill from the SRD" (v2.163.0): class, subclass, species and background
// features, limited-use features as resources, class skills, starting
// equipment, levelling up, and undo. Run against the real generated SRD data
// for both editions.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const srdDir = path.resolve(__dirname, '../client/src/srd');
const load = (edition, kind) => JSON.parse(fs.readFileSync(path.join(srdDir, edition, `${kind}.json`), 'utf8'));
const srdFor = (edition) => ({
  edition, classes: load(edition, 'classes'), species: load(edition, 'species'), backgrounds: load(edition, 'backgrounds'), equipment: load(edition, 'equipment'),
  featureNames: Object.fromEntries(load(edition, 'features').map(f => [f.id, f.name])),
  traitNames: Object.fromEntries(load(edition, 'traits').map(t => [t.id, t.name])),
  feats: load(edition, 'feats'),
});
const rules = () => import('../client/src/ttrpg/dnd5e2024.js');
const fill = () => import('../client/src/ttrpg/fill.js');
const all = { features: true, resources: true, skills: true, species: true, background: true, equipment: true };

test('every class and level resolves, for both editions', () => {
  for (const edition of ['2014', '2024']) {
    const srd = srdFor(edition);
    assert.equal(srd.classes.length, 12);
    for (const c of srd.classes) {
      for (let lv = 1; lv <= 20; lv++) assert.ok(c.levels[lv], `${edition} ${c.name} ${lv}`);
      for (const id of Object.values(c.levels).flatMap(l => l.features)) assert.ok(srd.featureNames[id], `${edition} ${c.name} feature ${id}`);
      assert.ok(c.subclasses.length >= 1, `${edition} ${c.name} has an SRD subclass`);
    }
    for (const s of srd.species) for (const t of [...s.traits, ...s.subspecies.flatMap(x => x.traits)]) assert.ok(srd.traitNames[t], `${edition} ${s.name} trait ${t}`);
    // Every item starting equipment names is in the equipment list.
    const ids = new Set(srd.equipment.map(e => e.id));
    for (const eq of [...srd.classes.map(c => c.equipment), ...srd.backgrounds.map(b => b.equipment)]) {
      for (const it of [...eq.fixed, ...eq.groups.flatMap(g => g.alternatives.flatMap(a => a.items))]) assert.ok(ids.has(it.id), `${edition} equipment ${it.id}`);
    }
  }
});

test('a 2024 Fighter 5 Champion: features, resources, skills, species, background, equipment', async () => {
  const { blankSheet } = await rules();
  const { planFill, applyFill } = await fill();
  const s = blankSheet('Vex', 'dnd5e-2024');
  s.classes = [{ name: 'Fighter', level: 5, subclass: 'Champion' }];
  s.abilities.con = 14;
  const srd = srdFor('2024');
  const plan = planFill(s, srd, {
    include: all, speciesId: 'dwarf', backgroundId: 'soldier', skills: ['athletics', 'perception', 'history'],
    equipment: { class: [{ alt: 0 }], background: [{ alt: 0 }] },
  });
  const names = plan.features.map(f => f.name);
  for (const n of ['Second Wind', 'Action Surge', 'Extra Attack', 'Improved Critical']) assert.ok(names.includes(n), `${n} in ${names}`);
  assert.equal(names.filter(n => n === 'Ability Score Improvement').length, 1);
  const res = Object.fromEntries(plan.resources.map(r => [r.name, r]));
  assert.equal(res['Second Wind'].max, 3); assert.equal(res['Action Surge'].max, 1); assert.equal(res['Action Surge'].reset, 'short');
  assert.equal(res.Indomitable, undefined);
  // Two class skills, not three; the background's added.
  assert.deepEqual(plan.skills.filter(k => ['athletics', 'perception', 'history'].includes(k)).length, 2);
  assert.ok(plan.items.length > 5 && plan.gp > 0);
  applyFill(s, plan);
  assert.equal(s.species, 'Dwarf'); assert.equal(s.speed, 30); assert.equal(s.background, 'Soldier');
  assert.ok(s.featureList.some(f => f.source === 'Dwarf'));
  assert.ok(s.attacks.some(a => a.name === 'Greatsword'), 'a weapon from the kit becomes an attack');
  assert.ok(!s.inventory.some(i => /Pack$/.test(i.name)), 'packs are unpacked');
  // Filling again adds nothing twice.
  const again = planFill(s, srd, { include: { features: true }, speciesId: 'dwarf' });
  assert.equal(again.features.length, 0);
});

test('levelling up adds only the new level, and resources grow', async () => {
  const { blankSheet } = await rules();
  const { planFill, applyFill } = await fill();
  const srd = srdFor('2014');
  const s = blankSheet('Gruk', 'dnd5e-2014');
  s.classes = [{ name: 'Barbarian', level: 2, subclass: '' }];
  applyFill(s, planFill(s, srd, { include: { features: true, resources: true } }));
  const rage = () => s.resources.find(r => r.name === 'Rage');
  assert.equal(rage().max, 2); s.resources.find(r => r.name === 'Rage').current = 1;
  const before = s.featureList.length;
  s.classes[0].level = 3;
  const plan = planFill(s, srd, { include: { features: true, resources: true }, onlyLevel: { 0: 3 }, subclasses: { 0: 'berserker' } });
  assert.deepEqual(plan.features.map(f => f.name).sort(), ['Frenzy', 'Primal Path'].sort());
  applyFill(s, plan);
  assert.equal(s.featureList.length, before + 2);
  assert.equal(rage().max, 3); assert.equal(rage().current, 2, 'the extra use is added to what was left');
  assert.equal(s.classes[0].subclass, 'Berserker');
});

test('resources follow each edition\'s rules', async () => {
  const { blankSheet, derive } = await rules();
  const { classResources } = await fill();
  const s = blankSheet(); s.abilities.cha = 16; const d = derive(s);
  const r = (ed, cls, lv, counters) => Object.fromEntries(classResources(ed, cls, lv, counters, d).map(x => [x.name, x]));
  assert.equal(r('2014', 'barbarian', 20, { rage_count: 9999 }).Rage, undefined, 'unlimited rages are not a counter');
  assert.equal(r('2014', 'bard', 4, {})['Bardic Inspiration'].reset, 'long');
  assert.equal(r('2014', 'bard', 5, {})['Bardic Inspiration'].reset, 'short');
  assert.equal(r('2014', 'bard', 5, {})['Bardic Inspiration'].max, 3);
  assert.equal(r('2014', 'paladin', 4, {})['Lay on Hands (HP pool)'].max, 20);
  assert.equal(r('2014', 'paladin', 4, {})['Divine Sense'].max, 4);
  assert.equal(r('2024', 'cleric', 2, { channel_divinity_charges: 2 })['Channel Divinity'].note, 'one back on a short rest');
  assert.equal(r('2024', 'fighter', 13, { second_wind_uses: 4 }).Indomitable.max, 2);
  assert.equal(r('2014', 'monk', 1, { ki_points: 0 }).Ki, undefined);
  assert.equal(r('2014', 'warlock', 11, { mystic_arcanum_level_6: 1 })['Mystic Arcanum (level 6)'].max, 1);
});

test('undo takes a fill back out and leaves later changes alone', async () => {
  const { blankSheet } = await rules();
  const { planFill, applyFill, undoFill } = await fill();
  const s = blankSheet('Undo me', 'dnd5e-2014');
  s.classes = [{ name: 'Rogue', level: 1, subclass: '' }];
  s.inventory = [{ id: 'mine', name: 'Lucky coin', qty: 1 }];
  s.currency.gp = 3;
  const plan = planFill(s, srdFor('2014'), { include: all, speciesId: 'halfling', backgroundId: 'acolyte', skills: ['stealth', 'acrobatics'], applyBonuses: true });
  const u = applyFill(s, plan);
  assert.equal(s.abilities.dex, 12);
  assert.ok(s.currency.gp > 3);
  s.notes = 'written after';
  undoFill(s, u);
  assert.deepEqual(s.featureList, []); assert.deepEqual(s.inventory.map(i => i.id), ['mine']);
  assert.equal(s.currency.gp, 3); assert.equal(s.abilities.dex, 10); assert.equal(s.species, ''); assert.deepEqual(s.skills, {});
  assert.equal(s.notes, 'written after');
});

test('hit points: the whole die at level 1, the fixed value after, Constitution each level', async () => {
  const { levelUpHp, startingHp } = await fill();
  const { blankSheet } = await rules();
  const s = blankSheet('', 'dnd5e-2024'); s.abilities.con = 14;
  s.classes = [{ name: 'Fighter', level: 3 }, { name: 'Wizard', level: 2 }];
  // Fighter 10+2, then 6+2, 6+2; Wizard 4+2, 4+2
  assert.equal(startingHp(s, srdFor('2024')), 12 + 8 + 8 + 6 + 6);
  s.classes = [{ name: 'Artificer', level: 1 }];
  assert.equal(startingHp(s, srdFor('2024')), null);
  assert.equal(levelUpHp(10, 14), 8); assert.equal(levelUpHp(6, 8), 3); assert.equal(levelUpHp(6, 1), 1);
});

test('ability score improvements: +2, +1/+1, a feat (and its +1), capped; Epic Boons to 30', async () => {
  const { blankSheet } = await rules();
  const { planFill, applyFill, applyAsiChoice, featOptions, asiChoiceValid } = await fill();
  const srd = srdFor('2024');
  const s = blankSheet('Asi', 'dnd5e-2024');
  s.classes = [{ name: 'Fighter', level: 6, subclass: '' }];
  s.abilities.str = 19; s.abilities.dex = 14;
  const plan = planFill(s, srd, { include: { features: true } });
  assert.equal(plan.asi.length, 2, 'Fighter 6 has two (4 and 6)');
  const [first, second] = plan.asi;
  // One chosen now (+2 STR stops at 20), one left for later.
  const p2 = planFill(s, srd, { include: { features: true }, asi: { [first.key]: { mode: 'plus2', a: 'str' } } });
  applyFill(s, p2);
  assert.equal(s.abilities.str, 20);
  const chosen = s.featureList.find(f => f.key === first.key);
  assert.equal(chosen.choice, '+2 STR'); assert.equal(chosen.pending, false);
  const later = s.featureList.find(f => f.key === second.key);
  assert.equal(later.pending, true);
  // Later: Grappler, +1 DEX.
  const feats = featOptions(srd.feats, s, 'asi', 6).map(f => f.name);
  assert.ok(feats.includes('Grappler') && !feats.includes('Alert') && !feats.some(n => n.startsWith('Boon')), feats.join());
  assert.equal(asiChoiceValid({ mode: 'feat', feat: 'feat-grappler' }, srd.feats), false, 'Grappler needs its +1 chosen');
  assert.equal(asiChoiceValid({ mode: 'plus1x2', a: 'dex', b: 'dex' }, srd.feats), false);
  applyAsiChoice(s, later.id, { mode: 'feat', feat: 'feat-grappler', featAbility: 'dex' }, srd.feats);
  assert.equal(s.abilities.dex, 15);
  assert.ok(s.featureList.some(f => f.name === 'Feat: Grappler'));
  assert.ok(!featOptions(srd.feats, s, 'asi', 6).some(f => f.name === 'Grappler'), 'not twice');
  // An Epic Boon may take a score to 30.
  s.abilities.con = 20;
  const boons = featOptions(srd.feats, s, 'boon', 19);
  assert.ok(boons.some(f => f.type === 'epic-boon'));
  s.featureList.push({ id: 'b1', key: 'class:fighter:19:fighter-epic-boon', srd: 'fighter-epic-boon', name: 'Epic Boon', source: 'Fighter 19' });
  applyAsiChoice(s, 'b1', { mode: 'feat', feat: 'feat-boon-of-fate', featAbility: 'con' }, srd.feats);
  assert.equal(s.abilities.con, 21);
});

test('2014: Grappler only with STR 13', async () => {
  const { blankSheet } = await rules();
  const { featOptions } = await fill();
  const s = blankSheet('', 'dnd5e-2014'); s.abilities.str = 12;
  assert.equal(featOptions(srdFor('2014').feats, s, 'asi', 4).find(f => f.name === 'Grappler').meetsScores, false);
  s.abilities.str = 13;
  assert.equal(featOptions(srdFor('2014').feats, s, 'asi', 4).find(f => f.name === 'Grappler').meetsScores, true);
});

test('multiclassing: prerequisites both ways, the class\'s skill choice and proficiencies', async () => {
  const { blankSheet } = await rules();
  const { planFill, applyFill, multiclassCheck } = await fill();
  const srd = srdFor('2014');
  const s = blankSheet('Mc', 'dnd5e-2014');
  s.classes = [{ name: 'Wizard', level: 3, subclass: '' }];
  s.abilities.int = 12; s.abilities.dex = 14;
  assert.deepEqual(multiclassCheck(s, srd, 'rogue'), ['Wizard needs INT 13']);
  s.abilities.int = 15;
  assert.deepEqual(multiclassCheck(s, srd, 'rogue'), []);
  s.abilities.dex = 12;
  assert.deepEqual(multiclassCheck(s, srd, 'fighter'), ['Fighter needs STR 13 or DEX 13']);
  s.abilities.dex = 13;
  assert.deepEqual(multiclassCheck(s, srd, 'fighter'), []);
  // Add Rogue 1: Expertise and Sneak Attack, one skill from its list, light armour and thieves' tools.
  s.classes.push({ name: 'Rogue', level: 1, subclass: '' });
  const plan = planFill(s, srd, { include: { features: true, resources: true, skills: true }, onlyLevel: { 1: 1 }, mcSkills: { 1: ['stealth', 'perception'] } });
  assert.ok(plan.features.some(f => f.name === 'Sneak Attack'));
  // The Wizard's features aren't on this sheet, but adding a Rogue level doesn't add them (it used to).
  assert.ok(!plan.features.some(f => f.source.startsWith('Wizard')), 'only the new class\'s level');
  assert.deepEqual(plan.skills, ['stealth'], 'a multiclass Rogue gets one skill');
  applyFill(s, plan);
  assert.match(s.proficiencies, /Rogue \(multiclass\): Light Armor, Thieves' Tools/);
  // Not added twice when filled again.
  assert.equal(planFill(s, srd, { include: { features: true } }).proficiencyLines.length, 0);
});
