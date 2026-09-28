import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMergedBranches,
  parseForEachRef,
  selectStale,
  selectGone,
  isProtectedBranch,
  isValidBranchName,
  buildCandidates,
  collectBranches,
  deleteBranch,
  deleteRemoteBranch,
  FOR_EACH_REF_FORMAT,
} from '../src/git.mjs';

// A fixed "now" so time-based tests are deterministic.
const NOW = 1700000000000;
const S = Math.floor(NOW / 1000); // 1700000000
const days = (d) => S - d * 86400;
const hours = (h) => S - h * 3600;

// -------------------------------------------------------------------------
// parseMergedBranches
// -------------------------------------------------------------------------

test('parseMergedBranches: reads names and records the * current branch', () => {
  const out = `  feature/login\n* main\n  fix/typo-header\n`;
  const { branches, current } = parseMergedBranches(out);
  assert.deepEqual(branches, ['feature/login', 'main', 'fix/typo-header']);
  assert.equal(current, 'main');
});

test('parseMergedBranches: handles the "+" worktree marker', () => {
  const out = `  feature/a\n+ feature/b\n* main\n`;
  const { branches, current } = parseMergedBranches(out);
  assert.deepEqual(branches, ['feature/a', 'feature/b', 'main']);
  assert.equal(current, 'main');
});

test('parseMergedBranches: reports "+" worktree branches separately', () => {
  const out = `  feature/a\n+ feature/b\n+ feature/c\n* main\n`;
  const { branches, current, worktrees } = parseMergedBranches(out);
  assert.deepEqual(branches, ['feature/a', 'feature/b', 'feature/c', 'main']);
  assert.deepEqual(worktrees, ['feature/b', 'feature/c']);
  assert.equal(current, 'main');
});

test('parseMergedBranches: detached HEAD -> current is null and the marker line is skipped', () => {
  const out = `* (HEAD detached at 1a2b3c4)\n  feature/a\n  main\n`;
  const { branches, current } = parseMergedBranches(out);
  assert.deepEqual(branches, ['feature/a', 'main']);
  assert.equal(current, null);
});

// Regression: a *linked worktree* in detached state is shown with the "+" marker,
// e.g. "+ (HEAD detached at abc123)". The "(" detached-HEAD guard previously only
// covered the "*" (this-worktree) case, so a detached worktree HEAD leaked in as a
// bogus branch name "(HEAD detached at abc123)" — both into `branches` and, worse,
// into `worktrees`. It must be skipped for every marker.
test('parseMergedBranches: detached HEAD in a linked worktree ("+") is skipped too', () => {
  const out = `  feature/a\n+ (HEAD detached at 9f8e7d6)\n* main\n`;
  const { branches, current, worktrees } = parseMergedBranches(out);
  assert.deepEqual(branches, ['feature/a', 'main']);
  assert.deepEqual(worktrees, []);
  assert.equal(current, 'main');
});

test('parseMergedBranches: empty output', () => {
  assert.deepEqual(parseMergedBranches(''), { branches: [], current: null, worktrees: [] });
});

// -------------------------------------------------------------------------
// parseForEachRef
// -------------------------------------------------------------------------

const FER = [
  ` \tfeature/login\t${days(10)}\t`,
  ` \tfix/typo\t${hours(2)}\t`,
  ` \told/thing\t${days(100)}\t[gone]`,
  `*\tmain\t${days(1)}\t[ahead 1, behind 2]`,
].join('\n');

test('parseForEachRef: format constant is tab-delimited', () => {
  assert.ok(FOR_EACH_REF_FORMAT.includes('%09'));
});

test('parseForEachRef: parses HEAD marker, unix date, and upstream track', () => {
  const rows = parseForEachRef(FER);
  assert.equal(rows.length, 4);

  const login = rows.find((r) => r.name === 'feature/login');
  assert.equal(login.current, false);
  assert.equal(login.committerdate, days(10));
  assert.equal(login.gone, false);

  const gone = rows.find((r) => r.name === 'old/thing');
  assert.equal(gone.gone, true);

  const main = rows.find((r) => r.name === 'main');
  assert.equal(main.current, true);
  // track with a space + comma survives as one field:
  assert.equal(main.track, '[ahead 1, behind 2]');
  assert.equal(main.gone, false);
});

test('parseForEachRef: tolerates blank lines and missing fields', () => {
  const rows = parseForEachRef(` \tsolo\t\t\n\n`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'solo');
  assert.equal(rows[0].committerdate, null);
});

// -------------------------------------------------------------------------
// selectStale / selectGone
// -------------------------------------------------------------------------

