// Terminal presentation: manual ANSI colors (no dependency), a yes/no prompt,
// relative-time formatting, and a simple aligned branch list. Colors auto-disable
// for non-TTY / NO_COLOR.
import { createInterface } from 'node:readline/promises';

/** Build a set of style functions. When `enabled` is false they are no-ops. */
export function makeStyler(enabled) {
  const wrap = (open, close) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
  return {
    enabled,
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
    dim: wrap(2, 22),
    bold: wrap(1, 22),
  };
}

/** Decide whether to emit colors. Honors NO_COLOR and FORCE_COLOR conventions. */
export function colorEnabled(env = process.env, stream = process.stdout) {
  if (env.NO_COLOR != null) return false;
  if (env.FORCE_COLOR != null) return true;
  return Boolean(stream && stream.isTTY);
}

/** Ask a yes/no question. Defaults to "no". */
export async function confirm(question, opts = {}) {
  const input = opts.input || process.stdin;
  const output = opts.output || process.stdout;
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

/**
 * Human-friendly relative time from a unix timestamp (seconds). Pure.
 * @param {number|null} unixSeconds
 * @param {number} [now] epoch ms
 * @returns {string}
 */
export function relativeTime(unixSeconds, now = Date.now()) {
  if (unixSeconds == null || !Number.isFinite(unixSeconds)) return 'unknown';
  const ms = now - unixSeconds * 1000;
  if (ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  const units = [
    ['year', 365 * 24 * 3600],
    ['month', 30 * 24 * 3600],
    ['week', 7 * 24 * 3600],
    ['day', 24 * 3600],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, secs] of units) {
    const n = Math.floor(sec / secs);
    if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

/**
 * A short note describing why a branch is a candidate + how old it is. Pure.
 * @param {{ reasons: string[], committerdate: number|null }} candidate
 * @param {number} [now] epoch ms
 * @returns {string}
 */
export function candidateNote(candidate, now = Date.now()) {
  const label = { merged: 'merged', stale: 'stale', gone: 'upstream gone' };
  const tags = candidate.reasons.map((r) => label[r] || r);
  const when = relativeTime(candidate.committerdate, now);
  const tagStr = tags.join(' \u00b7 ');
  if (when === 'unknown') return tagStr;
  return tagStr ? `${tagStr} \u00b7 ${when}` : when;
}

/**
 * Render an aligned list of candidate branches (used for --dry-run and the
 * non-interactive preview).
 * @param {Array<{ name: string, merged: boolean, reasons: string[], committerdate: number|null }>} candidates
 * @param {ReturnType<typeof makeStyler>} c
 * @param {{ now?: number, prefix?: (x: any) => string }} [opts]
 */
export function formatCandidates(candidates, c, opts = {}) {
  if (!candidates || candidates.length === 0) return '';
  const now = opts.now || Date.now();
  const prefix = opts.prefix || (() => '  ');
  const width = Math.max(...candidates.map((x) => x.name.length));
  const lines = [];
  for (const x of candidates) {
    const padded = x.name.padEnd(width);
    const name = x.merged ? padded : c.yellow(padded);
    lines.push(`${prefix(x)}${name}  ${c.dim(candidateNote(x, now))}`);
  }
  return lines.join('\n');
}
