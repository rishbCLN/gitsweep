#!/usr/bin/env node
// gitsweep — safely delete merged and stale local git branches, in one command.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseArgs, HELP } from '../src/args.mjs';
import {
  isInsideRepo,
  detectBase,
  getCurrentBranch,
  collectBranches,
  deleteBranch,
  deleteRemoteBranch,
} from '../src/git.mjs';
import { makeStyler, colorEnabled, confirm, formatCandidates } from '../src/ui.mjs';
import { selectBranches } from '../src/select.mjs';

function getVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(argv) {
  const opts = parseArgs(argv);
  const c = makeStyler(colorEnabled());

  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`gitsweep ${getVersion()}\n`);
    return 0;
  }
  if (opts.errors.length) {
    for (const e of opts.errors) process.stderr.write(`${c.red('error:')} ${e}\n`);
    process.stderr.write(`\nRun ${c.cyan('gitsweep --help')} for usage.\n`);
    return 2;
  }

  // 1. Must be inside a git work tree.
  if (!(await isInsideRepo())) {
    process.stderr.write(`${c.red('error:')} not a git repository (or any parent directory).\n`);
    process.stderr.write(`Run ${c.cyan('gitsweep')} from inside a git repo.\n`);
    return 1;
  }

  // 2. Figure out the base branch and where we are.
  const base = await detectBase();
  if (!base) {
    process.stderr.write(`${c.red('error:')} could not determine a base branch (looked for main/master/develop and origin/HEAD).\n`);
    return 1;
  }
  const current = await getCurrentBranch();
  if (current === null) {
    process.stderr.write(`${c.red('error:')} detached HEAD \u2014 check out a branch before sweeping.\n`);
    return 1;
  }

  // 3. Collect deletion candidates.
  let candidates;
  try {
    candidates = await collectBranches({
      base,
      current,
      keep: opts.keep,
      staleDays: opts.stale,
      includeGone: opts.gone,
    });
  } catch (err) {
    process.stderr.write(`${c.red('error:')} ${err && err.message ? err.message : err}\n`);
    return 1;
  }

  process.stdout.write(`${c.dim('base branch:')} ${c.bold(base)}   ${c.dim('current:')} ${c.bold(current)}\n`);

  if (candidates.length === 0) {
    process.stdout.write(`${c.green('nothing to sweep')} \u2014 your branches are tidy.\n`);
    return 0;
  }

  // 4. --dry-run: preview and stop.
  if (opts.dryRun) {
    process.stdout.write(`${candidates.length} branch(es) would be considered:\n`);
    process.stdout.write(`${formatCandidates(candidates, c, { prefix: () => '  \u2022 ' })}\n`);
    process.stdout.write(`\n${c.dim('dry run \u2014 nothing was deleted.')}\n`);
    return 0;
  }

  // 5. Decide which branches to delete.
  let selected;
  if (opts.yes) {
    selected = candidates.map((x) => x.name);
  } else if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // No terminal to drive the picker — show what we found and bail safely.
    process.stdout.write(`${candidates.length} branch(es) found:\n`);
    process.stdout.write(`${formatCandidates(candidates, c, { prefix: () => '  \u2022 ' })}\n`);
    process.stderr.write(`\n${c.yellow('no interactive terminal')} \u2014 re-run with ${c.cyan('--yes')} to delete or ${c.cyan('--dry-run')} to preview.\n`);
    return 2;
  } else {
    const items = candidates.map((x) => ({
      name: x.name,
      checked: x.merged, // pre-check the safe (merged) ones; unmerged start off
      label: labelFor(x, c),
    }));
    process.stdout.write(`${c.dim('select branches to delete:')}\n`);
    selected = await selectBranches(items, { input: process.stdin, output: process.stdout, styler: c });
    if (selected === null) {
      process.stdout.write('aborted.\n');
      return 0;
    }
  }

  if (selected.length === 0) {
    process.stdout.write('nothing selected \u2014 aborted.\n');
    return 0;
  }

  // 6. Confirm before deleting. --yes assumes "yes" (for scripts/CI); otherwise we
  // prompt, and a force delete requires a second confirmation.
  const mode = opts.force ? 'git branch -D' : 'git branch -d';
  if (opts.force) {
    process.stdout.write(`${c.yellow('\u26a0 force delete')} removes branches even if unmerged \u2014 unmerged work will be lost.\n`);
  }
  if (!opts.yes) {
    const noun = selected.length === 1 ? 'branch' : 'branches';
    if (!(await confirm(`Delete ${c.bold(String(selected.length))} ${noun} with \`${mode}\`?`))) {
      process.stdout.write('aborted.\n');
      return 0;
    }
    if (opts.force && !(await confirm(`${c.red('Really force-delete?')} This cannot be undone.`))) {
      process.stdout.write('aborted.\n');
      return 0;
    }
  }

  // 7. Delete locally.
  let deleted = 0;
  let skipped = 0;
  let failures = 0;
  const deletedNames = [];
  for (const name of selected) {
    const r = await deleteBranch(name, { force: opts.force });
    if (r.ok) {
      deleted += 1;
      deletedNames.push(name);
      process.stdout.write(`${c.green(`  \u2713 deleted ${name}`)}\n`);
    } else if (r.notMerged) {
      skipped += 1;
      process.stdout.write(`${c.yellow(`  \u26a0 skipped ${name}`)} \u2014 not fully merged (use ${c.cyan('--force')} to delete)\n`);
    } else {
      failures += 1;
      process.stderr.write(`${c.red(`  \u2717 ${name}:`)} ${r.error}\n`);
    }
  }

  // 8. Optionally delete on the remote — off by default, double-confirmed.
  if (opts.remote && deletedNames.length > 0) {
    if (!process.stdin.isTTY) {
      process.stderr.write(`${c.yellow('skipping --remote')} \u2014 remote deletion needs an interactive terminal to confirm.\n`);
    } else {
      const rnoun = deletedNames.length === 1 ? 'branch' : 'branches';
      process.stdout.write(`${c.red('\u26a0 remote deletion')} will run \`git push origin --delete\` for ${deletedNames.length} ${rnoun}.\n`);
      const ok1 = await confirm(`Delete ${c.bold(String(deletedNames.length))} ${rnoun} on ${c.bold('origin')} too?`);
      const ok2 = ok1 && (await confirm(`${c.red('Are you absolutely sure?')} This affects the shared remote.`));
      if (ok1 && ok2) {
        for (const name of deletedNames) {
          const r = await deleteRemoteBranch(name, { remote: 'origin' });
          if (r.ok) {
            process.stdout.write(`${c.green(`  \u2713 deleted origin/${name}`)}\n`);
          } else {
            failures += 1;
            process.stderr.write(`${c.red(`  \u2717 origin/${name}:`)} ${r.error}\n`);
          }
        }
      } else {
        process.stdout.write('remote deletion skipped.\n');
      }
    }
  }

  // 9. Summary.
  const parts = [c.green(`${deleted} deleted`)];
  if (skipped) parts.push(c.yellow(`${skipped} skipped`));
  if (failures) parts.push(c.red(`${failures} failed`));
  process.stdout.write(`\nswept: ${parts.join(', ')}.\n`);

  return failures > 0 ? 1 : 0;
}

/** One-line label for the interactive picker. */
function labelFor(x, c) {
  const label = { merged: 'merged', stale: 'stale', gone: 'upstream gone' };
  const tags = x.reasons.map((r) => label[r] || r).join(' \u00b7 ');
  const name = x.merged ? x.name : `${x.name} ${c.yellow('(unmerged)')}`;
  return `${name}  ${c.dim(tags)}`;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(`unexpected error: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });
