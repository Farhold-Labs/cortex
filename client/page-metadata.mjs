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


/**
 * Escape once, for either an attribute or element text.
 *
 * DECODE FIRST. Cortex sanitizes on input, so what comes back from the API is
 * already HTML-escaped: an event actually titled `Hard Transitions & Timing` is
 * stored and returned as `Hard Transitions &amp; Timing`. Escaping that again
 * produced `&amp;amp;`, which a reader sees as a literal "&amp;" — visible in
 * the noscript body and in the page title alike.
 *
 * Decoding and then escaping normalises both shapes and stays safe, because the
 * escape is what happens last: already-escaped text comes out right, and raw
 * `<script>` is still neutralised. Only the entities the sanitizer emits are
 * decoded, plus numeric ones.
 */
function attr(value) {
  const decoded = String(value ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'")
    .replace(/&#x?[0-9a-f]+;/gi, (m) => {
      const code = m[2] === 'x' || m[2] === 'X'
        ? parseInt(m.slice(3, -1), 16) : parseInt(m.slice(2, -1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    })
    // &amp; last, so "&amp;lt;" decodes to "&lt;" rather than to "<".
    .replace(/&amp;/g, '&');
  return decoded
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

// ---------------------------------------------------------------------------
// Fallback content for the public pages
// ---------------------------------------------------------------------------
//
// The metadata above fixed what machines read ABOUT these pages. This fixes
// what they can read OF them.
//
// The body is a single empty div, so anything without a JavaScript runtime — a
// crawler, an agent, a text browser, a person who turned scripting off — sees a
// page whose entire content is "ESTABLISHING SIGNAL…". For a private
// application that is unremarkable. For the two pages a company publishes so
// that its audience can read them, it means the audience cannot.
//
// This is still not server-side rendering. React renders the real page into
// #root and replaces whatever is there, so this is a fallback by construction:
// machines and scriptless readers keep it, everyone else gets the real app.
//
// It deliberately does NOT live in <noscript>. That was the first attempt, and
// it failed for the reader it was written for: a headless browser with scripting
// ENABLED never renders noscript content, so an agent fetching the page with a
// real engine and snapshotting it before the bundle finished booting captured the
// loading splash and nothing else. Putting the content inside #root means it is
// in the rendered DOM for anyone who looks, whatever their JavaScript support.

/** How many events to include. A node with hundreds should not bloat every page. */
const NOSCRIPT_EVENT_LIMIT = 50;

function timeRange({ time, endTime } = {}) {
  if (!time) return '';
  return endTime ? `${time}–${endTime}` : time;
}

/** One event as a list item. `href` comes from the API, already route-shaped. */
function eventItem(event) {
  const when = describeWhen(event);
  const bits = [
    `<strong>${attr(event.title || 'Untitled event')}</strong>`,
    when && `<br><span>${attr(when)}</span>`,
    event.location && `<br><span>at ${attr(event.location)}</span>`,
    event.description && `<br><span>${attr(summarise(event.description, 300))}</span>`,
  ].filter(Boolean).join('');
  const inner = event.href ? `<a href="${attr(event.href)}">${bits}</a>` : bits;
  return `<li style="margin:0 0 1em">${inner}</li>`;
}

/**
 * A readable version of a public page.
 *
 * `events` / `portalWaves` may be null when the API could not be reached. In
 * that case this says so and points at the API rather than rendering an empty
 * list, because "there are no events" and "I could not find out" are different
 * statements and only one of them is true.
 */
export function buildFallbackContent({ route, branding = {}, events = null, portalWaves = null } = {}) {
  const site = branding.instanceName || 'Cortex';
  // NOT wrapped in <noscript>. A headless browser with scripting enabled never
  // renders noscript content, so a reader using a real engine — and snapshotting
  // before the app finished booting — saw only the loading splash. This goes
  // inside #root instead, where React replaces it on mount.
  const wrap = (inner) =>
    '<div id="server-fallback" style="max-width:42em;margin:2em auto;padding:0 1.5em;' +
    'font-family:system-ui,sans-serif;line-height:1.5">' + inner + '</div>';

  if (route.kind !== 'events' && route.kind !== 'portal') return '';

  const unavailable =
    `<p>This page could not be loaded without JavaScript just now. ` +
    `Event data is also available directly at <a href="/api/public/events">/api/public/events</a>.</p>`;

  if (route.kind === 'portal') {
    if (!portalWaves) return wrap(`<h1>${attr(site)}</h1>${unavailable}`);
    if (!portalWaves.length) {
      return wrap(`<h1>${attr(site)}</h1><p>Nothing has been published here yet.</p>`);
    }
    const items = portalWaves.map(w =>
      `<li style="margin:0 0 .5em"><a href="/events/${attr(w.slug)}">${attr(w.title || w.slug)}</a>` +
      `${w.topic ? ` — ${attr(summarise(w.topic, 160))}` : ''}</li>`
    ).join('');
    return wrap(
      `<h1>${attr(site)}</h1>` +
      `${branding.tagline ? `<p>${attr(branding.tagline)}</p>` : ''}` +
      `<h2>Published pages</h2><ul style="padding-left:1.2em">${items}</ul>` +
      `<p><a href="/events">All events</a></p>`
    );
  }

  // route.kind === 'events'
  if (!events) return wrap(`<h1>Events — ${attr(site)}</h1>${unavailable}`);

  // A single event: show it on its own, and nothing else.
  if (route.eventId) {
    const one = events.find(e => e.id === route.eventId);
    if (!one) {
      return wrap(
        `<h1>Events — ${attr(site)}</h1>` +
        `<p>That event could not be found. It may have passed or been removed.</p>` +
        `<p><a href="/events">All events</a></p>`
      );
    }
    return wrap(
      `<h1>${attr(one.title || 'Event')}</h1>` +
      `<p>${attr(site)}</p>` +
      `<dl>` +
      `${describeWhen(one) ? `<dt>When</dt><dd>${attr(describeWhen(one))}</dd>` : ''}` +
      `${one.location ? `<dt>Where</dt><dd>${attr(one.location)}</dd>` : ''}` +
      `</dl>` +
      `${one.description ? `<p>${attr(summarise(one.description, 600))}</p>` : ''}` +
      `<p><a href="/events">All events</a></p>`
    );
  }

  // An index, optionally narrowed to one published page's events.
  const scoped = route.slug ? events.filter(e => e.slug === route.slug) : events;
  const shown = scoped.slice(0, NOSCRIPT_EVENT_LIMIT);
  if (!shown.length) {
    return wrap(
      `<h1>Events — ${attr(site)}</h1>` +
      `<p>No upcoming events are listed.</p>`
    );
  }
  const more = scoped.length > shown.length
    ? `<p>Showing the next ${shown.length} of ${scoped.length}. The full list is at ` +
      `<a href="/api/public/events">/api/public/events</a>.</p>`
    : '';
  return wrap(
    `<h1>Events — ${attr(site)}</h1>` +
    `${branding.tagline ? `<p>${attr(branding.tagline)}</p>` : ''}` +
    `<ul style="padding-left:1.2em">${shown.map(eventItem).join('')}</ul>` +
    more
  );
}

/**
 * Swap the fallback region inside #root for readable content.
 *
 * The region is delimited by explicit markers in index.html rather than matched
 * against the loader's markup, which a build step may reshape. With no block to
 * insert — a private route — the loader is left exactly as built.
 */
const FALLBACK_START = '<!-- server-fallback:start';
const FALLBACK_END = '<!-- server-fallback:end -->';

export function injectFallback(html, block) {
  if (!block) return html;
  const start = html.indexOf(FALLBACK_START);
  const end = html.indexOf(FALLBACK_END);
  if (start === -1 || end === -1 || end < start) return html;  // markers gone: leave it alone
  return html.slice(0, start) + block + html.slice(end + FALLBACK_END.length);
}

export default { classifyPath, buildMetadata, injectMetadata, buildFallbackContent, injectFallback };
