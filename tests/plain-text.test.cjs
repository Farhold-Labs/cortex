'use strict';

// Displaying text the server stored escaped (v2.107.0).
//
// The server entity-encodes plain-text input; React escapes again on render, so
// an event called "Hard Transitions & Timing" showed as "&amp;". plainText()
// undoes the server's encoding for React text. The property that matters: for
// any text a person typed, decode(sanitizeInput(text)) gives back exactly what
// they typed — once, not more.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sanitizeHtml = require('../server/node_modules/sanitize-html');

// The server's exact options (server.js, sanitizeInput).
const sanitizeInput = (input) => sanitizeHtml(input, { allowedTags: [], allowedAttributes: {}, textFilter: (t) => t }).trim();

// Client and server each carry a copy; every case below runs against both.
let plainText, serverPlainText;
test.before(async () => {
  ({ plainText } = await import(pathToFileURL(path.join(__dirname, '..', 'client', 'src', 'utils', 'plainText.js')).href));
  ({ plainText: serverPlainText } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'lib', 'plain-text.js')).href));
});

test('round-trips what a person typed through the server sanitizer', () => {
  for (const typed of [
    'Hard Transitions & Timing Run-Through',
    'Add Lady Bracknell & Merriman',
    'A & W',
    'Rock "n" roll',
    "Bob's party",
    'Fish > chips',
    'https://example.com/tickets?a=1&b=2',
    'Café & crème — 50% off',
    '3 < 4',
  ]) {
    assert.strictEqual(plainText(sanitizeInput(typed)), typed, typed);
  }
});

test('decodes the entity forms in stored data, exactly once', () => {
  assert.strictEqual(plainText('Hard Transitions &amp; Timing'), 'Hard Transitions & Timing');
  assert.strictEqual(plainText('&#x27;quoted&#39;'), "'quoted'");
  assert.strictEqual(plainText('&quot;x&quot; &lt;y&gt;'), '"x" <y>');
  assert.strictEqual(plainText('&amp;lt;'), '&lt;', 'one pass only — the author typed "&lt;"');
});

test('leaves everything else alone', () => {
  assert.strictEqual(plainText('no entities here'), 'no entities here');
  assert.strictEqual(plainText('AT&T and &unknown; and & alone'), 'AT&T and &unknown; and & alone');
  assert.strictEqual(plainText('&#0; &#x1F; &#xD800;'), '&#0; &#x1F; &#xD800;', 'control/surrogate code points stay encoded');
  assert.strictEqual(plainText(null), null);
  assert.strictEqual(plainText(undefined), undefined);
  assert.strictEqual(plainText(42), 42);
});

test('a tag that was stripped stays stripped; an escaped one becomes inert text', () => {
  // The sanitizer removed the real tag; nothing to decode back into markup.
  assert.strictEqual(plainText(sanitizeInput('<b>bold</b> & co')), 'bold & co');
  // The sanitizer itself decodes entities a person types, so typing
  // "&lt;script&gt;" is stored exactly like typing "<script>" as text — and
  // comes back as those characters. Inert, because plainText output is only
  // ever rendered by React as text, never injected as HTML.
  assert.strictEqual(sanitizeInput('&lt;script&gt;'), '&lt;script&gt;');
  assert.strictEqual(plainText(sanitizeInput('&lt;script&gt;')), '<script>');
});

test('the server copy behaves identically', () => {
  const cases = ['Hard Transitions &amp; Timing', '&#x27;q&#39;', '&amp;lt;', 'AT&T &unknown;', '&#0; &#xD800;',
    '&quot;x&quot; &lt;y&gt; &nbsp;', 'plain', '', 'Caf&#233;'];
  for (const c of cases) assert.strictEqual(serverPlainText(c), plainText(c), c);
  assert.strictEqual(serverPlainText(null), null);
});

test('email escaping: stored values escape once, secrets stay raw', async () => {
  process.env.EMAIL_PROVIDER = '';
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'email-service.js')).href);
  const svc = mod.getEmailService();
  // A stored (already-encoded) title must not become "&amp;amp;" in HTML mail.
  assert.strictEqual(svc.escapeHtml('Hard Transitions &amp; Timing'), 'Hard Transitions &amp; Timing');
  // A raw value still escapes normally.
  assert.strictEqual(svc.escapeHtml('A & <b>'), 'A &amp; &lt;b&gt;');
  // A secret is never decoded: "&lt;" in an admin-typed password stays "&lt;".
  assert.strictEqual(svc.escapeRaw('p&lt;ss'), 'p&amp;lt;ss');
});
