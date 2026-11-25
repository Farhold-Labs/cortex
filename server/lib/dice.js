/**
 * Dice notation and rolling (v2.158.0, docs/ttrpg/README.md).
 *
 * The server rolls: a roll made on a player's device can be faked. This module
 * parses the notation, refuses anything outside the limits, and rolls with
 * crypto.randomInt. It has no I/O; the route stores what it returns.
 *
 *   d20, 3d6, d%            dice (d% is d100)
 *   2d6+1d4+3, 1d8-1        several groups and flat modifiers
 *   adv, dis                2d20kh1, 2d20kl1
 *   4d6kh3 4d6k3 kl dh dl   keep or drop the highest or lowest
 *   2d6r1 2d6ro1 2d6r<2     reroll faces at or under a number (always / once)
 *
 * Spaces are allowed around + and -. Case is ignored.
 */

import crypto from 'crypto';

export const LIMITS = { maxDice: 100, maxSides: 1000, maxLength: 100, maxTerms: 20, maxModifier: 10000 };

export class DiceError extends Error {
  constructor(message) { super(message); this.code = 'INVALID_DICE'; }
}

const TERM = /^(?:(adv|dis)|(\d*)d(\d+|%)((?:(?:kh|kl|dh|dl|k)\d*|ro?<?\d+)*)|(\d+))/i;

/** Parse notation into terms, or throw DiceError. */
export function parseDice(input) {
  if (typeof input !== 'string') throw new DiceError('Dice notation must be text');
  if (input.length > LIMITS.maxLength) throw new DiceError(`Dice notation is limited to ${LIMITS.maxLength} characters`);
  // Spaces are allowed around + and -, nowhere else: "1d20 5" is a mistake, not a d205.
  let rest = input.trim().replace(/\s*([+-])\s*/g, '$1').toLowerCase();
  if (/\s/.test(rest)) throw new DiceError(`Expected + or - between "${rest.split(/\s+/).slice(0, 2).join('" and "')}"`);
  if (!rest) throw new DiceError('No dice to roll');
  const terms = [];
  let totalDice = 0;
  let first = true;
  while (rest) {
    let sign = 1;
    if (rest[0] === '+' || rest[0] === '-') { sign = rest[0] === '-' ? -1 : 1; rest = rest.slice(1); }
    else if (!first) throw new DiceError(`Expected + or - before "${rest.slice(0, 8)}"`);
    const m = TERM.exec(rest);
    if (!m) throw new DiceError(`Not dice notation: "${rest.slice(0, 12)}"`);
    rest = rest.slice(m[0].length);
    first = false;
    if (terms.length >= LIMITS.maxTerms) throw new DiceError(`At most ${LIMITS.maxTerms} parts in one roll`);
    if (m[1]) {
      terms.push({ type: 'dice', sign, count: 2, sides: 20, keep: { which: m[1] === 'adv' ? 'high' : 'low', n: 1 }, reroll: null, source: m[1] });
      totalDice += 2;
    } else if (m[3]) {
      const count = m[2] === '' ? 1 : Number(m[2]);
      const sides = m[3] === '%' ? 100 : Number(m[3]);
      if (count < 1) throw new DiceError('Roll at least one die');
      if (sides < 2) throw new DiceError('A die needs at least two sides');
      if (sides > LIMITS.maxSides) throw new DiceError(`Dice have at most ${LIMITS.maxSides} sides`);
      const term = { type: 'dice', sign, count, sides, keep: null, reroll: null, source: m[0] };
      for (const [, op, n] of m[4].matchAll(/(kh|kl|dh|dl|k|ro?<?)(\d*)/g)) {
        if (op.startsWith('r')) {
          if (term.reroll) throw new DiceError('Only one reroll rule per die');
          const at = Number(n);
          if (!n || at < 1 || at >= sides) throw new DiceError('Reroll needs a face between 1 and one less than the die');
          term.reroll = { atOrBelow: at, once: op.startsWith('ro') };
        } else {
          if (term.keep) throw new DiceError('Only one keep or drop rule per die');
          const k = n === '' ? 1 : Number(n);
          const which = { k: 'high', kh: 'high', kl: 'low', dh: 'dropHigh', dl: 'dropLow' }[op];
          if (k < 1 || k > count || ((which === 'dropHigh' || which === 'dropLow') && k >= count)) {
            throw new DiceError(`Can't ${op.startsWith('d') ? 'drop' : 'keep'} ${k} of ${count} dice`);
          }
          term.keep = { which, n: k };
        }
      }
      totalDice += count;
      terms.push(term);
    } else {
      const value = Number(m[5]);
      if (value > LIMITS.maxModifier) throw new DiceError(`Modifiers are at most ${LIMITS.maxModifier}`);
      terms.push({ type: 'mod', sign, value, source: m[5] });
    }
    if (totalDice > LIMITS.maxDice) throw new DiceError(`At most ${LIMITS.maxDice} dice in one roll`);
  }
  if (!terms.some(t => t.type === 'dice')) throw new DiceError('No dice to roll');
  return terms;
}

