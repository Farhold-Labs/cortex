import React from 'react';
import { linkSegments } from '../../utils/linkify.js';
import { plainText } from '../../utils/plainText.js';

/**
 * Plain text with its URLs made clickable (v2.93.0).
 *
 * Builds React elements from segments rather than an HTML string, so nothing
 * here can inject markup: React escapes every text node, and the only value
 * that becomes an href has already been matched against an http(s) pattern.
 *
 * `rel="noopener noreferrer"` because these links are written by whoever
 * created the event and open in a new tab — without `noopener` the opened page
 * can reach back through `window.opener`. `nofollow` because a public event
 * page should not be a way to buy search ranking.
 *
 * The text arrives as the server stored it — entity-encoded — so it is decoded
 * first (v2.107.0). Otherwise "&" showed as "&amp;", and a ticket link with a
 * query string pointed at "?a=1&amp;b=2", which is a different URL.
 */
const LinkedText = ({ text, linkColor = 'var(--accent-amber, #ffd23f)' }) => {
  const segments = linkSegments(plainText(text));
  if (!segments.length) return null;

  return (
    <>
      {segments.map((seg, i) => (
        seg.type === 'link' ? (
          <a
            key={i}
            href={seg.value}
            target="_blank"
            rel="noopener noreferrer nofollow"
            style={{ color: linkColor, textDecoration: 'underline', wordBreak: 'break-all' }}
            // The description may sit inside something clickable — opening a
            // ticket page should not also open the event behind it.
            onClick={(e) => e.stopPropagation()}
          >{seg.value}</a>
        ) : (
          <React.Fragment key={i}>{seg.value}</React.Fragment>
        )
      ))}
    </>
  );
};

export default LinkedText;
