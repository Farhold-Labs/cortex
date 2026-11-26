/**
 * Fill a 5e sheet from the SRD (v2.163.0): class and subclass features by
 * level, species traits, a background, limited-use features as resources,
 * class skills and starting equipment. It only adds (never replaces what a
 * player wrote) and keeps a record so it can be undone.
 *
 * The SRD data comes from client/src/srd (tools/build-srd.mjs). The resource
 * rules below are this file's reading of the class tables in SRD 5.1 (2014)
 * and 5.2 (2024): which features are limited-use, how many, and which rest
 * brings them back.
 */
import { derive, newId, mod } from './dnd5e2024.js';

const ONE_BACK = 'one back on a short rest';

/** Limited-use features for one class at a level. */
export function classResources(edition, classId, level, counters = {}, d) {
  const L = Number(level) || 0;
  const cha = Math.max(1, d.mods.cha);
  const out = [];
  const add = (name, max, reset, note = '') => { if (Number.isFinite(max) && max > 0 && max < 100) out.push({ name, max, reset, note }); };
  if (edition === '2014') {
    if (classId === 'barbarian') add('Rage', counters.rage_count, 'long');
    if (classId === 'bard') add('Bardic Inspiration', cha, L >= 5 ? 'short' : 'long');
    if (classId === 'cleric') add('Channel Divinity', counters.channel_divinity_charges, 'short');
    if (classId === 'druid' && L >= 2 && L < 20) add('Wild Shape', 2, 'short');
    if (classId === 'fighter') { add('Second Wind', 1, 'short'); add('Action Surge', counters.action_surges, 'short'); add('Indomitable', counters.indomitable_uses, 'long'); }
    if (classId === 'monk') add('Ki', counters.ki_points, 'short');
    if (classId === 'paladin') { add('Divine Sense', 1 + Math.max(0, d.mods.cha), 'long'); add('Lay on Hands (HP pool)', 5 * L, 'long'); if (L >= 3) add('Channel Divinity', 1, 'short'); }
    if (classId === 'sorcerer') add('Sorcery Points', counters.sorcery_points, 'long');
    if (classId === 'warlock') for (const n of [6, 7, 8, 9]) add(`Mystic Arcanum (level ${n})`, counters[`mystic_arcanum_level_${n}`], 'long');
    if (classId === 'wizard') add('Arcane Recovery', 1, 'long');
  } else {
    if (classId === 'barbarian') add('Rage', counters.rage_count, 'long', ONE_BACK);
    if (classId === 'bard') add('Bardic Inspiration', cha, L >= 5 ? 'short' : 'long');
    if (classId === 'cleric') add('Channel Divinity', counters.channel_divinity_charges, 'long', ONE_BACK);
    if (classId === 'druid') add('Wild Shape', counters.wild_shape_uses, 'long', ONE_BACK);
    if (classId === 'fighter') {
      add('Second Wind', counters.second_wind_uses, 'long', ONE_BACK);
      if (L >= 2) add('Action Surge', L >= 17 ? 2 : 1, 'short');
      if (L >= 9) add('Indomitable', L >= 17 ? 3 : L >= 13 ? 2 : 1, 'long');
    }
    if (classId === 'monk') add('Focus Points', counters.focus_points, 'short');
    if (classId === 'paladin') { add('Lay on Hands (HP pool)', 5 * L, 'long'); add('Channel Divinity', counters.channel_divinity_charges, 'long', ONE_BACK); }
    if (classId === 'ranger') add("Favored Enemy (free Hunter's Mark)", counters.favored_enemies, 'long');
    if (classId === 'sorcerer') add('Sorcery Points', counters.sorcery_points, 'long');
    if (classId === 'wizard') add('Arcane Recovery', 1, 'long');
  }
  return out;
}

const classIdOf = (name) => String(name || '').trim().toLowerCase();
export const subclassFirstLevel = (cls) => Math.min(...(cls?.subclasses || []).flatMap(s => Object.keys(s.levels).map(Number)), 99);

