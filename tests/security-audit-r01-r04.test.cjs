'use strict';

// Codex security audit, 2026-10-05 (docs/SECURITY-AUDIT-STATE.md), fixed in v2.107.2.
//
// R-01  conflicting channel overrides: a deny must win whatever order roles arrive in
// R-03  effectiveCapabilities must return a Set even when evaluation throws
// R-04  reserved handles are refused at signup and at handle change
// (R-02, attachment binding, is covered in attachment-access.test.cjs.)
//
// R-01/R-03 run the production evaluator against a stub database, which is how
// the audit reproduced them: the stub returns exactly the roles and overrides
// the scenario needs, in whichever order the case asks for.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (p) => pathToFileURL(path.join(__dirname, '..', 'server', 'lib', p)).href;

let authorize, CAPABILITIES;
test.before(async () => {
  authorize = await import(lib('communities/authorize.js'));
  ({ CAPABILITIES } = await import(lib('communities/capabilities.js')));
});

// A member of one active Community holding `roles` (returned in the given
// order), with per-role channel overrides.
function stubDb({ roles, overrides, base, throwOn = null }) {
  const users = { 'user-1': { id: 'user-1', is_cross_port: 0, home_node: null } };
  return {
    db: { prepare: () => ({ get: (id) => users[id] || null }) },
    getCommunityById: (id) => { if (throwOn === 'community') throw new Error('disk I/O error'); return { id, status: 'active' }; },
    getFederationNodeByName: () => null,
    getCommunityBan: () => null,
    getCommunityMembership: () => ({ state: 'active' }),
    getMemberCapabilities: () => new Set(base),
    getMemberRoles: () => roles,
    getChannelPermission: (_channelId, roleId) => overrides[roleId] || null,
  };
}

const actor = { kind: 'user', userId: 'user-1' };
const C = () => CAPABILITIES;

test('R-01: a deny wins over another role\'s allow, in either role order', () => {
  const channel = { id: 'ch-1', community_id: 'com-1', visibility: 'restricted' };
  const overrides = {
    'role-high': { deny: JSON.stringify([C().VIEW_CHANNEL, C().CREATE_WAVE]), allow: '[]' },
    'role-low': { allow: JSON.stringify([C().VIEW_CHANNEL, C().CREATE_WAVE]), deny: '[]' },
  };
  const high = { id: 'role-high', priority: 90 };
  const low = { id: 'role-low', priority: 10 };
  const base = [C().VIEW_CHANNEL, C().CREATE_WAVE];

  for (const roles of [[high, low], [low, high]]) {
    const caps = authorize.channelCapabilities(stubDb({ roles, overrides, base }), actor, channel);
    assert.ok(caps instanceof Set);
    assert.strictEqual(caps.size, 0, `order ${roles.map(r => r.id).join(',')}: restricted channel must stay closed, got ${[...caps]}`);
  }
});

test('R-01: equal priorities and a deny on an action only', () => {
  const channel = { id: 'ch-2', community_id: 'com-1', visibility: 'open' };
  const a = { id: 'role-a', priority: 50 };
  const b = { id: 'role-b', priority: 50 };
  const overrides = {
    'role-a': { deny: JSON.stringify([C().CREATE_WAVE]), allow: '[]' },
    'role-b': { allow: JSON.stringify([C().CREATE_WAVE]), deny: '[]' },
  };
  const base = [C().VIEW_CHANNEL, C().CREATE_WAVE];
  for (const roles of [[a, b], [b, a]]) {
    const caps = authorize.channelCapabilities(stubDb({ roles, overrides, base }), actor, channel);
    assert.ok(caps.has(C().VIEW_CHANNEL), 'still sees the channel');
    assert.ok(!caps.has(C().CREATE_WAVE), 'the denied action stays denied');
  }
});

test('R-01: an allow with no conflicting deny still admits to a restricted channel', () => {
  const channel = { id: 'ch-3', community_id: 'com-1', visibility: 'restricted' };
  const role = { id: 'role-guest', priority: 10 };
  const overrides = { 'role-guest': { allow: JSON.stringify([C().VIEW_CHANNEL]), deny: '[]' } };
  const caps = authorize.channelCapabilities(stubDb({ roles: [role], overrides, base: [C().VIEW_CHANNEL] }), actor, channel);
  assert.ok(caps.has(C().VIEW_CHANNEL));
});

test('R-03: an evaluation error yields an empty Set, and callers do not throw', () => {
  const caps = authorize.effectiveCapabilities(stubDb({ roles: [], overrides: {}, base: [], throwOn: 'community' }), actor, 'com-1');
  assert.ok(caps instanceof Set, 'a Set, not a decision object');
  assert.strictEqual(caps.size, 0);
  // The two server.js call sites: spreading it and asking .has().
  assert.deepStrictEqual([...caps], []);
  assert.strictEqual(caps.has(C().VIEW_CHANNEL), false);
});

test('R-04: reserved handles are refused, case-insensitively', async () => {
  const { isReservedHandle, RESERVED_HANDLES } = await import(lib('reserved-handles.js'));
  for (const h of RESERVED_HANDLES) {
    assert.ok(isReservedHandle(h), h);
    assert.ok(isReservedHandle(h.toUpperCase()), h.toUpperCase());
  }
  for (const h of ['Admin', 'ROOT', 'Support', 'everyone', 'Here', 'Cortex', 'farhold']) assert.ok(isReservedHandle(h), h);
  for (const h of ['mal', 'zoe', 'admiral', 'rooted', 'helpful', 'supporter', 'adminton', 'jayne']) {
    assert.ok(!isReservedHandle(h), `${h} is an ordinary handle`);
  }
  assert.ok(!isReservedHandle(null));
});
