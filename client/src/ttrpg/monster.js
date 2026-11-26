/**
 * Monster stat blocks (v2.160.0): the GM's own, in the 2024 layout. Each
 * action can carry an attack bonus and damage dice, which become roll buttons.
 */
import { newId, mod } from './dnd5e2024.js';

export function blankMonster(name = '') {
  return {
    schema: 1, name, size: 'Medium', type: 'Humanoid', alignment: '',
    ac: 12, hp: 11, hpFormula: '2d8+2', speed: '30 ft.',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saves: '', skills: '', senses: 'Passive Perception 10', languages: '', cr: '1/4',
    traits: [], actions: [{ id: newId(), name: 'Attack', text: 'Melee Attack Roll', attack: 3, damage: '1d6+1' }],
    bonusActions: [], reactions: [], legendary: [],
  };
}

export const initiativeBonus = (m) => mod(m?.abilities?.dex ?? 10);

/** The average of dice notation like "2d8+2": what 5e prints beside a monster's hit dice. */
export function averageOf(formula) {
  const f = String(formula || '').replace(/\s+/g, '').toLowerCase();
  if (!/^[0-9d+-]+$/.test(f)) return null;
  let total = 0; let ok = false;
  for (const [, sign, n, sides, flat] of f.matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/g)) {
    const s = sign === '-' ? -1 : 1;
    if (sides) { total += s * (Number(n) || 1) * (Number(sides) + 1) / 2; ok = true; }
    else total += s * Number(flat);
  }
  return ok ? Math.max(1, Math.floor(total)) : null;
}

export const SECTIONS = [['traits', 'Traits'], ['actions', 'Actions'], ['bonusActions', 'Bonus actions'], ['reactions', 'Reactions'], ['legendary', 'Legendary actions']];
