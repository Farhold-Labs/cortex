'use strict';

// Attendance tracking for events (v2.90.0).
//
// The feature exists to answer "who hasn't replied?", so the assertions that
// matter most are the ones about people who have done nothing — the rows a
// naive INNER JOIN would drop, and the per-occurrence scoping that the old
// (event_id, user_id) key could not express.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));

function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('event attendance: invites, chasing, capacity and the register', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-events-'));
  const password = 'Rehearsal123!';
  const jwtSecret = 'test-secret-for-event-attendance-00000000';
  let child;

  try {
    const serverDir = path.join(temp, 'server');
    fs.mkdirSync(serverDir);
    for (const name of fs.readdirSync(path.join(root, 'server'))) {
      if (/\.(js|sql)$/.test(name) || name === 'package.json') {
        fs.copyFileSync(path.join(root, 'server', name), path.join(serverDir, name));
      }
    }
    fs.cpSync(path.join(root, 'server/lib'), path.join(serverDir, 'lib'), { recursive: true });
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(serverDir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(serverDir, 'data'));

    const { DatabaseSQLite } = await import('../server/database-sqlite.js');
    const db = new DatabaseSQLite({ dbPath: path.join(serverDir, 'data/farhold.db') });
    const hash = serverRequire('bcryptjs').hashSync(password, 4);
    const cast = ['director', 'alice', 'bob', 'carol', 'dave'];
    for (const id of cast) {
      db.createUser({ id, handle: id, email: `${id}@example.test`, passwordHash: hash, displayName: id });
    }
    const crew = db.createGroup({ name: 'Cast', createdBy: 'director' });
    for (const id of ['alice', 'bob', 'carol']) db.addGroupMember(crew.id, id, 'member');

    const firstDate = isoDaysFromNow(7);
    const wave = db.createWave({ title: 'Rehearsals', createdBy: 'director', participants: cast });

    // A one-off with a capacity of 2, and a weekly series for the occurrence tests.
    const workshop = db.createEvent({
      title: 'Movement workshop', eventDate: firstDate, createdBy: 'director',
      scope: 'wave', waveId: wave.id, rsvpEnabled: true, capacity: 2,
    });
    const weekly = db.createEvent({
      title: 'Weekly rehearsal', eventDate: firstDate, createdBy: 'director',
      scope: 'wave', waveId: wave.id, rsvpEnabled: true, recurrence: 'weekly',
    });
    db.db.close();

    fs.appendFileSync(
      path.join(serverDir, 'server.js'),
      "\nserver.on('listening', () => console.log('EVT_TEST_PORT=' + server.address().port));\n"
    );

    let output = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: serverDir,
      env: {
        PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0',
        USE_SQLITE: 'true', JWT_SECRET: jwtSecret, FEDERATION_ENABLED: 'false',
        SEED_DEMO_DATA: 'false', RATE_LIMIT_API_MAX: '10000', RATE_LIMIT_LOGIN_MAX: '100', RATE_LIMIT_REGISTER_MAX: '10000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });

    const deadline = Date.now() + 20000;
    while (!/EVT_TEST_PORT=(\d+)/.test(output)) {
      if (child.exitCode !== null || Date.now() > deadline) {
        throw new Error('startup failed: ' + output.slice(-4000));
      }
      await new Promise(r => setTimeout(r, 50));
    }
    const base = `http://127.0.0.1:${output.match(/EVT_TEST_PORT=(\d+)/)[1]}`;

    const tokens = {};
    const req = (url, who, options = {}) => fetch(base + url, {
      ...options,
      headers: {
        ...(tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    for (const who of cast) {
      const res = await fetch(base + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: who, password }),
      });
      const data = await res.json();
      assert.equal(res.status, 200, JSON.stringify(data));
      tokens[who] = data.token;
    }

    const rsvp = (eventId, who, status, date) =>
      req(`/api/events/${eventId}/rsvp`, who, { method: 'POST', body: { status, date } });
    const roster = async (eventId, who, date) =>
      (await req(`/api/events/${eventId}/roster?date=${date}`, who)).json();

    await t.test('inviting a crew resolves its membership, and everyone starts as no-response', async () => {
      const res = await req(`/api/events/${workshop.id}/invites`, 'director', {
        method: 'POST', body: { crewIds: [crew.id], date: firstDate },
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      // Four, not three: createGroup makes its creator an admin member, so the
      // director is in the cast crew and is invited along with it.
      assert.equal(body.invited, 4, 'director, alice, bob and carol');

      const r = await roster(workshop.id, 'director', firstDate);
      assert.equal(r.invitedCount, 4);
      assert.equal(r.counts.no_response, 4, 'nobody has answered yet');
      assert.equal(r.counts.going, 0);
    });

    await t.test('re-inviting the same crew does not duplicate anyone', async () => {
      const res = await req(`/api/events/${workshop.id}/invites`, 'director', {
        method: 'POST', body: { crewIds: [crew.id], date: firstDate },
      });
      assert.equal((await res.json()).invited, 0);
      assert.equal((await roster(workshop.id, 'director', firstDate)).invitedCount, 4);
    });

    await t.test('an individual can be added alongside a crew', async () => {
      const res = await req(`/api/events/${workshop.id}/invites`, 'director', {
        method: 'POST', body: { userIds: ['dave'], date: firstDate },
      });
      assert.equal((await res.json()).invited, 1);
      const r = await roster(workshop.id, 'director', firstDate);
      assert.equal(r.invitedCount, 5);
      assert.equal(r.roster.find(x => x.user_id === 'dave').invited_via, 'direct');
      assert.equal(r.roster.find(x => x.user_id === 'alice').invited_via, crew.id);
    });

    await t.test('answering moves someone out of the no-response column', async () => {
      assert.equal((await rsvp(workshop.id, 'alice', 'going', firstDate)).status, 200);
      const r = await roster(workshop.id, 'director', firstDate);
      assert.equal(r.counts.going, 1);
      assert.equal(r.counts.no_response, 4);
    });

    await t.test('the nudge reaches only the people who have not answered', async () => {
      const res = await req(`/api/events/${workshop.id}/remind`, 'director', {
        method: 'POST', body: { date: firstDate },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.pending, 4, 'alice already answered, so she is not chased');
    });

    await t.test('capacity waitlists the answer rather than refusing it', async () => {
      const bob = await (await rsvp(workshop.id, 'bob', 'going', firstDate)).json();
      assert.equal(bob.waitlisted, false, 'second seat of two');
      const carol = await (await rsvp(workshop.id, 'carol', 'going', firstDate)).json();
      assert.equal(carol.status, 'going', 'she still said yes');
      assert.equal(carol.waitlisted, true, 'but the room is full');
    });

    await t.test('giving up a seat promotes the person queued behind', async () => {
      assert.equal((await rsvp(workshop.id, 'alice', 'not_going', firstDate)).status, 200);
      const r = await roster(workshop.id, 'director', firstDate);
      const carol = r.roster.find(x => x.user_id === 'carol');
      assert.equal(carol.waitlisted, 0, 'carol was promoted into the freed seat');
      assert.equal(r.counts.waitlisted, 0);
    });

    await t.test('answers are per occurrence, not per series', async () => {
      const second = isoDaysFromNow(14);
      await req(`/api/events/${weekly.id}/invites`, 'director', {
        method: 'POST', body: { crewIds: [crew.id], date: firstDate },
      });
      assert.equal((await rsvp(weekly.id, 'bob', 'going', firstDate)).status, 200);

      const week1 = await roster(weekly.id, 'director', firstDate);
      assert.equal(week1.counts.going, 1);

      // Nobody was invited to week 2, and bob's week-1 answer must not leak into it.
      const week2 = await roster(weekly.id, 'director', second);
      assert.equal(week2.occurrenceDate, second);
      assert.equal(week2.invitedCount, 0, 'week 2 has its own invite list');
      assert.equal(week2.counts.going, 0, "bob's answer belongs to week 1 only");
    });

    await t.test('a date that is not an occurrence is refused', async () => {
      const notAnOccurrence = isoDaysFromNow(10); // series is weekly from day 7
      assert.equal((await req(`/api/events/${weekly.id}/roster?date=${notAnOccurrence}`, 'director')).status, 404);
      assert.equal((await rsvp(weekly.id, 'bob', 'going', notAnOccurrence)).status, 404);
    });

    await t.test('the register records what happened, not what was said', async () => {
      const res = await req(`/api/events/${workshop.id}/attendance`, 'director', {
        method: 'POST',
        body: { date: firstDate, entries: [{ userId: 'bob', attended: true }, { userId: 'carol', attended: false }] },
      });
      assert.equal(res.status, 200);
      const r = await roster(workshop.id, 'director', firstDate);
      const bob = r.roster.find(x => x.user_id === 'bob');
      const carol = r.roster.find(x => x.user_id === 'carol');
      assert.equal(bob.status, 'going');
      assert.equal(bob.attended, 1);
      assert.equal(carol.status, 'going', 'carol said she was coming');
      assert.equal(carol.attended, 0, 'and did not turn up — the gap the register exists to show');
      assert.equal(r.counts.attended, 1);
    });

    await t.test('only the organiser can invite, chase or take the register', async () => {
      assert.equal((await req(`/api/events/${workshop.id}/invites`, 'bob',
        { method: 'POST', body: { userIds: ['dave'], date: firstDate } })).status, 403);
      assert.equal((await req(`/api/events/${workshop.id}/remind`, 'bob',
        { method: 'POST', body: { date: firstDate } })).status, 403);
      assert.equal((await req(`/api/events/${workshop.id}/attendance`, 'bob',
        { method: 'POST', body: { date: firstDate, entries: [{ userId: 'bob', attended: true }] } })).status, 403);
    });

    await t.test('a material change tells the people with a stake in it (v2.91.0)', async () => {
      const notesFor = async (who) => {
        const res = await req('/api/notifications?limit=50', who);
        const body = await res.json();
        const list = Array.isArray(body) ? body : (body.notifications || []);
        return list.filter(n => /^Changed: /.test(n.title || ''));
      };

      // carol is invited and answered; dave is invited; 'director' is editing.
      const beforeCarol = (await notesFor('carol')).length;
      const beforeDirector = (await notesFor('director')).length;

      const res = await req(`/api/events/${workshop.id}`, 'director', {
        method: 'PUT', body: { eventTime: '18:00', location: 'Studio 2' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.changed.sort(), ['eventTime', 'location']);
      assert.ok(body.notified > 0, 'somebody was told');

      const carol = await notesFor('carol');
      assert.equal(carol.length, beforeCarol + 1, 'carol had answered, so carol is told');
      assert.match(carol[0].body, /18:00|Studio 2/);

      // The person who made the change does not need telling about it.
      assert.equal((await notesFor('director')).length, beforeDirector,
        'the editor is not notified of their own edit');
    });

    await t.test('a cosmetic change tells nobody', async () => {
      const before = (await (await req('/api/notifications?limit=50', 'carol')).json());
      const count = (Array.isArray(before) ? before : before.notifications || [])
        .filter(n => /^Changed: /.test(n.title || '')).length;

      const res = await req(`/api/events/${workshop.id}`, 'director', {
        method: 'PUT', body: { description: 'bring comfortable shoes' },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.changed, [], 'description is not a material change');
      assert.equal(body.notified, 0);

      const after = (await (await req('/api/notifications?limit=50', 'carol')).json());
      const countAfter = (Array.isArray(after) ? after : after.notifications || [])
        .filter(n => /^Changed: /.test(n.title || '')).length;
      assert.equal(countAfter, count, 'no new noise for a typo fix');
    });

    await t.test('the organiser can suppress the alert for a material change', async () => {
      const notes = async () => {
        const body = await (await req('/api/notifications?limit=50', 'carol')).json();
        return (Array.isArray(body) ? body : body.notifications || [])
          .filter(n => /^Changed: /.test(n.title || '')).length;
      };
      const before = await notes();

      const res = await req(`/api/events/${workshop.id}`, 'director', {
        method: 'PUT', body: { location: 'Studio 3', notifyAttendees: false },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.changed, ['location'], 'it did change');
      assert.equal(body.notified, 0, 'but nobody was told, because it was asked not to');
      assert.equal(await notes(), before);
    });

    await t.test('wave staff can edit an event they did not create (v2.90.1)', async () => {
      // bob is nobody here yet, so this must fail first — otherwise the
      // promotion below would prove nothing.
      assert.equal((await req(`/api/events/${weekly.id}`, 'bob',
        { method: 'PUT', body: { location: 'Studio 2' } })).status, 403);

      // Make bob a moderator of the wave the event belongs to.
      assert.equal((await req(`/api/waves/${wave.id}/roles/bob`, 'director',
        { method: 'PUT', body: { role: 'moderator' } })).status, 200);

      assert.equal((await req(`/api/events/${weekly.id}`, 'bob',
        { method: 'PUT', body: { location: 'Studio 2' } })).status, 200,
        'wave staff may fix the event they are already allowed to organise');

      const detail = await (await req(`/api/events/${weekly.id}`, 'bob')).json();
      assert.equal(detail.event.location, 'Studio 2');
      assert.equal(detail.canManage, true, 'so the client can show the edit button');

      // Someone with no standing still cannot, and is told so.
      const outsider = await (await req(`/api/events/${weekly.id}`, 'dave')).json();
      assert.equal(outsider.canManage, false);
    });

    await t.test('a closed deadline stops answers but not the organiser', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      assert.equal((await req(`/api/events/${workshop.id}`, 'director',
        { method: 'PUT', body: { rsvpDeadline: past } })).status, 200);

      const late = await rsvp(workshop.id, 'dave', 'going', firstDate);
      assert.equal(late.status, 409);
      assert.equal((await late.json()).code, 'RSVP_CLOSED');

      assert.equal((await rsvp(workshop.id, 'director', 'going', firstDate)).status, 200,
        'the organiser can still fix things after the deadline');
    });
  } finally {
    if (child) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
