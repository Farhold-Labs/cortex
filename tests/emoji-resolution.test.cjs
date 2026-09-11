'use strict';

// Emoticon and shortcode resolution (v2.87.0).
//
// This runs on the client before encryption, so it is the last place the text
// is readable — a false positive here rewrites what someone actually said, in a
// ping nobody can fix server-side afterwards. Hence the negative cases below.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MODULE_URL = pathToFileURL(
  path.join(__dirname, '..', 'client', 'src', 'config', 'emojiData.js')
).href;

let resolve;

test.before(async () => {
  ({ resolveEmojiShortcodes: resolve } = await import(MODULE_URL));
});

test('typed emoticons become emoji', () => {
  assert.strictEqual(resolve('hello :)'), 'hello 🙂');
  assert.strictEqual(resolve('hello :-)'), 'hello 🙂');
  assert.strictEqual(resolve('nice ;)'), 'nice 😉');
  assert.strictEqual(resolve('yes :D'), 'yes 😃');
  assert.strictEqual(resolve('oh :('), 'oh 🙁');
  assert.strictEqual(resolve('wow :O'), 'wow 😮');
  assert.strictEqual(resolve('love <3'), 'love ❤️');
});

test('emoticon at the start of the message is matched', () => {
  assert.strictEqual(resolve(':) hi'), '🙂 hi');
  assert.strictEqual(resolve(':)'), '🙂');
});

test('longer emoticons win over their prefixes', () => {
  assert.strictEqual(resolve('grr >:('), 'grr 😠');
  assert.strictEqual(resolve("aww :'("), 'aww 😢');
});

test('case variants resolve', () => {
  assert.strictEqual(resolve('ha xD'), 'ha 😆');
  assert.strictEqual(resolve('ha XD'), 'ha 😆');
  assert.strictEqual(resolve('yes :d'), 'yes 😃');
});

test('consecutive emoticons all resolve', () => {
  assert.strictEqual(resolve(':) :) :)'), '🙂 🙂 🙂');
});

test('URLs are not mangled', () => {
  const url = 'see https://example.com/a:b for details';
  assert.strictEqual(resolve(url), url);
  assert.strictEqual(resolve('http://x.test'), 'http://x.test');
});

test('emoticons glued to a word are left alone', () => {
  assert.strictEqual(resolve('a:)'), 'a:)');
  assert.strictEqual(resolve(':)x'), ':)x');
  assert.strictEqual(resolve('ratio 3:)'), 'ratio 3:)');
});

test('inline code and fenced blocks are left verbatim', () => {
  assert.strictEqual(resolve('use `:)` here'), 'use `:)` here');
  assert.strictEqual(
    resolve('```\nif (x) :)\n```'),
    '```\nif (x) :)\n```'
  );
  assert.strictEqual(resolve('`:fire:`'), '`:fire:`');
});

test('text around a code span still resolves', () => {
  assert.strictEqual(resolve(':) `:)` :)'), '🙂 `:)` 🙂');
});

test('shortcodes still resolve', () => {
  assert.strictEqual(resolve('so :fire:'), 'so 🔥');
  assert.strictEqual(resolve(':shrug: ok'), '🤷 ok');
});

test('unknown shortcodes are left alone', () => {
  assert.strictEqual(resolve('a :notanemoji: b'), 'a :notanemoji: b');
});

test('plain text is untouched', () => {
  const plain = 'Deploy at 14:30 and check the ratio 2:1 afterwards.';
  assert.strictEqual(resolve(plain), plain);
});
