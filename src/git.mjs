// Talking to git.
//
// All of the text parsing is split into small PURE functions (parseMergedBranches,
// parseForEachRef, buildCandidates, selectStale, selectGone, isProtectedBranch,
// isValidBranchName) so they can be unit-tested against captured real-world output.
// The impure orchestration (isInsideRepo, detectBase, collectBranches, deleteBranch…)
// takes an injectable `run` so it is testable without a real git repo.
import { run as defaultRun } from './run.mjs';

// Tab-delimited so branch names (which may contain "/", "-", ".") stay intact and
// upstream:track (e.g. "[ahead 1, behind 2]") — which contains spaces and commas —
// survives as a single trailing field.
export const FOR_EACH_REF_FORMAT =
  '%(HEAD)%09%(refname:short)%09%(committerdate:unix)%09%(upstream:track)';

// Branch names we never delete, regardless of merge state.
export const DEFAULT_PROTECTED = ['main', 'master', 'develop'];

// -------------------------------------------------------------------------
// PURE parsing / filtering
// -------------------------------------------------------------------------

/**
 * Parse `git branch --merged <base>` output.
 * Handles the "* current" marker, the "+ worktree" marker, and detached HEAD.
 * @param {string} stdout
 * @returns {{ branches: string[], current: string|null }}
 */
export function parseMergedBranches(stdout) {
  const branches = [];
  let current = null;
  for (const raw of String(stdout).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const marker = line[0];
    const name = line.slice(2).trim();
    if (!name) continue;
    if (marker === '*') {
      // Detached HEAD shows up as "* (HEAD detached at abc123)".
      if (name.startsWith('(')) continue;
      current = name;
      branches.push(name);
    } else {
      // "  name" (normal) or "+ name" (checked out in another worktree).
      branches.push(name);
    }
  }
  return { branches, current };
}

/**
 * Parse `git for-each-ref --format=FOR_EACH_REF_FORMAT refs/heads` output.
 * @param {string} stdout
 * @returns {Array<{ name: string, current: boolean, committerdate: number|null,
 *                   track: string, gone: boolean }>}
 */
export function parseForEachRef(stdout) {
  const rows = [];
  for (const raw of String(stdout).split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const parts = raw.split('\t');
    const head = (parts[0] ?? '').trim();
    const name = (parts[1] ?? '').trim();
    const dateStr = (parts[2] ?? '').trim();
    const track = (parts[3] ?? '').trim();
    if (!name) continue;
    rows.push({
      name,
      current: head === '*',
      committerdate: /^\d+$/.test(dateStr) ? Number(dateStr) : null,
      track,
      gone: /\[gone\]/.test(track),
    });
  }
  return rows;
}

/**
 * Names of branches whose last commit is older than `days` days.
 * @param {ReturnType<typeof parseForEachRef>} refs
 * @param {number} days
 * @param {number} [now] epoch ms
 * @returns {string[]}
 */
export function selectStale(refs, days, now = Date.now()) {
  if (!Number.isFinite(days) || days < 0) return [];
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const out = [];
  for (const r of refs) {
    if (r.committerdate == null) continue;
    if (r.committerdate * 1000 < cutoff) out.push(r.name);
  }
  return out;
}

/**
 * Names of branches whose upstream is gone.
 * @param {ReturnType<typeof parseForEachRef>} refs
 * @returns {string[]}
 */
export function selectGone(refs) {
  return refs.filter((r) => r.gone).map((r) => r.name);
}

/**
 * Is a branch protected from deletion?
 * @param {string} name
 * @param {{ base?: string, current?: string, keep?: string[] }} [opts]
 * @returns {boolean}
 */
export function isProtectedBranch(name, opts = {}) {
  if (!name) return true;
  const keep = opts.keep || [];
  if (name === opts.base) return true;
  if (name === opts.current) return true;
  if (keep.includes(name)) return true;
  if (DEFAULT_PROTECTED.includes(name)) return true;
  if (name.startsWith('release/')) return true;
  return false;
}

/**
 * Validate a branch name before handing it to git. This is defence-in-depth on
 * top of always passing args as an array (never a shell string): a leading "-"
 * could be mistaken for an option, and the other rules mirror git-check-ref-format.
 * @param {string} name
 * @returns {boolean}
 */
export function isValidBranchName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 255) return false;
  if (name.startsWith('-')) return false;              // never let a name look like a flag
  if (/[\x00-\x20 ~^:?*[\\]/.test(name)) return false; // control chars, space, and git-forbidden chars
  if (name.includes('..')) return false;
  if (name.includes('@{')) return false;
  if (name.startsWith('/') || name.endsWith('/')) return false;
  if (name.endsWith('.') || name.endsWith('.lock')) return false;
  return true;
}

/**
 * Combine merged / stale / gone signals into a filtered, sorted candidate list.
 * Pure: given the parsed git output it deterministically produces the branches
 * gitsweep will offer to delete (protected branches removed).
 *
 * @param {{
 *   merged?: string[],
 *   refs?: ReturnType<typeof parseForEachRef>,
 *   base?: string, current?: string, keep?: string[],
 *   staleDays?: number|null, includeGone?: boolean, now?: number
 * }} input
 * @returns {Array<{ name: string, reasons: string[], merged: boolean,
 *                   committerdate: number|null, gone: boolean }>}
 */
