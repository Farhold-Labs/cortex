// Turning bare URLs in user-supplied text into links (v2.93.0).
//
// Event descriptions are plain text — a ticket link pasted into one rendered as
// something to retype by hand rather than click.
//
// This returns SEGMENTS, not HTML. The caller builds React elements from them,
// so the text never passes through dangerouslySetInnerHTML and there is no
// markup for an attacker to smuggle anything into: React escapes text nodes,
// and the only thing that ever becomes an href is a string this file already
// matched against an http(s) pattern. Sanitising a generated HTML string would
// have worked too, but "no HTML is ever generated" needs no sanitiser to be
// correct.

// Deliberately only explicit http(s) URLs. Matching bare domains would turn
// "Sat." and "e.g." into links, and the cure is worse than the disease.
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

// Trailing punctuation is almost never part of the address. "Tickets at
// https://example.com/show." should link the URL and leave the full stop
// behind, and a link inside brackets should not swallow the closing one.
function trimTrailing(url) {
  let end = url.length;
  for (;;) {
    const ch = url[end - 1];
    if (end > 0 && '.,;:!?"\''.includes(ch)) { end -= 1; continue; }
    if (end > 0 && ch === ')') {
      const slice = url.slice(0, end);
      const opens = (slice.match(/\(/g) || []).length;
      const closes = (slice.match(/\)/g) || []).length;
      if (closes > opens) { end -= 1; continue; }   // unbalanced — not ours
    }
    break;
  }
  return url.slice(0, end);
}

/**
 * Split text into [{ type: 'text' | 'link', value }] in order.
 * Exported separately from the component so it can be tested without a DOM.
 */
export function linkSegments(text) {
  const input = typeof text === 'string' ? text : '';
  if (!input) return [];

  const segments = [];
  let cursor = 0;

  for (const match of input.matchAll(URL_RE)) {
    const url = trimTrailing(match[0]);
    // trimTrailing can eat the whole match only if it was punctuation, which
    // the pattern cannot produce — but guard rather than emit an empty link.
    if (!url) continue;
    if (match.index > cursor) {
      segments.push({ type: 'text', value: input.slice(cursor, match.index) });
    }
    segments.push({ type: 'link', value: url });
    cursor = match.index + url.length;
  }

  if (cursor < input.length) segments.push({ type: 'text', value: input.slice(cursor) });
  return segments;
}

export default linkSegments;
