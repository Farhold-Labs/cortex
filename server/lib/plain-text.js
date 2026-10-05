// Server copy of client/src/utils/plainText.js (v2.107.0) — the two are tested
// against the same cases in tests/plain-text.test.cjs so they cannot drift.
//
// Plain-text input is stored entity-encoded (sanitizeInput), which is right for
// HTML output and wrong everywhere else: a plain-text email showed subscribers
// "Hard Transitions &amp; Timing", and escapeHtml() over a stored value made it
// "&amp;amp;". Decode at the point the text leaves for a non-HTML destination,
// or immediately before escaping it exactly once.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function plainText(value) {
  if (typeof value !== 'string' || !value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower[0] !== '#') return NAMED[lower];
    const code = lower[1] === 'x' ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
    return String.fromCodePoint(code);
  });
}

export default plainText;
