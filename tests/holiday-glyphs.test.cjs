// Holiday effects drew emoji with String.fromCharCode(0x1F987) and the like.
// fromCharCode takes 16-bit values, so anything above U+FFFF became a different
// character: the Halloween bat showed as 驪 and the ghost as an empty box or a
// Windows icon. v2.122.1 draws the shapes as SVG (client/src/components/effects/glyphs.jsx).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'client', 'src');
const EFFECTS = path.join(ROOT, 'components', 'effects', 'effects');

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return sources(p);
    return /\.(jsx?|mjs)$/.test(d.name) ? [p] : [];
  });
}

/** fromCharCode calls whose argument is a literal above U+FFFF, which it truncates. */
function truncatingCalls(text) {
  const out = [];
  for (const m of text.matchAll(/String\.fromCharCode\(\s*(0x[0-9a-fA-F]+|\d+)\s*\)/g)) {
    if (Number(m[1]) > 0xffff) out.push(m[0]);
  }
  return out;
}

test('no String.fromCharCode with a code point above U+FFFF anywhere in the client', () => {
  const bad = sources(ROOT).flatMap((f) =>
    truncatingCalls(fs.readFileSync(f, 'utf8')).map((c) => `${path.relative(ROOT, f)}: ${c}`));
  assert.deepStrictEqual(bad, []);
});

test('holiday effects draw shapes, not characters', () => {
  const glyphEffects = ['SpookyEffect.jsx', 'AutumnLeaves.jsx', 'HeartsEffect.jsx', 'ShamrockEffect.jsx', 'PastelOverlay.jsx', 'SnowEffect.jsx'];
  for (const name of glyphEffects) {
    const text = fs.readFileSync(path.join(EFFECTS, name), 'utf8');
    assert.match(text, /from '\.\.\/glyphs\.jsx'/, `${name} should use the drawn shapes`);
    assert.doesNotMatch(text, /fromCharCode|fromCodePoint/, `${name} should not draw characters`);
  }
  const glyphs = fs.readFileSync(path.join(ROOT, 'components', 'effects', 'glyphs.jsx'), 'utf8');
  for (const shape of ['Bat', 'Ghost', 'Pumpkin', 'Witch', 'MapleLeaf', 'OakLeaf', 'Leaf', 'Heart', 'Shamrock', 'Egg', 'Flower', 'Butterfly',
    'Snowflake', 'ChristmasTree', 'Menorah', 'Firework', 'Flag', 'Turkey']) {
    assert.match(glyphs, new RegExp(`export const ${shape} =`), `glyphs.jsx should export ${shape}`);
  }
});

test('counterfactual: the old Halloween code is caught', () => {
  const old = "{particle.type === 'bat' ? String.fromCharCode(0x1F987) : String.fromCharCode(0x1F47B)}";
  assert.deepStrictEqual(truncatingCalls(old), ['String.fromCharCode(0x1F987)', 'String.fromCharCode(0x1F47B)']);
  // ...and it really did produce the wrong characters.
  assert.strictEqual(String.fromCharCode(0x1F987), '驪');
  assert.notStrictEqual(String.fromCharCode(0x1F987), String.fromCodePoint(0x1F987));
});

// v2.122.2: the rest of the holiday surfaces. Every effect is drawn (the
// fireworks, candles and aurora were always CSS shapes), and the crawl-bar
// alert the server posts for a holiday no longer starts with an emoji.
test('no effect renders a text character as its particle', () => {
  for (const name of fs.readdirSync(EFFECTS)) {
    const text = fs.readFileSync(path.join(EFFECTS, name), 'utf8');
    // A particle that is text sits alone between tags, like >*< or >❄<.
    assert.doesNotMatch(text, /(?<![=-])>\s*[^\s<>{}()\w/]\s*</, `${name} draws a character`);
    assert.doesNotMatch(text, /fontSize/, `${name} sizes text`);
  }
});

test('server holiday alerts carry no emoji', () => {
  const holidays = fs.readFileSync(path.join(__dirname, '..', 'server', 'holidays.js'), 'utf8');
  assert.doesNotMatch(holidays, /\p{Extended_Pictographic}/u);
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const start = server.indexOf('// Holiday alerts');
  const create = server.indexOf('db.createAlert({', start);
  const block = server.slice(create, server.indexOf('});', create));
  assert.ok(start > 0 && block.includes('celebration is active!'));
  assert.doesNotMatch(block, /holiday\.emoji|\p{Extended_Pictographic}/u);
});

test('every holiday has a drawn alert picture, and old emoji titles are cleaned', () => {
  const config = fs.readFileSync(path.join(ROOT, 'config', 'holidays.js'), 'utf8');
  const ids = [...config.matchAll(/^  (\w+): \{$/gm)].map((m) => m[1]);
  assert.strictEqual(ids.length, 10);
  const icon = fs.readFileSync(path.join(ROOT, 'components', 'effects', 'HolidayIcon.jsx'), 'utf8');
  for (const id of ids) {
    const drawn = new RegExp(`^  ${id}: \\(size\\) =>`, 'm').test(icon) || (id === 'elderxeke' && icon.includes('/holidays/elderxeke.png'));
    assert.ok(drawn, `${id} has no alert picture`);
    assert.ok(icon.includes(`'${id}']`), `${id} is not matched from an alert title`);
  }
  // The emoji-stripping pattern, exercised on titles older servers wrote.
  const literal = icon.match(/title\.replace\((\/.+\/u), ''\)/)[1];
  const re = new Function(`return ${literal}`)();
  for (const old of ['🎃 Halloween celebration is active!', '🇺🇸 Independence Day celebration is active!', '☘️ St. Patrick\'s Day celebration is active!', '✨ ElderXeke Day celebration is active!']) {
    assert.match(old.replace(re, ''), /^[A-Z]/, old);
  }
  assert.strictEqual('Halloween celebration is active!'.replace(re, ''), 'Halloween celebration is active!');
});
