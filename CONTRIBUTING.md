# Contributing to gitsweep

Thanks for helping! gitsweep is a small, **zero-dependency** Node CLI, and the goal is
to keep it that way: fast, safe, and obvious.

## Principles

- **No runtime dependencies.** Everything uses Node built-ins (`child_process`,
  `readline`, `fs`, `path`, `os`). PRs that add a runtime dependency will be asked to
  remove it.
- **Parsing is pure.** The output of `git` is parsed by small pure functions
  (`parseMergedBranches`, `parseForEachRef`, `buildCandidates`, `selectStale`,
  `selectGone`, …). Side effects (spawning `git`, deleting branches) go through an
  injectable `run` helper so everything is testable without a real repo.
- **Safe by default.** Deletion uses `git branch -d` (which refuses to drop unmerged
  work). The current branch, the base branch, `release/*`, and `--keep` branches are
  never offered. Force delete (`-D`) and remote deletion require explicit opt-in and
  extra confirmation. Branch names are validated and always passed to `spawn` as an
  array — never concatenated into a shell string.

## Getting started

```bash
git clone https://github.com/YOUR_USERNAME/gitsweep.git
cd gitsweep
node --test               # run the suite
node bin/gitsweep.mjs -h  # try it
```

There's nothing to install — no `npm install` step.

## Adding or fixing parsing

If you're changing how git output is interpreted:

1. Capture the **real** command output (e.g. `git for-each-ref --format=...` or
   `git branch --merged`).
2. Add it as a fixture string in `test/git.test.mjs` and assert the expected result.
3. Make the pure parser pass. Keep the orchestration (`collectBranches`,
   `deleteBranch`) thin.

## Before you open a PR

- Run `node --test` — CI runs the same on Windows, macOS, and Linux across Node
  18/20/22.
- Keep the change focused and update the README if you touch the CLI surface.
- If your change affects the delete path, describe how you verified it (e.g. created a
  throwaway repo, merged a branch, and swept it).

## Ideas / good first issues

- A short demo GIF for the README.
- `--interactive` fuzzy filtering in the picker.
- Detect and offer squash-merged branches (via `git cherry`).
- Localised relative-time strings.
