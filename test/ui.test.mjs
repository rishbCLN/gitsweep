import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeStyler,
  colorEnabled,
  relativeTime,
  candidateNote,
  formatCandidates,
} from '../src/ui.mjs';

const NOW = 1700000000000;
const S = Math.floor(NOW / 1000);
const MIDDOT = '\u00b7';

test('makeStyler: no-ops when disabled, wraps in ANSI when enabled', () => {
  const off = makeStyler(false);
  assert.equal(off.red('x'), 'x');
  const on = makeStyler(true);
  assert.equal(on.red('x'), '\x1b[31mx\x1b[39m');
});

test('colorEnabled: NO_COLOR disables, FORCE_COLOR enables, else follows TTY', () => {
  assert.equal(colorEnabled({ NO_COLOR: '1' }, { isTTY: true }), false);
  assert.equal(colorEnabled({ FORCE_COLOR: '1' }, { isTTY: false }), true);
  assert.equal(colorEnabled({}, { isTTY: true }), true);
  assert.equal(colorEnabled({}, { isTTY: false }), false);
});

test('relativeTime: null / non-finite -> unknown', () => {
  assert.equal(relativeTime(null, NOW), 'unknown');
  assert.equal(relativeTime(NaN, NOW), 'unknown');
});

test('relativeTime: buckets seconds up through years', () => {
  assert.equal(relativeTime(S, NOW), 'just now');
  assert.equal(relativeTime(S - 90, NOW), '1 minute ago');
  assert.equal(relativeTime(S - 2 * 3600, NOW), '2 hours ago');
  assert.equal(relativeTime(S - 1 * 86400, NOW), '1 day ago');
  assert.equal(relativeTime(S - 3 * 86400, NOW), '3 days ago');
  assert.equal(relativeTime(S - 10 * 86400, NOW), '1 week ago');
  assert.equal(relativeTime(S - 45 * 86400, NOW), '1 month ago');
  assert.equal(relativeTime(S - 400 * 86400, NOW), '1 year ago');
});

test('relativeTime: a future timestamp is clamped to "just now"', () => {
  assert.equal(relativeTime(S + 500, NOW), 'just now');
});

test('candidateNote: joins reasons and appends age', () => {
  assert.equal(
    candidateNote({ reasons: ['merged'], committerdate: S - 3 * 86400 }, NOW),
    `merged ${MIDDOT} 3 days ago`,
  );
});

test('candidateNote: maps "gone" to a readable label and handles unknown age', () => {
  assert.equal(
    candidateNote({ reasons: ['stale', 'gone'], committerdate: null }, NOW),
    `stale ${MIDDOT} upstream gone`,
  );
});

test('formatCandidates: aligns names and stays plain with color disabled', () => {
  const c = makeStyler(false);
  const out = formatCandidates(
    [
      { name: 'feature/login', merged: true, reasons: ['merged'], committerdate: S - 3 * 86400 },
      { name: 'x', merged: true, reasons: ['merged'], committerdate: S - 2 * 3600 },
    ],
    c,
    { now: NOW },
  );
  const lines = out.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('feature/login'));
  assert.ok(lines[0].includes('3 days ago'));
  // second name is padded to the width of the longest name
  assert.ok(lines[1].includes('x            '));
});

test('formatCandidates: empty list -> empty string', () => {
  assert.equal(formatCandidates([], makeStyler(false)), '');
});