/** The SRD subclass a sheet's class row means, by name, if any. */
export function matchSubclass(cls, text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t || !cls) return null;
  return cls.subclasses.find(s => s.name.toLowerCase() === t || s.name.toLowerCase().includes(t) || t.includes(s.name.toLowerCase())) || null;
}

/** An inventory entry (and, for a weapon, an attack) for an SRD equipment item. */
export function itemEntries(x, qty, sheet) {
  const inventory = {
    id: newId(), name: x.name, qty, weight: Number(x.weight) || 0, equipped: false, srd: x.id,
    notes: [x.cost, x.damage && `${x.damage} ${x.damageType}`.trim(), x.ac && `AC ${x.ac}`, (x.properties || []).join(', ')].filter(Boolean).join(' · '),
  };
  let attack = null;
  if (x.weapon && x.damage) {
    const dd = derive(sheet);
    const ability = x.finesse ? (dd.mods.dex >= dd.mods.str ? 'dex' : 'str') : x.ranged ? 'dex' : 'str';
    attack = {
      id: newId(), name: x.name, ability, proficient: true, bonus: 0, damage: x.damage, damageType: (x.damageType || '').toLowerCase(),
      damageAbility: true, damageBonus: 0,
      notes: [(x.properties || []).join(', '), x.range, x.mastery && `Mastery: ${x.mastery}`, x.versatile && `Two-handed ${x.versatile}`].filter(Boolean).join(' · '),
    };
  }
  return { inventory, attack };
}

/**
 * What a fill would add, without changing anything.
 *   srd: { classes, species, backgrounds, equipment } for the sheet's edition
 *   choices: {
 *     include: { features, resources, species, background, equipment, skills },
 *     subclasses: { [classRowIndex]: subclassId | '' },
 *     speciesId, subspeciesId, backgroundId, applyBonuses,
 *     skills: [skill keys], equipment: { class: [{ alt, picks: [itemId] }], background: [...] },
 *     onlyLevel: { [classRowIndex]: level }   // level-up: only that level's features
 *   }
 */
export function planFill(sheet, srd, choices) {
  const inc = choices.include || {};
  const have = new Set((sheet.featureList || []).map(f => f.key));
  const plan = { features: [], resources: [], items: [], attacks: [], gp: 0, skills: [], speciesName: null, background: null, speed: null, size: null, abilityBonuses: null, tools: [], subclassNames: {} };
  const d = derive(sheet);
  const feature = (key, srdId, name, source) => { if (!have.has(key) && !plan.features.some(f => f.key === key)) plan.features.push({ id: newId(), key, srd: srdId, name, source }); };

  (sheet.classes || []).forEach((row, i) => {
    const cls = srd.classes.find(c => c.id === classIdOf(row.name));
    if (!cls) return;
    const L = Math.max(1, Math.min(20, Number(row.level) || 1));
    const from = choices.onlyLevel?.[i] || 1;
    const sub = choices.subclasses?.[i] !== undefined
      ? cls.subclasses.find(s => s.id === choices.subclasses[i]) || null
      : matchSubclass(cls, row.subclass);
    if (sub && !row.subclass) plan.subclassNames[i] = sub.name;
    if (inc.features) {
      for (let lv = from; lv <= L; lv++) {
        for (const fid of cls.levels[lv]?.features || []) feature(`class:${cls.id}:${lv}:${fid}`, fid, srd.featureNames[fid] || fid, `${cls.name} ${lv}`);
        for (const fid of sub?.levels[lv] || []) feature(`sub:${sub.id}:${lv}:${fid}`, fid, srd.featureNames[fid] || fid, `${sub.name} ${lv}`);
      }
    }
    if (inc.resources) {
      for (const r of classResources(srd.edition, cls.id, L, cls.levels[L]?.counters || {}, d)) {
        if (!plan.resources.some(x => x.name === r.name)) plan.resources.push({ ...r, source: cls.name });
      }
    }
    if (i === 0 && inc.skills) plan.skills.push(...(choices.skills || []).filter(k => cls.skills?.from.includes(k)).slice(0, cls.skills?.choose || 0));
    if (i === 0 && inc.equipment) collectEquipment(cls.equipment, choices.equipment?.class, srd, plan);
  });

  if (inc.species && choices.speciesId) {
    const sp = srd.species.find(x => x.id === choices.speciesId);
    if (sp) {
      const sub = sp.subspecies.find(x => x.id === choices.subspeciesId) || null;
      plan.speciesName = sub ? `${sp.name} (${sub.name.replace(/^.*?:\s*/, '')})` : sp.name;
      plan.speed = sp.speed; plan.size = sp.size;
      for (const t of [...sp.traits, ...(sub?.traits || [])]) feature(`trait:${t}`, t, srd.traitNames[t] || t, sp.name);
      const bonuses = [sp.abilityBonuses, sub?.abilityBonuses].filter(Boolean).join(', ');
      if (bonuses && choices.applyBonuses) plan.abilityBonuses = bonuses;
    }
  }
  if (inc.background && choices.backgroundId) {
    const bg = srd.backgrounds.find(x => x.id === choices.backgroundId);
    if (bg) {
      plan.background = bg.name;
      if (bg.feature) feature(`bg:${bg.feature}`, bg.feature, srd.featureNames[bg.feature] || bg.feature, `${bg.name}${bg.featNote ? ` (${bg.featNote})` : ''}`);
      plan.skills.push(...bg.skills);
      plan.tools.push(...bg.tools);
      if (inc.equipment) { collectEquipment(bg.equipment, choices.equipment?.background, srd, plan); plan.gp += bg.equipment.gp || 0; }
    }
  }
  plan.skills = [...new Set(plan.skills)].filter(k => !(Number(sheet.skills?.[k]) > 0));
  if (inc.hp) plan.hpMax = startingHp(sheet, srd);
  return plan;
}