test('selectStale: only branches older than <days>', () => {
  const rows = parseForEachRef(FER);
  assert.deepEqual(selectStale(rows, 30, NOW), ['old/thing']);
  assert.deepEqual(selectStale(rows, 5, NOW).sort(), ['feature/login', 'old/thing']);
  assert.deepEqual(selectStale(rows, 200, NOW), []);
});

test('selectStale: guards against bad input', () => {
  const rows = parseForEachRef(FER);
  assert.deepEqual(selectStale(rows, NaN, NOW), []);
  assert.deepEqual(selectStale(rows, -1, NOW), []);
});

test('selectGone: only branches whose upstream is gone', () => {
  const rows = parseForEachRef(FER);
  assert.deepEqual(selectGone(rows), ['old/thing']);
});

// -------------------------------------------------------------------------
// isProtectedBranch / isValidBranchName
// -------------------------------------------------------------------------

test('isProtectedBranch: base, current, keep, defaults and release/*', () => {
  const opts = { base: 'main', current: 'feature/checkout', keep: ['staging'] };
  assert.equal(isProtectedBranch('main', opts), true);      // base + default
  assert.equal(isProtectedBranch('master', opts), true);    // default
  assert.equal(isProtectedBranch('develop', opts), true);   // default
  assert.equal(isProtectedBranch('release/1.0', opts), true); // release/*
  assert.equal(isProtectedBranch('feature/checkout', opts), true); // current
  assert.equal(isProtectedBranch('staging', opts), true);   // keep
  assert.equal(isProtectedBranch('feature/login', opts), false);
});

test('isValidBranchName: accepts normal names', () => {
  assert.equal(isValidBranchName('feature/login'), true);
  assert.equal(isValidBranchName('ok-name_1.2'), true);
});

test('isValidBranchName: rejects dangerous / malformed names', () => {
  assert.equal(isValidBranchName(''), false);
  assert.equal(isValidBranchName('-D'), false);         // looks like a flag
  assert.equal(isValidBranchName('--force'), false);
  assert.equal(isValidBranchName('has space'), false);
  assert.equal(isValidBranchName('a..b'), false);
  assert.equal(isValidBranchName('foo/'), false);
  assert.equal(isValidBranchName('bar.lock'), false);
  assert.equal(isValidBranchName('a~b'), false);
  assert.equal(isValidBranchName('a:b'), false);
});

// -------------------------------------------------------------------------
// buildCandidates
// -------------------------------------------------------------------------

test('buildCandidates: merged-only, protected removed, oldest first', () => {
  const merged = ['feature/login', 'fix/typo', 'main'];
  const refs = parseForEachRef(FER);
  const out = buildCandidates({
    merged,
    refs,
    base: 'main',
    current: 'feature/checkout',
    now: NOW,
  });
  assert.deepEqual(out.map((x) => x.name), ['feature/login', 'fix/typo']);
  assert.ok(out.every((x) => x.merged === true));
  assert.deepEqual(out[0].reasons, ['merged']);
});

test('buildCandidates: --stale + --gone add unmerged candidates', () => {
  const merged = ['feature/login', 'fix/typo', 'main'];
  const refs = parseForEachRef(FER);
  const out = buildCandidates({
    merged,
    refs,
    base: 'main',
    current: 'feature/checkout',
    staleDays: 30,
    includeGone: true,
    now: NOW,
  });
  assert.deepEqual(out.map((x) => x.name), ['old/thing', 'feature/login', 'fix/typo']);
  const old = out.find((x) => x.name === 'old/thing');
  assert.equal(old.merged, false);
  assert.deepEqual(old.reasons, ['stale', 'gone']);
  assert.equal(old.gone, true);
});

test('buildCandidates: --keep removes a branch that would otherwise qualify', () => {
  const merged = ['feature/login', 'fix/typo'];
  const refs = parseForEachRef(FER);
  const out = buildCandidates({
    merged,
    refs,
    base: 'main',
    current: 'feature/checkout',
    keep: ['feature/login'],
    now: NOW,
  });
  assert.deepEqual(out.map((x) => x.name), ['fix/typo']);
});

test('buildCandidates: worktree branches are never offered (git refuses to delete them)', () => {
  // feature/login is checked out in another worktree ("+" in `git branch --merged`);
  // even though it is merged, `git branch -d` would refuse it, so it must be excluded.
  const merged = ['feature/login', 'fix/typo', 'main'];
  const refs = parseForEachRef(FER);
  const out = buildCandidates({
    merged,
    refs,
    base: 'main',
    current: 'feature/checkout',
    worktrees: ['feature/login'],
    now: NOW,
  });
  assert.deepEqual(out.map((x) => x.name), ['fix/typo']);
});

