// Zero-dependency argument parsing. Kept pure so it is fully unit-testable.

export const HELP = `gitsweep — safely delete merged and stale local branches, in one command

Usage:
  gitsweep [options]

Options:
      --stale <days>   Also flag branches with no commits in <days> days
      --gone           Also flag branches whose upstream is gone
      --keep <b,...>   Never offer these branches for deletion (comma-separated)
      --yes            Skip the interactive picker and delete every candidate
  -D, --force          Use force delete (git branch -D) — deletes unmerged work
      --remote         Also delete matching branches on 'origin' (dangerous)
      --dry-run        Show what would be deleted, then do nothing
  -h, --help           Show this help
  -v, --version        Show the version

Examples:
  gitsweep                     # pick from branches merged into main/master
  gitsweep --stale 30          # also flag branches idle for 30+ days
  gitsweep --gone              # also flag branches whose upstream was deleted
  gitsweep --keep dev,staging  # never offer dev or staging
  gitsweep --yes               # delete all merged branches, no picker
  gitsweep --dry-run           # preview only

Notes:
  * Safe by default: uses \`git branch -d\`, which refuses to drop unmerged work.
  * The current branch, the base branch (main/master/develop), release/* and any
    --keep branches are never offered for deletion.
  * Nothing is deleted without a confirmation prompt (unless --yes).
`;

/**
 * Parse the full argv (excluding node + script). Pure and side-effect free.
 * @param {string[]} argv
 * @returns {{
 *   stale: number|null, gone: boolean, keep: string[], yes: boolean,
 *   force: boolean, dryRun: boolean, remote: boolean,
 *   help: boolean, version: boolean, errors: string[]
 * }}
 */
export function parseArgs(argv) {
  const result = {
    stale: null,
    gone: false,
    keep: [],
    yes: false,
    force: false,
    dryRun: false,
    remote: false,
    help: false,
    version: false,
    errors: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Support `--opt=value` as well as `--opt value`.
    let key = arg;
    let inlineValue = null;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        key = arg.slice(0, eq);
        inlineValue = arg.slice(eq + 1);
      }
    }

    // Pull the value for an option that needs one, from `=value` or the next
    // token. We never consume a token that looks like another flag.
    const takeValue = () => {
      if (inlineValue != null) return inlineValue;
      const next = argv[i + 1];
      if (next != null && !next.startsWith('-')) {
        i += 1;
        return next;
      }
      return null;
    };

    switch (key) {
      case '-h':
      case '--help':
        result.help = true;
        break;
      case '-v':
      case '--version':
        result.version = true;
        break;
      case '--gone':
        result.gone = true;
        break;
      case '--yes':
        result.yes = true;
        break;
      case '-D':
      case '--force':
        result.force = true;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--remote':
        result.remote = true;
        break;
      case '--stale': {
        const value = takeValue();
        if (value == null || !/^\d+$/.test(value)) {
          result.errors.push('--stale requires a number of days (e.g. --stale 30)');
        } else {
          result.stale = Number(value);
        }
        break;
      }
      case '--keep': {
        const value = takeValue();
        if (value == null || value.trim() === '') {
          result.errors.push('--keep requires a comma-separated list of branch names');
        } else {
          for (const name of value.split(',').map((s) => s.trim()).filter(Boolean)) {
            if (!result.keep.includes(name)) result.keep.push(name);
          }
        }
        break;
      }
      default:
        if (arg.startsWith('-')) {
          result.errors.push(`unknown option: ${arg}`);
        } else {
          result.errors.push(`unexpected argument: ${arg} (gitsweep takes no positional arguments)`);
        }
    }
  }

  return result;
}
