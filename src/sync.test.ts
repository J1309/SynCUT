import assert from 'node:assert/strict';
import { findActiveLineIndex, formatTime, buildMelodyWavDataUri } from './sync.ts';

const lines = [
  { time: 0, text: '♪' },
  { time: 30, text: 'ദൂരെ ദൂരെ അങ്ങ് ബെത്ലഹേമിൽ' },
  { time: 34, text: 'രാജരാജൻ മന്നിൽ പിറന്ന ദിനം' },
];

assert.equal(findActiveLineIndex([], 5), -1);
assert.equal(findActiveLineIndex(lines, 0), 0);
assert.equal(findActiveLineIndex(lines, 29.9), 0);
assert.equal(findActiveLineIndex(lines, 30.0), 1);
assert.equal(findActiveLineIndex(lines, 35.5), 2);

assert.equal(formatTime(0), '0:00');
assert.equal(formatTime(65.8), '1:05');
assert.equal(formatTime(-4), '0:00');

const uri = buildMelodyWavDataUri('test', [[440, 0.5]], 1);
assert.ok(uri.startsWith('data:audio/wav;base64,UklGR'));

console.log('All sync self-checks passed.');
