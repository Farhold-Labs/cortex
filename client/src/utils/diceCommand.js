// Dice commands in the message box (v2.158.0, docs/ttrpg/README.md).
//
//   /roll 1d20+5 Stealth      the table's default visibility (/r for short)
//   /gmroll 1d20+5            to the GM: the roller and the GMs see the result
//   /publicroll 2d6           everyone
//   /secretroll 1d20          GM secret (GMs only)
//
// The device only splits the notation from the label: the label is ping text
// (encrypted in an encrypted wave) and must never reach the roll request. The
// server parses the notation again and does the rolling.

const COMMANDS = {
  '/roll': null, '/r': null,
  '/gmroll': 'gm', '/gr': 'gm',
  '/publicroll': 'public', '/pr': 'public',
  '/secretroll': 'gm_secret', '/sr': 'gm_secret',
};

const TERM = String.raw`(?:(?:adv|dis)\b|\d*d(?:\d+|%)(?:(?:kh|kl|dh|dl|k)\d*|ro?<?\d+)*|\d+(?![\w%]))`;
const EXPRESSION = new RegExp(String.raw`^\s*[+-]?\s*${TERM}(?:\s*[+-]\s*${TERM})*`, 'i');

export function parseRollCommand(text) {
  const m = /^\s*(\/[a-z]+)(?:\s+|$)([\s\S]*)$/i.exec(text || '');
  if (!m || !(m[1].toLowerCase() in COMMANDS)) return null;
  const rest = m[2].trim();
  const visibility = COMMANDS[m[1].toLowerCase()];
  const e = EXPRESSION.exec(rest);
  if (!e) return { error: rest ? `"${rest.split(/\s+/)[0]}" isn't dice. Try /roll 1d20+5 Stealth` : 'What should I roll? Try /roll 1d20+5 Stealth', visibility };
  return { expression: e[0].trim(), label: rest.slice(e[0].length).trim(), visibility };
}

// The fallback text of a roll ping with no label: what a client without the
// card (or a notification) shows.
export const rollFallback = (expression) => `🎲 ${expression}`;
export const isRollFallback = (text) => typeof text === 'string' && text.startsWith('🎲 ');
