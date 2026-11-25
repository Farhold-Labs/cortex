'use strict';

// Plex sign-in picks the address this server can reach (v2.156.2). It used
// to prefer the LAN address, which a hosted Cortex can never reach.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const LAN = { uri: 'https://192-168-33-2.abc.plex.direct:32400', local: true, relay: false };
const PUBLIC = { uri: 'https://203-0-113-9.abc.plex.direct:32400', local: false, relay: false };
const RELAY = { uri: 'https://relay.abc.plex.direct:8443', local: false, relay: true };

const load = () => import('../server/lib/plex-connection-pick.js');

test('a hosted Cortex gets the public address, not the LAN one plex.tv lists first', async () => {
  const { pickConnection } = await load();
  const reachable = new Set([PUBLIC.uri, RELAY.uri]);
  const got = await pickConnection([LAN, RELAY, PUBLIC], async (uri) => reachable.has(uri));
  assert.equal(got.uri, PUBLIC.uri);
  assert.equal(got.reachable, true);
});

test('a Cortex on the same LAN, without Plex remote access, still gets the LAN address', async () => {
  const { pickConnection } = await load();
  const got = await pickConnection([LAN, PUBLIC], async (uri) => uri === LAN.uri);
  assert.equal(got.uri, LAN.uri);
  assert.equal(got.local, true);
});

test('relay is used when only the relay answers; a throwing probe counts as no answer', async () => {
  const { pickConnection } = await load();
  const got = await pickConnection([LAN, PUBLIC, RELAY], async (uri) => { if (uri !== RELAY.uri) throw new Error('ECONNREFUSED'); return true; });
  assert.equal(got.uri, RELAY.uri);
});

test('nothing answers: the public address is offered, marked unreachable; junk URIs are ignored', async () => {
  const { pickConnection } = await load();
  const got = await pickConnection([{ uri: 'javascript:alert(1)' }, LAN, PUBLIC], async () => false);
  assert.equal(got.uri, PUBLIC.uri);
  assert.equal(got.reachable, false);
  assert.equal(await pickConnection([{ uri: 'file:///etc/passwd' }], async () => true), null);
});

test('counterfactual: the old preference (LAN first) picks the address a hosted Cortex cannot reach', () => {
  const connections = [RELAY, PUBLIC, LAN];
  const old = connections.find(c => c.local && !c.relay) || connections.find(c => !c.local && !c.relay);
  assert.equal(old.uri, LAN.uri);
});