function collectEquipment(eq, chosen = [], srd, plan) {
  const byId = new Map(srd.equipment.map(x => [x.id, x]));
  const add = (id, qty) => {
    const x = byId.get(id);
    if (!x) { plan.items.push({ name: id, qty }); return; }
    // A pack is its contents, so their weight counts.
    if (x.contents?.length) { for (const c of x.contents) add(c.id, c.qty * qty); return; }
    plan.items.push({ srdItem: x, qty });
  };
  for (const it of eq?.fixed || []) add(it.id, it.qty);
  (eq?.groups || []).forEach((g, gi) => {
    const pick = chosen?.[gi];
    const alt = g.alternatives[pick?.alt ?? 0];
    if (!alt) return;
    for (const it of alt.items) add(it.id, it.qty);
    alt.picks.forEach((p, pi) => { const id = pick?.picks?.[pi]; if (id) add(id, p.count); });
    plan.gp += alt.gp || 0;
  });
}

/** Apply a plan to a sheet (inside change()); returns what to undo. */
export function applyFill(s, plan) {
  const undo = { featureIds: [], resourceIds: [], resourcePrev: {}, itemIds: [], attackIds: [], prev: {} };
  undo.prev = {
    species: s.species, speed: s.speed, size: s.size, background: s.background, skills: { ...(s.skills || {}) },
    gp: s.currency?.gp || 0, proficiencies: s.proficiencies, abilities: { ...s.abilities }, hp: { ...(s.hp || {}) },
    subclasses: (s.classes || []).map(c => c.subclass),
  };
  s.featureList = [...(s.featureList || []), ...plan.features];
  undo.featureIds = plan.features.map(f => f.id);
  s.resources = [...(s.resources || [])];
  for (const r of plan.resources) {
    const at = s.resources.findIndex(x => String(x.name).toLowerCase() === r.name.toLowerCase());
    if (at >= 0) {
      const old = s.resources[at];
      undo.resourcePrev[old.id] = { max: old.max, current: old.current, reset: old.reset };
      const grow = Math.max(0, r.max - (Number(old.max) || 0));
      s.resources[at] = { ...old, max: r.max, current: Math.min(r.max, (Number(old.current) || 0) + grow), reset: r.reset, note: r.note || old.note };
    } else {
      const id = newId();
      s.resources.push({ id, name: r.name, current: r.max, max: r.max, reset: r.reset, note: r.note || '' });
      undo.resourceIds.push(id);
    }
  }
  for (const it of plan.items) {
    if (it.srdItem) {
      const { inventory, attack } = itemEntries(it.srdItem, it.qty, s);
      s.inventory = [...(s.inventory || []), inventory]; undo.itemIds.push(inventory.id);
      if (attack) { s.attacks = [...(s.attacks || []), attack]; undo.attackIds.push(attack.id); }
    } else {
      const id = newId();
      s.inventory = [...(s.inventory || []), { id, name: it.name, qty: it.qty, weight: 0, equipped: false, notes: '' }];
      undo.itemIds.push(id);
    }
  }
  if (plan.gp) s.currency = { ...(s.currency || {}), gp: (Number(s.currency?.gp) || 0) + plan.gp };
  if (plan.skills.length) s.skills = { ...(s.skills || {}), ...Object.fromEntries(plan.skills.map(k => [k, 1])) };
  if (plan.speciesName) { s.species = plan.speciesName; s.speed = plan.speed; s.size = plan.size; }
  if (plan.background) s.background = plan.background;
  if (plan.tools.length) s.proficiencies = [s.proficiencies, `Tools: ${plan.tools.join(', ')}`].filter(Boolean).join('\n');
  if (plan.abilityBonuses) {
    for (const part of plan.abilityBonuses.split(',')) {
      const m = part.trim().match(/^([A-Z]{3}) \+(\d+)$/);
      if (m) { const k = m[1].toLowerCase(); s.abilities = { ...s.abilities, [k]: Math.min(30, (Number(s.abilities[k]) || 10) + Number(m[2])) }; }
    }
  }
  if (plan.hpMax) s.hp = { ...(s.hp || {}), max: plan.hpMax, current: plan.hpMax };
  for (const [i, name] of Object.entries(plan.subclassNames || {})) if (s.classes?.[i] && !s.classes[i].subclass) s.classes[i] = { ...s.classes[i], subclass: name };
  return undo;
}