test('buildCandidates: a worktree branch surfaced by --stale/--gone is still excluded', () => {
  const merged = ['fix/typo'];
  const refs = parseForEachRef(FER);
  const out = buildCandidates({
    merged,
    refs,
    base: 'main',
    current: 'feature/checkout',
    worktrees: ['old/thing'],
    staleDays: 30,
    includeGone: true,
    now: NOW,
  });
  // old/thing is stale + gone but held by a worktree -> must not be offered.
  assert.deepEqual(out.map((x) => x.name), ['fix/typo']);
});

// -------------------------------------------------------------------------
// collectBranches (orchestration with an injected `run`)
// -------------------------------------------------------------------------

const MERGED_OUT = `  feature/login\n* feature/checkout\n  fix/typo\n  main\n`;

function makeRun(overrides = {}) {
  return async (cmd, args) => {
    assert.equal(cmd, 'git');
    if (args[0] === 'branch' && args[1] === '--merged') {
      return { code: 0, stdout: overrides.merged ?? MERGED_OUT, stderr: '' };
    }
    if (args[0] === 'for-each-ref') {
      return { code: 0, stdout: overrides.fer ?? FER, stderr: '' };
    }
    return { code: 1, stdout: '', stderr: 'unexpected' };
  };
}

test('collectBranches: default gathers merged branches, protected removed', async () => {
  const out = await collectBranches({
    run: makeRun(),
    base: 'main',
    current: 'feature/checkout',
    now: NOW,
  });
  assert.deepEqual(out.map((x) => x.name), ['feature/login', 'fix/typo']);
});

test('collectBranches: with --stale/--gone includes unmerged candidates', async () => {
  const out = await collectBranches({
    run: makeRun(),
    base: 'main',
    current: 'feature/checkout',
    staleDays: 30,
    includeGone: true,
    now: NOW,
  });
  assert.deepEqual(out.map((x) => x.name), ['old/thing', 'feature/login', 'fix/typo']);
});

test('collectBranches: excludes "+" worktree branches from the offer list', async () => {
  // feature/login shows up as a worktree branch ("+") in `git branch --merged` output.
  const merged = `+ feature/login\n* feature/checkout\n  fix/typo\n  main\n`;
  const out = await collectBranches({
    run: makeRun({ merged }),
    base: 'main',
    current: 'feature/checkout',
    now: NOW,
  });
  assert.deepEqual(out.map((x) => x.name), ['fix/typo']);
});

// -------------------------------------------------------------------------
// deleteBranch / deleteRemoteBranch (side effects injected)
// -------------------------------------------------------------------------

test('deleteBranch: safe delete passes args as an array with -d and --', async () => {
  let captured;
  const run = async (cmd, args) => {
    captured = { cmd, args };
    return { code: 0, stdout: `Deleted branch feature/x (was abc1234).`, stderr: '' };
  };
  const r = await deleteBranch('feature/x', { run });
  assert.deepEqual(r, { name: 'feature/x', ok: true });
  assert.equal(captured.cmd, 'git');
  assert.deepEqual(captured.args, ['branch', '-d', '--', 'feature/x']);
});

test('deleteBranch: force delete uses -D', async () => {
  let captured;
  const run = async (cmd, args) => {
    captured = args;
    return { code: 0, stdout: '', stderr: '' };
  };
  const r = await deleteBranch('feature/x', { run, force: true });
  assert.equal(r.ok, true);
  assert.deepEqual(captured, ['branch', '-D', '--', 'feature/x']);
});

test('deleteBranch: an unmerged branch is flagged notMerged, not a hard error', async () => {
  const run = async () => ({
    code: 1,
    stdout: '',
    stderr: "error: The branch 'feature/x' is not fully merged.\n",
  });
  const r = await deleteBranch('feature/x', { run });
  assert.equal(r.ok, false);
  assert.equal(r.notMerged, true);
});

test('deleteBranch: refuses an invalid/dangerous name WITHOUT calling git', async () => {
  let called = false;
  const run = async () => { called = true; return { code: 0, stdout: '', stderr: '' }; };
  const r = await deleteBranch('-D', { run });
  assert.equal(r.ok, false);
  assert.equal(called, false);
  assert.match(r.error, /invalid/i);
});

test('deleteRemoteBranch: pushes a delete to the named remote', async () => {
  let captured;
  const run = async (cmd, args) => {
    captured = { cmd, args };
    return { code: 0, stdout: '', stderr: '' };
  };
  const r = await deleteRemoteBranch('feature/x', { run, remote: 'origin' });
  assert.equal(r.ok, true);
  assert.equal(captured.cmd, 'git');
  assert.deepEqual(captured.args, ['push', 'origin', '--delete', '--', 'feature/x']);
});

test('deleteRemoteBranch: refuses an invalid name without calling git', async () => {
  let called = false;
  const run = async () => { called = true; return { code: 0, stdout: '', stderr: '' }; };
  const r = await deleteRemoteBranch('bad name', { run });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});
