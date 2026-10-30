'use strict';

// Video links play in the wave (v2.133.0): TikTok, Instagram, Facebook, Twitch,
// Dailymotion, Streamable and Rumble, beside YouTube and Vimeo. Each becomes
// the provider's own iframe player. TikTok was a link card that left the app,
// because its old embed.js could not live inside React; its iframe player can.
//
// These run the real detectEmbedUrls (client) and the real oEmbed player check
// (lifted out of server.js), without touching the network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
let detectEmbedUrls;
test.before(async () => {
  ({ detectEmbedUrls } = await import(pathToFileURL(path.join(root, 'client/src/utils/embed.js')).href));
});
const one = (url) => {
  const found = detectEmbedUrls(url);
  assert.equal(found.length, 1, `${url} → ${JSON.stringify(found)}`);
  return found[0];
};

test('each provider link becomes that provider’s own player', () => {
  const cases = [
    ['https://www.tiktok.com/@nasa/video/7679483952507276558', 'tiktok', 'https://www.tiktok.com/player/v1/7679483952507276558?music_info=1&description=1&rel=0', true],
    ['https://www.instagram.com/p/BsOGulcndj-/', 'instagram', 'https://www.instagram.com/p/BsOGulcndj-/embed/', true],
    ['https://www.instagram.com/reels/C5Qn3sYxyzq/', 'instagram', 'https://www.instagram.com/reel/C5Qn3sYxyzq/embed/', true],
    ['https://www.instagram.com/someone/reel/C5Qn3sYxyzq/?igsh=abc', 'instagram', 'https://www.instagram.com/reel/C5Qn3sYxyzq/embed/', true],
    ['https://www.facebook.com/facebook/videos/10153231379946729/', 'facebook',
      'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Ffacebook%2Fvideos%2F10153231379946729%2F&show_text=false', false],
    ['https://www.facebook.com/reel/1234567890', 'facebook',
      'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2Freel%2F1234567890&show_text=false', true],
    ['https://www.dailymotion.com/video/x8j9h1k', 'dailymotion', 'https://geo.dailymotion.com/player.html?video=x8j9h1k', false],
    ['https://dai.ly/x8j9h1k', 'dailymotion', 'https://geo.dailymotion.com/player.html?video=x8j9h1k', false],
    ['https://streamable.com/moo12', 'streamable', 'https://streamable.com/e/moo12', false],
    ['https://rumble.com/embed/v7f3ojg/', 'rumble', 'https://rumble.com/embed/v7f3ojg/', false],
  ];
  for (const [url, platform, embedUrl, portrait] of cases) {
    const e = one(url);
    assert.equal(e.platform, platform, url);
    assert.equal(e.embedUrl, embedUrl, url);
    assert.equal(Boolean(e.portrait), portrait, `${url} portrait`);
  }
});

test('Twitch is told which site frames it, or it will not play', () => {
  // No window in Node: the fallback host stands in for location.hostname.
  assert.equal(one('https://www.twitch.tv/videos/2241234567').embedUrl, 'https://player.twitch.tv/?video=2241234567&parent=localhost&autoplay=false');
  assert.equal(one('https://clips.twitch.tv/FunnyClipSlug-abc').embedUrl, 'https://clips.twitch.tv/embed?clip=FunnyClipSlug-abc&parent=localhost&autoplay=false');
  assert.equal(one('https://www.twitch.tv/someone/clip/FunnyClipSlug-abc').embedUrl, 'https://clips.twitch.tv/embed?clip=FunnyClipSlug-abc&parent=localhost&autoplay=false');
  assert.equal(one('https://www.twitch.tv/somechannel').embedUrl, 'https://player.twitch.tv/?channel=somechannel&parent=localhost&autoplay=false');
});

test('a link that does not name its video waits for the server to resolve it', () => {
  for (const url of ['https://vm.tiktok.com/ZMhvqKpXy/', 'https://www.tiktok.com/t/ZTabc123/', 'https://rumble.com/v7ha1gy-mad-at-the-internet.html']) {
    const e = one(url);
    assert.equal(e.embedUrl, null, url);
  }
});

test('YouTube Shorts get an upright box; ordinary videos do not', () => {
  assert.equal(one('https://www.youtube.com/shorts/dQw4w9WgXcQ').portrait, true);
  assert.equal(Boolean(one('https://www.youtube.com/watch?v=dQw4w9WgXcQ').portrait), false);
});

test('a link that only mentions a provider is not taken for its video', () => {
  for (const url of [
    'https://evil.example/?u=https://www.tiktok.com/@a/video/123',
    'https://example.com/www.instagram.com/p/abc/',
    'https://notfacebook.com/reel/123',
    'https://www.tiktok.com/discover/nasa',
  ]) {
    assert.deepEqual(detectEmbedUrls(url), [], url);
  }
});

test('the server accepts a player address from oEmbed only if it is the provider’s own player', () => {
  const src = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  const start = src.indexOf('const OEMBED_PLAYERS');
  const end = src.indexOf('async function resolveTiktokShortLink');
  assert.ok(start > 0 && end > start, 'oEmbed player check found in server.js');
  const oembedPlayerUrl = new Function(`${src.slice(start, end)}; return oembedPlayerUrl;`)();

  assert.equal(oembedPlayerUrl('tiktok', { embed_product_id: '7679483952507276558' }),
    'https://www.tiktok.com/player/v1/7679483952507276558?music_info=1&description=1&rel=0');
  assert.equal(oembedPlayerUrl('tiktok', { embed_product_id: '12"><script>' }), null);
  assert.equal(oembedPlayerUrl('rumble', { html: '<iframe src="https://rumble.com/embed/v7f3ojg/" width="1920"></iframe>' }),
    'https://rumble.com/embed/v7f3ojg/');
  // A provider answer naming somewhere else is not put in a frame.
  assert.equal(oembedPlayerUrl('rumble', { html: '<iframe src="https://evil.example/embed/v1/"></iframe>' }), null);
  assert.equal(oembedPlayerUrl('rumble', { html: '<iframe src="https://rumble.com.evil.example/embed/v1/"></iframe>' }), null);
  assert.equal(oembedPlayerUrl('rumble', { html: '<iframe src="javascript:alert(1)"></iframe>' }), null);
  // Providers whose links name their video never take a player from oEmbed.
  assert.equal(oembedPlayerUrl('vimeo', { html: '<iframe src="https://player.vimeo.com/video/1"></iframe>' }), null);
});

test('the TikTok short-link redirect is rebuilt on TikTok’s host, never fetched as given', () => {
  const src = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function resolveTiktokShortLink'), src.indexOf('// Simple in-memory cache for oEmbed responses'));
  assert.match(fn, /const target = m\[1\]\.toLowerCase\(\) === 't'/);
  assert.doesNotMatch(fn, /fetch\(url\b/, 'the address as given is never fetched');
  assert.match(fn, /redirect: 'manual'/);
});
