# gitsweep

[![CI](https://github.com/YOUR_USERNAME/gitsweep/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/gitsweep/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/gitsweep.svg)](https://www.npmjs.com/package/gitsweep)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Safely delete merged and stale local branches — in one command.**

Every repo you've worked in for more than a week looks like this:

```
$ git branch
  feature/checkout
  feature/login
  fix/typo-header
  chore/bump-deps
  wip/experiment
  spike/old-idea
* main
  ...
```

A graveyard of `feature/*`, `fix/*`, and `wip/*` branches that were merged and forgotten
weeks ago. The manual cleanup — `git branch --merged`, eyeball the list, copy each name,
`git branch -d <name>`, repeat — is tedious, and one slip deletes the wrong thing.

gitsweep turns that chore into one safe, interactive command:

```bash
npx gitsweep
```

```
base branch: main   current: feature/checkout
select branches to delete:
❯ [x] fix/typo-header   merged · 3 days ago
  [x] feature/login     merged · 8 days ago
  [ ] chore/bump-deps   merged · 1 hour ago
space toggle · ↑/↓ move · a all · n none · enter confirm · q abort
Delete 2 branches with `git branch -d`? [y/N] y
  ✓ deleted fix/typo-header
  ✓ deleted feature/login

swept: 2 deleted.
```

No dependencies. No config. No account. Just Node 18+.

<!-- Add a short demo GIF here once recorded: ![demo](docs/demo.gif) -->

## Safety first

gitsweep deletes branches, so it is deliberately cautious:

- **Safe delete by default.** It uses `git branch -d`, which *refuses* to drop a branch
  that isn't fully merged. Unmerged branches are reported and skipped, never lost.
- **Protected branches are never offered.** The current branch, the detected base
  branch (`main` / `master` / `develop`), anything matching `release/*`, and anything you
  pass to `--keep` are excluded from the list entirely.
- **You confirm before anything happens.** The interactive picker shows exactly what
  will be deleted, and there's a final `[y/N]` prompt (skip it with `--yes` for scripts).
- **Force is a conscious choice.** `-D` / `--force` (which deletes unmerged work) prints a
  warning and asks for a *second* confirmation.
- **Remote branches are off by default.** gitsweep only touches local branches unless you
  pass `--remote`, which then double-confirms before running `git push --delete`.
- **No shell string building.** Branch names are validated and passed to `git` as an
  argument array, so a branch called `--force` or `; rm -rf` can't do anything clever.

## Quick start

```bash
# one-off, no install
npx gitsweep

# or install globally
npm install -g gitsweep
gitsweep
```

## Usage

```
gitsweep [options]
```

| Option | Description |
| --- | --- |
| `--stale <days>` | Also flag branches with no commits in `<days>` days |
| `--gone` | Also flag branches whose upstream branch was deleted |
| `--keep <b,...>` | Never offer these branches for deletion (comma-separated) |
| `--yes` | Skip the picker and the prompt; delete every candidate |
| `-D, --force` | Force delete with `git branch -D` (deletes unmerged work) |
| `--remote` | Also delete matching branches on `origin` (dangerous, double-confirmed) |
| `--dry-run` | Show what would be deleted, then do nothing |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

```bash
gitsweep                     # pick from branches merged into main/master
gitsweep --dry-run           # preview only, delete nothing
gitsweep --stale 30          # also flag branches idle for 30+ days
gitsweep --gone              # also flag branches whose upstream was deleted
gitsweep --keep dev,staging  # never offer dev or staging
gitsweep --yes               # delete all merged branches, no picker (for scripts/CI)
```

Exit codes: `0` success (or nothing to sweep), `1` runtime failure, `2` bad usage.

## How it works

No magic — gitsweep runs the git commands you already know and parses the output:

| Step | Command |
| --- | --- |
| Confirm it's a repo | `git rev-parse --is-inside-work-tree` |
| Detect the base branch | local `main` / `master` / `develop`, else `git symbolic-ref refs/remotes/origin/HEAD` |
| Find the current branch | `git symbolic-ref --short -q HEAD` |
| List merged branches | `git branch --merged <base>` |
| Read dates + upstream state | `git for-each-ref --format=... refs/heads` |
| Delete (safe) | `git branch -d -- <name>` |
| Delete (force) | `git branch -D -- <name>` |

The candidate list is `merged ∪ stale (if --stale) ∪ gone (if --gone)`, with all protected
branches removed. In the picker, merged branches start checked (they're safe); unmerged
ones (surfaced only by `--stale` / `--gone`) start unchecked and are labelled `(unmerged)`.

## Development

```bash
node --test                 # run the test suite (Node built-in, zero deps)
node bin/gitsweep.mjs --help
```

All git-output parsing lives in small pure functions in `src/git.mjs` (`parseMergedBranches`,
`parseForEachRef`, `buildCandidates`, `selectStale`, `selectGone`, …) and is unit-tested
against captured real output. Side effects go through an injectable `run` helper
(`src/run.mjs`), so the orchestration is tested without ever touching a real repo — and the
tests never launch the interactive picker.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The one hard rule: **zero
runtime dependencies.**

## License

MIT. See [LICENSE](LICENSE).
