'use strict';

// Making URLs in event descriptions clickable (v2.93.0).
//
// This runs over text that anyone who can create an event supplies, and its
// output becomes an href. The cases that matter are the ones that must NOT
// become links.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE_URL = pathToFileURL(
  path.join(__dirname, '..', 'client', 'src', 'utils', 'linkify.js')
).href;

let linkSegments;
const links = (text) => linkSegments(text).filter(s => s.type === 'link').map(s => s.value);
const rendered = (text) => linkSegments(text).map(s => s.value).join('');

test.before(async () => { ({ linkSegments } = await import(MODULE_URL)); });

test('a bare URL in a description becomes a link', () => {
  // The real text from a Potter McKean Players event.
  const desc = 'Tickets on sale now at Zeffy.com:\nhttps://www.zeffy.com/en-US/ticketing/the-importance-of-being-earnest-9';
  assert.deepStrictEqual(links(desc), ['https://www.zeffy.com/en-US/ticketing/the-importance-of-being-earnest-9']);
});

test('javascript: and data: URLs are never linked', () => {
  // The whole point of matching only http(s): there is no code path that can
  // put these in an href.
  assert.deepStrictEqual(links('click javascript:alert(1) here'), []);
  assert.deepStrictEqual(links('data:text/html;base64,PHNjcmlwdD4='), []);
  assert.deepStrictEqual(links('vbscript:msgbox(1)'), []);
  assert.deepStrictEqual(links('file:///etc/passwd'), []);
});

test('markup in the text is never treated as markup', () => {
  // It comes back as plain text for React to escape — it is not parsed, and
  // the angle brackets stop a URL rather than extending it.
  const evil = '<script>alert(1)</script> https://example.com/ok';
  assert.deepStrictEqual(links(evil), ['https://example.com/ok']);
  assert.ok(rendered(evil).includes('<script>'), 'kept verbatim as text, not interpreted');
});

test('a URL embedded in markup does not escape its quotes', () => {
  const s = 'x="https://example.com/a" y';
  assert.deepStrictEqual(links(s), ['https://example.com/a'], 'the quote terminates the URL');
});

test('trailing punctuation is left out of the link', () => {
  assert.deepStrictEqual(links('See https://example.com/show.'), ['https://example.com/show']);
  assert.deepStrictEqual(links('Buy at https://example.com/x, then go'), ['https://example.com/x']);
  assert.deepStrictEqual(links('Really? https://example.com/y?'), ['https://example.com/y']);
});

test('brackets are balanced rather than blindly trimmed', () => {
  assert.deepStrictEqual(links('(see https://example.com/a)'), ['https://example.com/a']);
  // A closing paren that belongs to the URL is kept.
  assert.deepStrictEqual(
    links('https://en.wikipedia.org/wiki/Tosca_(opera)'),
    ['https://en.wikipedia.org/wiki/Tosca_(opera)']
  );
});

test('the text is reproduced exactly, links and all', () => {
  // Nothing may be dropped or duplicated while splitting — a description that
  // lost a line would be worse than one with an unclickable link.
  for (const s of [
    'no links here at all',
    'https://a.test start',
    'end https://b.test',
    'two https://a.test and https://b.test links',
    'Line one\nhttps://c.test\nLine three',
    '',
  ]) {
    assert.strictEqual(rendered(s), s, `round-trip failed for: ${JSON.stringify(s)}`);
  }
});

test('non-string input is handled rather than thrown on', () => {
  for (const v of [null, undefined, 42, {}, []]) {
    assert.deepStrictEqual(linkSegments(v), []);
  }
});
