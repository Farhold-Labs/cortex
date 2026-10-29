// v2.123.1: waves in a Community channel sat level with the Community heading,
// left of their own channel, and channel names stayed 0.75rem whatever the
// wave density — smaller than the waves inside them at Spacious.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'client/src', f), 'utf8');

test('waves in a channel are nested one step past the channel', () => {
  const list = read('components/waves/WaveList.jsx');
  // v2.125.0: a Community's channels live in its own panel, starting at
  // `base`, with their waves one step further in.
  assert.match(list, /chWaves\.map\(wave => renderWaveItem\(wave, true, channelWaveMove\(wave, chWaves, channel\), base \+ 1\)\)/);
  assert.match(list, /paddingLeft: indent \? `calc\(\$\{0\.75 \+ indent \* 0\.75\}rem - 3px\)`/);
  // Header steps are rem, so they scale with FONT SIZE like the rows do.
  assert.match(read('components/ui/CollapsibleSection.jsx'), /paddingLeft: `\$\{0\.75 \+ indent \* 0\.75\}rem`/);
});

test('channel names follow the wave density, headings scale with it', () => {
  const list = read('components/waves/WaveList.jsx');
  const channelHeader = list.slice(list.indexOf('title={`# ${channel.name}`}'), list.indexOf('menuTitle={`#${channel.name} options`}'));
  assert.match(channelHeader, /titleSize=\{densityStyle\.fontSize\}/);
  assert.match(list, /<VoiceChannelSection[\s\S]*?titleSize=\{densityStyle\.fontSize\}/);
  const { WAVE_DENSITY } = { WAVE_DENSITY: eval('(' + read('config/constants.js').match(/export const WAVE_DENSITY = (\{[\s\S]*?\n\});/)[1] + ')') };
  for (const d of Object.values(WAVE_DENSITY)) assert.ok(d.headingSize && d.fontSize, d.name);
  assert.ok(parseFloat(WAVE_DENSITY.spacious.headingSize) > parseFloat(WAVE_DENSITY.comfy.headingSize));
});
