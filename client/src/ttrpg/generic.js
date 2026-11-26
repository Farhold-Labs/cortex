/**
 * A sheet for any game (v2.159.0): free fields, resources with a current and
 * a maximum, and roll buttons whose dice can name fields, as in
 * `1d20+{Agility}`. For every system until it has its own template.
 */
import { newId } from './dnd5e2024.js';

export function blankGenericSheet(name = '') {
  return {
    schema: 1, system: 'generic', name,
    fields: [{ id: newId(), label: 'Level', value: '1' }],
    resources: [{ id: newId(), name: 'Health', current: 10, max: 10, reset: 'none' }],
    rolls: [{ id: newId(), label: 'Check', expression: '1d20' }],
    notes: '',
  };
}

/**
 * Fill `{Field}` from the sheet's fields (by label, any case). A field used in
 * dice must be a whole number; anything else is an error, so text from a
 * field can never become part of the dice.
 */
export function fillRoll(expression, sheet) {
  let error = null;
  // "1d20{Str}" would read as a d203: a field next to a number needs + or - between.
  if (/\d\{|\}\d/.test(String(expression || ''))) return { error: 'Put + or - between a number and a {field}' };
  const out = String(expression || '').replace(/\{([^{}]{1,40})\}/g, (_, name) => {
    const key = name.trim().toLowerCase();
    const field = (sheet.fields || []).find(f => String(f.label).trim().toLowerCase() === key)
      || (sheet.resources || []).find(r => String(r.name).trim().toLowerCase() === key);
    const raw = field ? ('value' in field ? field.value : field.current) : undefined;
    const n = Number(String(raw ?? '').trim());
    if (!field) { error = error || `No field called "${name.trim()}"`; return '0'; }
    if (!Number.isInteger(n)) { error = error || `"${name.trim()}" isn't a whole number`; return '0'; }
    return n < 0 ? `-${-n}` : String(n);
  }).replace(/\+-/g, '-').replace(/--/g, '+');
  return error ? { error } : { expression: out };
}