export function buildCandidates(input = {}) {
  const {
    merged = [],
    refs = [],
    base,
    current,
    keep = [],
    staleDays = null,
    includeGone = false,
    now = Date.now(),
  } = input;

  const mergedSet = new Set(merged);
  const staleSet = new Set(staleDays != null ? selectStale(refs, staleDays, now) : []);
  const goneSet = new Set(includeGone ? selectGone(refs) : []);
  const refByName = new Map(refs.map((r) => [r.name, r]));

  const names = new Set([...mergedSet, ...staleSet, ...goneSet]);
  const candidates = [];
  for (const name of names) {
    if (isProtectedBranch(name, { base, current, keep })) continue;
    const reasons = [];
    if (mergedSet.has(name)) reasons.push('merged');
    if (staleSet.has(name)) reasons.push('stale');
    if (goneSet.has(name)) reasons.push('gone');
    const ref = refByName.get(name) || null;
    candidates.push({
      name,
      reasons,
      merged: mergedSet.has(name),
      committerdate: ref ? ref.committerdate : null,
      gone: ref ? ref.gone : false,
    });
  }

  // Oldest first (stalest at the top); ties broken by name for stable output.
  candidates.sort((a, b) => {
    const ad = a.committerdate == null ? Infinity : a.committerdate;
    const bd = b.committerdate == null ? Infinity : b.committerdate;
    if (ad !== bd) return ad - bd;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return candidates;
}

// -------------------------------------------------------------------------
// Impure orchestration (thin; `run` is injectable for tests)
// -------------------------------------------------------------------------

/**
 * True if the current working directory is inside a git work tree.
 * @param {{ run?: typeof defaultRun }} [opts]
 * @returns {Promise<boolean>}
 */
export async function isInsideRepo(opts = {}) {
  const run = opts.run || defaultRun;
  const { code, stdout } = await run('git', ['rev-parse', '--is-inside-work-tree']);
  return code === 0 && String(stdout).trim() === 'true';
}

/**
 * Detect the base branch: prefer a local main/master/develop, else fall back to
 * origin/HEAD's target.
 * @param {{ run?: typeof defaultRun, candidates?: string[] }} [opts]
 * @returns {Promise<string|null>}
 */
export async function detectBase(opts = {}) {
  const run = opts.run || defaultRun;
  const candidates = opts.candidates || ['main', 'master', 'develop'];
  for (const name of candidates) {
    const { code } = await run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]);
    if (code === 0) return name;
  }
  const { code, stdout } = await run('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (code === 0) {
    const base = String(stdout).trim().replace(/^origin\//, '');
    if (base) return base;
  }
  return null;
}

/**
 * The checked-out branch, or null when HEAD is detached.
 * @param {{ run?: typeof defaultRun }} [opts]
 * @returns {Promise<string|null>}
 */
export async function getCurrentBranch(opts = {}) {
  const run = opts.run || defaultRun;
  const { code, stdout } = await run('git', ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (code === 0) {
    const name = String(stdout).trim();
    return name || null;
  }
  return null;
}

/**
 * Gather the branches gitsweep should offer to delete. Impure (shells out to git)
 * but fully driven by an injectable `run`, so it is tested with captured output.
 * @param {{
 *   run?: typeof defaultRun, base: string, current?: string, keep?: string[],
 *   staleDays?: number|null, includeGone?: boolean, now?: number
 * }} opts
 */
export async function collectBranches(opts = {}) {
  const run = opts.run || defaultRun;
  const { base, current, keep = [], staleDays = null, includeGone = false, now = Date.now() } = opts;

  const mergedRes = await run('git', ['branch', '--merged', base]);
  const { branches: merged } = parseMergedBranches(mergedRes.stdout);

  const refRes = await run('git', ['for-each-ref', `--format=${FOR_EACH_REF_FORMAT}`, 'refs/heads']);
  const refs = parseForEachRef(refRes.stdout);

  return buildCandidates({ merged, refs, base, current, keep, staleDays, includeGone, now });
}

/**
 * Delete a local branch. Uses the safe `-d` unless `force`, in which case `-D`.
 * @param {string} name
 * @param {{ run?: typeof defaultRun, force?: boolean }} [opts]
 * @returns {Promise<{ name: string, ok: boolean, error?: string, notMerged?: boolean }>}
 */
export async function deleteBranch(name, opts = {}) {
  const run = opts.run || defaultRun;
  const force = opts.force || false;
  if (!isValidBranchName(name)) {
    return { name, ok: false, error: 'refusing to delete an invalid branch name' };
  }
  const flag = force ? '-D' : '-d';
  const { code, stdout, stderr, error } = await run('git', ['branch', flag, '--', name]);
  if (code === 0) return { name, ok: true };
  const msg = (stderr || (error && error.message) || `git exited with code ${code}`).trim();
  return { name, ok: false, error: msg, notMerged: /not fully merged/i.test(msg) };
}

/**
 * Delete a branch on a remote (default: origin). Off unless the caller opted in
 * via --remote; the CLI double-confirms before ever calling this.
 * @param {string} name
 * @param {{ run?: typeof defaultRun, remote?: string }} [opts]
 * @returns {Promise<{ name: string, ok: boolean, error?: string }>}
 */
export async function deleteRemoteBranch(name, opts = {}) {
  const run = opts.run || defaultRun;
  const remote = opts.remote || 'origin';
  if (!isValidBranchName(name)) {
    return { name, ok: false, error: 'refusing to delete an invalid branch name' };
  }
  const { code, stderr, error } = await run('git', ['push', remote, '--delete', '--', name]);
  if (code === 0) return { name, ok: true };
  const msg = (stderr || (error && error.message) || `git exited with code ${code}`).trim();
  return { name, ok: false, error: msg };
}
