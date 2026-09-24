import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/args.mjs';

test('parseArgs: empty argv -> safe defaults', () => {
  const r = parseArgs([]);
  assert.equal(r.stale, null);
  assert.equal(r.gone, false);
  assert.deepEqual(r.keep, []);
  assert.equal(r.yes, false);
  assert.equal(r.force, false);
  assert.equal(r.dryRun, false);
  assert.equal(r.remote, false);
  assert.equal(r.help, false);
  assert.equal(r.version, false);
  assert.deepEqual(r.errors, []);
});

test('parseArgs: --stale <days> (space form)', () => {
  const r = parseArgs(['--stale', '30']);
  assert.equal(r.stale, 30);
  assert.deepEqual(r.errors, []);
});

test('parseArgs: --stale=<days> (inline form)', () => {
  const r = parseArgs(['--stale=45']);
  assert.equal(r.stale, 45);
});

test('parseArgs: --stale rejects non-numeric', () => {
  const r = parseArgs(['--stale', 'abc']);
  assert.equal(r.stale, null);
  assert.ok(r.errors.some((e) => /--stale/.test(e)));
});

test('parseArgs: --stale with a missing value does not swallow the next flag', () => {
  const r = parseArgs(['--stale', '--gone']);
  assert.equal(r.stale, null);
  assert.equal(r.gone, true); // --gone was NOT consumed as the value
  assert.ok(r.errors.some((e) => /--stale/.test(e)));
});

test('parseArgs: --keep splits a comma list and dedupes', () => {
  const r = parseArgs(['--keep', 'dev, staging ,dev']);
  assert.deepEqual(r.keep, ['dev', 'staging']);
});

test('parseArgs: --keep=<list> inline form', () => {
  const r = parseArgs(['--keep=a,b']);
  assert.deepEqual(r.keep, ['a', 'b']);
});

test('parseArgs: --keep with no value is an error', () => {
  const r = parseArgs(['--keep']);
  assert.ok(r.errors.some((e) => /--keep/.test(e)));
});

test('parseArgs: boolean flags', () => {
  const r = parseArgs(['--gone', '--yes', '--dry-run', '--remote']);
  assert.equal(r.gone, true);
  assert.equal(r.yes, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.remote, true);
});

test('parseArgs: -D and --force both set force', () => {
  assert.equal(parseArgs(['-D']).force, true);
  assert.equal(parseArgs(['--force']).force, true);
});

test('parseArgs: help and version', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-v']).version, true);
  assert.equal(parseArgs(['--version']).version, true);
});

test('parseArgs: unknown option becomes an error', () => {
  const r = parseArgs(['--bogus']);
  assert.ok(r.errors.some((e) => /unknown option/.test(e)));
});

test('parseArgs: positional argument is rejected', () => {
  const r = parseArgs(['3000']);
  assert.ok(r.errors.some((e) => /unexpected argument/.test(e)));
});

test('parseArgs: a realistic combination', () => {
  const r = parseArgs(['--stale', '30', '--keep', 'dev,staging', '--gone', '--dry-run']);
  assert.equal(r.stale, 30);
  assert.deepEqual(r.keep, ['dev', 'staging']);
  assert.equal(r.gone, true);
  assert.equal(r.dryRun, true);
  assert.deepEqual(r.errors, []);
});
