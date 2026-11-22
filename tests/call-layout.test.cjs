'use strict';

// Video call layout (v2.144.0): the other person fills the screen, you are a
// small preview in the lower right. It was an equal grid, you included.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const load = () => import(path.join(path.resolve(__dirname, '..'), 'client/src/utils/callLayout.js'));

const me = { id: 'm', participantId: 'me', isLocal: true, isScreen: false };
const zoe = { id: 'z', participantId: 'zoe', isLocal: false, isScreen: false };
const wash = { id: 'w', participantId: 'wash', isLocal: false, isScreen: false };
const washScreen = { id: 'ws', participantId: 'wash', isLocal: false, isScreen: true };
const myScreen = { id: 'ms', participantId: 'me', isLocal: true, isScreen: true };
const people = (...ids) => ids.map(id => ({ participantId: id, name: id }));

test('two people: they fill the screen, you are the preview', async () => {
  const { chooseCallLayout } = await load();
  assert.deepEqual(chooseCallLayout([me, zoe], { others: people('zoe') }), { main: zoe, mainPerson: null, pip: me, strip: [] });
});

test('their camera off: their name fills the screen, you stay the preview', async () => {
  const { chooseCallLayout } = await load();
  const l = chooseCallLayout([me], { others: people('zoe') });
  assert.equal(l.main, null);
  assert.equal(l.mainPerson.participantId, 'zoe');
  assert.equal(l.pip, me);
});

test('alone: your own camera, no preview', async () => {
  const { chooseCallLayout } = await load();
  assert.deepEqual(chooseCallLayout([me], { others: [] }), { main: me, mainPerson: null, pip: null, strip: [] });
});

test('three or more: the last speaker fills the screen, the rest are a strip', async () => {
  const { chooseCallLayout } = await load();
  const l = chooseCallLayout([me, zoe, wash], { speakerId: 'wash', others: people('zoe', 'wash') });
  assert.equal(l.main, wash);
  assert.equal(l.pip, me);
  assert.deepEqual(l.strip, [zoe]);
});

test('a shared screen wins, and a tap on anything fills the screen with it', async () => {
  const { chooseCallLayout } = await load();
  const all = [me, zoe, wash, washScreen];
  const l = chooseCallLayout(all, { speakerId: 'zoe', others: people('zoe', 'wash') });
  assert.equal(l.main, washScreen);
  assert.deepEqual(l.strip, [zoe, wash]);

  const pinned = chooseCallLayout(all, { pinnedId: 'z', others: people('zoe', 'wash') });
  assert.equal(pinned.main, zoe);

  const self = chooseCallLayout(all, { pinnedId: 'm', others: people('zoe', 'wash') });
  assert.equal(self.main, me);
  assert.equal(self.pip, null, 'you are not shown twice');
});

test('your own screen share is a thumbnail, not what you look at', async () => {
  const { chooseCallLayout } = await load();
  const l = chooseCallLayout([me, myScreen, zoe], { others: people('zoe') });
  assert.equal(l.main, zoe);
  assert.equal(l.pip, me);
  assert.deepEqual(l.strip, [myScreen]);
});

test('fit: crop only when the video is the same way round as the window; never a screen', async () => {
  const { fitFor } = await load();
  assert.equal(fitFor({ w: 720, h: 1280 }, { w: 390, h: 700 }, false), 'cover');
  assert.equal(fitFor({ w: 1280, h: 720 }, { w: 1280, h: 700 }, false), 'cover');
  assert.equal(fitFor({ w: 720, h: 1280 }, { w: 1280, h: 700 }, false), 'contain');
  assert.equal(fitFor({ w: 1280, h: 720 }, { w: 1280, h: 700 }, true), 'contain');
  assert.equal(fitFor(null, { w: 1, h: 1 }, false), 'contain');
  assert.equal(fitFor({ w: 1280, h: 720 }, { w: 390, h: 700 }, false, { fill: true }), 'cover', 'a phone fills the screen');
  assert.equal(fitFor({ w: 1280, h: 720 }, { w: 390, h: 700 }, true, { fill: true }), 'contain', 'a screen never crops');
});

test('phones capture upright; every call sends only the sizes people watch', async () => {
  const { callRoomOptions } = await load();
  const phone = callRoomOptions({ isMobile: true, cameraId: 'default' });
  assert.ok(phone.videoCaptureDefaults.resolution.height > phone.videoCaptureDefaults.resolution.width);
  assert.equal(phone.videoCaptureDefaults.deviceId, undefined);
  const desk = callRoomOptions({ isMobile: false, micId: 'mic1' });
  assert.ok(desk.videoCaptureDefaults.resolution.width > desk.videoCaptureDefaults.resolution.height);
  assert.equal(desk.audioCaptureDefaults.deviceId, 'mic1');
  assert.equal(desk.adaptiveStream, true);
  assert.equal(desk.dynacast, true);
});