/** The canonical spelling of parsed terms, e.g. "2d20kh1+5". */
export function formatDice(terms) {
  return terms.map((t, i) => {
    const sign = t.sign < 0 ? '-' : (i ? '+' : '');
    if (t.type === 'mod') return sign + t.value;
    const keep = t.keep ? ({ high: 'kh', low: 'kl', dropHigh: 'dh', dropLow: 'dl' }[t.keep.which] + t.keep.n) : '';
    const reroll = t.reroll ? `${t.reroll.once ? 'ro' : 'r'}${t.reroll.atOrBelow}` : '';
    return `${sign}${t.count}d${t.sides}${keep}${reroll}`;
  }).join('');
}

const defaultRandom = (sides) => crypto.randomInt(1, sides + 1);

/**
 * Roll notation. `random(sides)` is injectable for tests only; the routes
 * never pass it. Returns { expression, terms, total, crit }.
 *   terms[i].dice: [{ value, kept, rerolled: [earlier faces] }] for dice terms
 *   crit: 'success' or 'failure' for a lone d20 kept as one die (5e), else null
 */
export function rollDice(input, random = defaultRandom) {
  const terms = parseDice(input);
  let total = 0;
  const out = terms.map((t) => {
    if (t.type === 'mod') { total += t.sign * t.value; return { type: 'mod', sign: t.sign, value: t.value }; }
    const dice = [];
    for (let i = 0; i < t.count; i++) {
      let value = random(t.sides);
      const rerolled = [];
      if (t.reroll) {
        // "r" rerolls until above the face (capped so a bad rule can't spin);
        // "ro" rerolls once and keeps the second.
        let guard = 0;
        while (value <= t.reroll.atOrBelow && guard < 100) {
          rerolled.push(value);
          value = random(t.sides);
          guard++;
          if (t.reroll.once) break;
        }
      }
      dice.push({ value, kept: true, rerolled });
    }
    if (t.keep) {
      const order = dice.map((d, i) => i).sort((a, b) => dice[a].value - dice[b].value || a - b);
      let drop;
      if (t.keep.which === 'high') drop = order.slice(0, t.count - t.keep.n);
      else if (t.keep.which === 'low') drop = order.slice(t.keep.n);
      else if (t.keep.which === 'dropLow') drop = order.slice(0, t.keep.n);
      else drop = order.slice(t.count - t.keep.n);
      for (const i of drop) dice[i].kept = false;
    }
    const subtotal = dice.filter(d => d.kept).reduce((s, d) => s + d.value, 0);
    total += t.sign * subtotal;
    return { type: 'dice', sign: t.sign, count: t.count, sides: t.sides, keep: t.keep, reroll: t.reroll, dice, subtotal };
  });
  const diceTerms = out.filter(t => t.type === 'dice');
  let crit = null;
  if (diceTerms.length === 1 && diceTerms[0].sides === 20 && diceTerms[0].sign > 0) {
    const kept = diceTerms[0].dice.filter(d => d.kept);
    if (kept.length === 1) crit = kept[0].value === 20 ? 'success' : kept[0].value === 1 ? 'failure' : null;
  }
  return { expression: formatDice(terms), terms: out, total, crit };
}
