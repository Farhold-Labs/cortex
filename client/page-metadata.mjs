// Per-route <head> metadata for the public pages.
//
// WHY THIS IS HERE AND NOT IN index.html
//
// index.html is built once and serves every route on every node — the same dist
// ships to each instance, which is what makes a single build reusable. So it
// cannot name a route or an instance. Its title has always been "CORTEX -
// Secure Wave Communications" and its description has always been about Google
// Wave, on every page, including the public ones a theatre company shares with
// its audience.
//
// The consequence is not cosmetic. Anything that reads only the head — a link
// preview in a message, a search crawler, an agent without a JavaScript runtime
// — learns nothing about the instance or the event. Paste an events link into a
// chat and it unfurls as a generic platform page.
//
// So the tags are composed per request, from what the server already knows.
// This is NOT server-side rendering: the body is still the same empty shell, and
// the page still needs JavaScript to show anything. It fixes what machines read,
// not what people see with scripting off.


/** Minimal HTML-attribute escaping. Titles and locations are user-supplied. */
function attr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Collapse whitespace and cut to a length link previews will actually show. */
function summarise(text, max = 200) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/[\s,;:.–-]+\S*$/, '')}…`;
}

/** "Tuesday 29 September 2026, 18:00" from the shapes the events API returns. */
function describeWhen({ date, time, endTime } = {}) {
  if (!date) return '';
  const parsed = new Date(`${date}T${time || '00:00'}:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  // No timezone conversion: the API already returns the instance's local wall
  // time, and re-interpreting it here would move events by hours.
  const day = parsed.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  if (!time) return day;
  return endTime ? `${day}, ${time}–${endTime}` : `${day}, ${time}`;
}

/**
 * What this URL is, as far as metadata is concerned.
 * Mirrors the client router in AppContent.jsx — including its trailing slash.
 */
export function classifyPath(pathname) {
  const p = String(pathname || '/').split('?')[0];
  if (/^\/portal\/?$/.test(p)) return { kind: 'portal' };
  const events = p.match(/^\/events(?:\/([a-z0-9-]{2,48})(?:\/([^/]+))?)?\/?$/);
  if (events) return { kind: 'events', slug: events[1] || null, eventId: events[2] || null };
  return { kind: 'app' };
}

/**
 * Compose the metadata for a request.
 *
 * `branding` and `event` are both optional — when the API cannot be reached, or
 * the event is unknown, this degrades to something accurate rather than
 * inventing detail. A wrong preview is worse than a plain one.
 */
export function buildMetadata({ pathname, branding = {}, event = null, origin = '' } = {}) {
  const site = branding.instanceName || 'Cortex';
  const tagline = branding.tagline || '';
  const route = classifyPath(pathname);
  const canonical = origin ? `${origin}${String(pathname || '/').replace(/\/$/, '') || '/'}` : '';

  let title;
  let description;

  if (route.kind === 'events' && route.eventId && event) {
    const when = describeWhen(event);
    title = `${event.title} — ${site}`;
    description = summarise(
      [event.description, when, event.location && `at ${event.location}`]
        .filter(Boolean).join(' · ')
      || `An event at ${site}.`
    );
  } else if (route.kind === 'events') {
    title = `Events — ${site}`;
    description = summarise(tagline
      ? `Upcoming events at ${site}. ${tagline}.`
      : `Upcoming events at ${site}.`);
  } else if (route.kind === 'portal') {
    title = `${site}`;
    description = summarise(tagline || `Public pages for ${site}.`);
  } else {
    // Every private route. Deliberately says nothing beyond the instance name:
    // these pages are not public, and their titles are not the place to start
    // describing them.
    title = site === 'Cortex' ? 'Cortex' : `${site} · Cortex`;
    description = 'A private, federated conversation space.';
  }

  const tags = [
    `<title>${attr(title)}</title>`,
    `<meta name="description" content="${attr(description)}">`,
    `<meta property="og:type" content="${route.kind === 'events' && route.eventId ? 'article' : 'website'}">`,
    `<meta property="og:site_name" content="${attr(site)}">`,
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(description)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${attr(title)}">`,
    `<meta name="twitter:description" content="${attr(description)}">`,
  ];
  if (canonical) {
    tags.push(`<link rel="canonical" href="${attr(canonical)}">`);
    tags.push(`<meta property="og:url" content="${attr(canonical)}">`);
  }
  // Private routes must not be indexed even if something crawls them.
  if (route.kind === 'app') tags.push('<meta name="robots" content="noindex, nofollow">');

  return { title, description, route, tags: tags.join('\n    ') };
}

/**
 * Replace the built-in title/description with the composed ones.
 *
 * Matches the literal tags Vite emits. If either is absent — a template change,
 * say — the block is inserted rather than silently dropped, so the page keeps
 * working and the metadata still lands.
 */
export function injectMetadata(html, metadata) {
  let out = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name="description"[^>]*>\s*/i, '');
  const marker = '</head>';
  const idx = out.toLowerCase().indexOf(marker);
  if (idx === -1) return html;  // not a document we understand; leave it alone
  return `${out.slice(0, idx)}  ${metadata.tags}\n  ${out.slice(idx)}`;
}

export default { classifyPath, buildMetadata, injectMetadata };
