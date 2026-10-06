'use strict';

// Security audit R-02, client half (v2.107.2).
//
// registerAttachments() files an upload against its wave after a ping is sent.
// Until that succeeds the file is publicly readable, so a transient failure
// must be retried, and only a final answer may be remembered. It used to
// remember the path BEFORE asking and never read the response: a 429 or 500
// resolved fetch like a success and the file stayed public for good.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Just enough browser for the module: a token in storage and a stubbed fetch.
const store = new Map([['farhold_token', 'test-token']]);
const storageStub = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.localStorage = storageStub;
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };

let calls = [];
let script = [];
globalThis.fetch = async (url, opts) => {
  calls.push({ url, body: JSON.parse(opts.body) });
  const next = script.shift() ?? 200;
  if (next === 'network') throw new TypeError('Failed to fetch');
  return { ok: next >= 200 && next < 300, status: next };
};

let registerAttachments;
test.before(async () => {
  ({ registerAttachments } = await import(pathToFileURL(path.join(__dirname, '..', 'client', 'src', 'utils', 'attachments.js')).href));
});

const content = (name) => `look <img src="/uploads/files/${name}">`;

test('a rate-limited binding is retried until it succeeds', { timeout: 20000 }, async () => {
  calls = []; script = [429, 200];
  await registerAttachments(content('a.png'), 'wave-1');
  assert.equal(calls.length, 2, 'the 429 was retried, not taken as done');
  assert.deepEqual(calls[1].body, { path: '/uploads/files/a.png', waveId: 'wave-1' });

  calls = [];
  await registerAttachments(content('a.png'), 'wave-1');
  assert.equal(calls.length, 0, 'once bound, it is remembered');
});

test('a server error and a network failure are retried too', { timeout: 20000 }, async () => {
  calls = []; script = [500, 200];
  await registerAttachments(content('b.png'), 'wave-1');
  assert.equal(calls.length, 2);

  calls = []; script = ['network', 200];
  await registerAttachments(content('c.png'), 'wave-1');
  assert.equal(calls.length, 2);
});

test('a final refusal is not retried, and not asked again', async () => {
  calls = []; script = [403];
  await registerAttachments(content('someone-elses.png'), 'wave-1');
  assert.equal(calls.length, 1, 'someone else\'s file: refused once, no retries');

  calls = [];
  await registerAttachments(content('someone-elses.png'), 'wave-1');
  assert.equal(calls.length, 0);
});