/** Take a fill back out. Anything changed since is kept. */
export function undoFill(s, undo) {
  const gone = (list, ids) => (list || []).filter(x => !ids.includes(x.id));
  s.featureList = gone(s.featureList, undo.featureIds);
  s.resources = gone(s.resources, undo.resourceIds).map(r => (undo.resourcePrev[r.id] ? { ...r, ...undo.resourcePrev[r.id] } : r));
  s.inventory = gone(s.inventory, undo.itemIds);
  s.attacks = gone(s.attacks, undo.attackIds);
  const p = undo.prev;
  Object.assign(s, { species: p.species, speed: p.speed, size: p.size, background: p.background, skills: p.skills, proficiencies: p.proficiencies, abilities: p.abilities, hp: p.hp });
  s.currency = { ...(s.currency || {}), gp: p.gp };
  (s.classes || []).forEach((c, i) => { if (p.subclasses[i] !== undefined) c.subclass = p.subclasses[i]; });
}

/**
 * Maximum hit points by the book: the first class's whole hit die at level 1,
 * then the fixed value (half the die + 1) for every other level, plus the
 * Constitution modifier each level (at least 1 a level).
 */
export function startingHp(sheet, srd) {
  const con = mod(sheet.abilities?.con);
  let total = 0; let first = true;
  for (const row of sheet.classes || []) {
    const cls = srd.classes.find(c => c.id === classIdOf(row.name));
    if (!cls) return null;
    for (let lv = 1; lv <= (Number(row.level) || 1); lv++) {
      total += Math.max(1, (first ? cls.hitDie : Math.floor(cls.hitDie / 2) + 1) + con);
      first = false;
    }
  }
  return total || null;
}

/** Hit points for a level gained: the fixed value (half the die + 1), plus CON. */
export function levelUpHp(hitDie, conScore) {
  return Math.max(1, Math.floor(hitDie / 2) + 1 + mod(conScore));
}
