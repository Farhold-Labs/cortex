/**
 * Encounters (v2.160.0, docs/ttrpg/README.md phase 3). Two documents each:
 *  - the encounter, which the whole table reads: its name, the round, whose
 *    turn it is, and the order (names, initiative, conditions, and a monster's
 *    state as Bloodied or Down, never its hit points);
 *  - the GMs' half: each monster's hit points and AC, and combatants the GM
 *    hasn't revealed yet.
 * Only GMs write either. Players' initiative rolls carry a ref
 * (`enc:<encounter>:<combatant>`), which the GM's device finds and fills in.
 */
import { newId } from './dnd5e2024.js';

export function blankEncounter(name, gmDocId) {
  return { schema: 1, name: name || 'Encounter', active: true, round: 0, turn: null, gmDocId, combatants: [] };
}
export function blankEncounterGm(encounterId) {
  return { schema: 1, encounterId, stats: {}, hidden: [] };
}

export function combatant({ name, kind = 'other', ownerId = null, sheetId = null, monsterId = null, initBonus = 0 }) {
  return { id: newId(), name, kind, ownerId, sheetId, monsterId, initBonus: Number(initBonus) || 0, initiative: null, conditions: [], status: null };
}

export const initiativeRef = (encounterId, combatantId) => `enc:${encounterId}:${combatantId}`;
export const encounterRefPrefix = (encounterId) => `enc:${encounterId}:`;

/** 5e 2024: Bloodied at half hit points or fewer. */
export function statusFromHp(hp, max) {
  const h = Number(hp) || 0; const m = Number(max) || 0;
  if (m > 0 && h <= 0) return 'down';
  if (m > 0 && h <= m / 2) return 'bloodied';
  return null;
}

/** Highest initiative first; ties by initiative bonus, then the order they were added. Unrolled last. */
export function sortByInitiative(list) {
  return list.map((c, i) => [c, i]).sort(([a, ai], [b, bi]) => {
    const an = a.initiative == null ? -Infinity : a.initiative;
    const bn = b.initiative == null ? -Infinity : b.initiative;
    return bn - an || (b.initBonus || 0) - (a.initBonus || 0) || ai - bi;
  }).map(([c]) => c);
}

// Down monsters lose their turn; a PC at 0 HP still has one (death saves).
const takesTurn = (c) => !(c.status === 'down' && c.kind === 'monster');

/** Move to the next turn (or start round 1). Changes the encounter in place. */
export function nextTurn(e) {
  const list = e.combatants; const n = list.length;
  if (!list.some(takesTurn)) return e;
  if (!e.round || e.turn == null) { e.round = 1; e.turn = list.find(takesTurn).id; return e; }
  let i = list.findIndex(c => c.id === e.turn); let round = e.round;
  for (let step = 0; step < n; step++) {
    i++;
    if (i >= n) { i = 0; round++; }
    if (takesTurn(list[i])) { e.turn = list[i].id; e.round = round; return e; }
  }
  return e;
}

export function previousTurn(e) {
  const list = e.combatants; const n = list.length;
  if (!e.round || e.turn == null || !n) return e;
  let i = list.findIndex(c => c.id === e.turn); let round = e.round;
  if (i < 0) i = 0;
  for (let step = 0; step < n; step++) {
    i--;
    if (i < 0) { i = n - 1; round--; if (round < 1) return e; }
    if (takesTurn(list[i])) { e.turn = list[i].id; e.round = round; return e; }
  }
  return e;
}

/**
 * Fill initiative from players' rolls (the GM's device). The first roll per
 * combatant counts, and only its owner's: a re-roll for a better number
 * doesn't replace it. Returns how many were filled.
 */
export function applyInitiativeRolls(e, rolls, encounterId) {
  const prefix = encounterRefPrefix(encounterId);
  let filled = 0;
  const oldestFirst = [...rolls].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const r of oldestFirst) {
    if (r.hidden || typeof r.ref !== 'string' || !r.ref.startsWith(prefix)) continue;
    const c = e.combatants.find(x => x.id === r.ref.slice(prefix.length));
    if (!c || c.initiative != null || !c.ownerId || c.ownerId !== r.rollerId) continue;
    c.initiative = r.total;
    filled++;
  }
  return filled;
}
