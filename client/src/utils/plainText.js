// Text the server stored escaped, made readable again (v2.107.0).
//
// The server sanitizes plain-text input on the way IN (sanitizeInput in
// server.js): tags are stripped and the text is entity-encoded, so an event
// called "Hard Transitions & Timing" is stored and served as
// "Hard Transitions &amp; Timing". That is what keeps the value safe in the
// HTML places it ends up (emails, the static public-page fallback). React,
// however, escapes text itself — so rendering the stored value showed people
// a literal "&amp;".
//
// Use this ONLY where the result is rendered as React text, an input's value,
// or another non-HTML sink. Never feed its output to dangerouslySetInnerHTML
// or innerHTML: decoding is exactly what turns "&lt;script&gt;" back into
// "<script>". Message bodies are HTML and must not come through here.
//
// One pass, on purpose: "&amp;lt;" becomes "&lt;", which is what the author
// typed. Decoding twice would turn that into "<".

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function plainText(value) {
  if (typeof value !== 'string' || !value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower[0] !== '#') return NAMED[lower];
    const code = lower[1] === 'x' ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    // Leave anything that is not a real, printable code point as written.
    if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
    return String.fromCodePoint(code);
  });
}

export default plainText;
