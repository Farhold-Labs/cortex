'use strict';

// Pictures in end-to-end encrypted waves (v2.108.0).
//
// The server never sees an encrypted message, so the client embeds uploaded
// images after decrypting and rendering markdown. Markdown (v2.64.0) renders a
// line break as <br> BEFORE that pass, and the composer puts an upload on its
// own line after any caption — so the old pattern, which refused a path
// preceded by `>`, left every captioned picture as a bare, unopenable path.
// These run the real renderMarkdown and then the real embed pass.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const mod = (p) => pathToFileURL(path.join(__dirname, '..', 'client', 'src', 'utils', p)).href;
let renderMarkdown, embedUploadedImages;
test.before(async () => {
  ({ renderMarkdown } = await import(mod('markdown.js')));
  ({ embedUploadedImages } = await import(mod('embed.js')));
});

const P = '/uploads/messages/user-c83eda70-ae0f-4a9a-9791-5ddd26fa2bbe-1791312804466.webp';
const render = (content) => embedUploadedImages(renderMarkdown(content));
const imgs = (html) => (html.match(/<img src="([^"]+)"/g) || []).map(m => m.slice(10, -1));

test('a picture with a caption above it is embedded (the reported case)', () => {
  for (const content of [`look at this\n${P}`, `**bold** caption\n${P}`, `line one\nline two\n${P}`]) {
    assert.deepStrictEqual(imgs(render(content)), [P], content);
  }
});

test('the shapes that already worked still do', () => {
  assert.deepStrictEqual(imgs(render(P)), [P]);
  assert.deepStrictEqual(imgs(render(`${P}\n`)), [P]);
  assert.deepStrictEqual(imgs(render(`look ${P}`)), [P]);
  assert.deepStrictEqual(imgs(render(`${P}\nnice`)), [P]);
  const two = P.replace('466', '467');
  assert.deepStrictEqual(imgs(render(`${P} ${two}`)), [P, two]);
  assert.deepStrictEqual(imgs(render(`caption\n${P}\n${two}`)), [P, two]);
});

test('a path that is part of something else is left alone', () => {
  // Inside an attribute: already an image or a link.
  const already = `<img src="${P}" alt="x" />`;
  assert.strictEqual(embedUploadedImages(already), already);
  const link = `<a href="${P}">open</a>`;
  assert.strictEqual(embedUploadedImages(link), link);
  // Part of a full URL, a longer path, or a word.
  for (const s of [`https://cortex.farhold.com${P}`, `/files${P}`, `abc${P}`, `x=${P}`]) {
    assert.strictEqual(embedUploadedImages(s), s, s);
  }
  // Not an image.
  assert.strictEqual(embedUploadedImages('/uploads/messages/notes.txt'), '/uploads/messages/notes.txt');
});

test('it is idempotent', () => {
  const once = render(`caption\n${P}`);
  assert.strictEqual(embedUploadedImages(once), once);
});
