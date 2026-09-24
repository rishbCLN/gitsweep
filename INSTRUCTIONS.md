# gitsweep — build instructions

> Self-contained build spec. A fresh session should be able to build, test, and ship this tool by following this file top to bottom. Do not add runtime dependencies.

| Field | Value |
| --- | --- |
| Product name | **gitsweep** |
| Tagline | *Safely delete merged and stale local branches — in one command.* |
| Folder id | `star-tool2-gitsweep` |
| Intended repo / npm name | `gitsweep` (verify; fallbacks: `git-sweep-cli`, `branch-sweep`) |
| Status | Planned |
| License | MIT |

---

## 1. Problem & audience
`git branch` becomes a graveyard of `feature/*`, `fix/*`, and `wip/*` branches long after they were merged. Cleaning up by hand (`git branch --merged` → copy → `git branch -d`) is tedious and people fear deleting the wrong thing.

**Audience:** every git user, especially anyone juggling many feature branches or working in teams with PR workflows.

## 2. Why it earns stars
- Turns a nervous, multi-step chore into `npx gitsweep` with an **interactive, safe** preview.
- **Safety-first** framing wins trust (and stars): never touches unmerged work without explicit opt-in.
- Satisfying "cleaned up 14 branches" result screenshots well.

## 3. Scope
**MVP**
- Detect branches **merged** into the default/base branch (`main`/`master`/detected).
- Interactive multi-select checklist (implement with `readline`, no `inquirer`).
- Delete selected branches with `git branch -d` (safe delete).
- Always protect the current branch + base branch + configured "keep" branches.
- Dry-run preview by default; require confirmation to actually delete.

**Stretch**
- Detect **stale** branches (no commits in N days) via `git for-each-ref --sort=committerdate`.
- Detect branches whose remote is **gone** (`git remote prune` insight / `[gone]` upstream).
- `--merged-only`, `--stale <days>`, `--gone`, `--yes`, `--dry-run`, `--force` (`-D`).
- Prune remote-tracking refs (`git fetch --prune`) as an opt-in.

**Non-goals**
- Never delete remote branches by default (guard behind an explicit `--remote` flag documented as dangerous).
- No rebase/merge operations. Read + delete-local only.

## 4. Tech & constraints
- Node **>= 18**, ESM, **zero runtime deps**.
- Use `node:child_process` to shell out to `git`; `node:readline/promises` for the picker.
- Single entry `bin/gitsweep.mjs` + small `src/` modules.
- Must run only inside a git repo (detect via `git rev-parse --is-inside-work-tree`).

## 5. CLI / UX design
```
Usage: gitsweep [options]

Options:
  --stale <days>   Also flag branches with no commits in <days> days
  --gone           Also flag branches whose upstream is gone
  --keep <b,...>   Never offer these branches for deletion
  --yes            Delete without the interactive picker (uses all "merged")
  -D, --force      Use force delete (git branch -D) — dangerous
  --dry-run        Show what would be deleted, do nothing
  -h, --help
  -v, --version
```

Example:
```
$ npx gitsweep
base branch: main   current: feature/checkout
merged branches (safe to delete):
  [x] fix/typo-header      merged 3 days ago
  [x] feature/login        merged 8 days ago
  [ ] chore/deps           merged 1 hour ago
space to toggle · enter to confirm · a=all · n=none
Delete 2 branches with `git branch -d`? [y/N]
```

## 6. Architecture & file layout
```
gitsweep/
  bin/gitsweep.mjs
  src/git.mjs         # thin wrappers: base branch, merged list, stale, gone, delete
  src/select.mjs      # keyboard checklist over readline (raw mode)
  src/args.mjs
  src/ui.mjs          # ansi + relative-time formatting
  test/git.test.mjs   # parse for-each-ref / branch --merged sample output (pure fns)
  test/args.test.mjs
  package.json
  README.md
  LICENSE
  CONTRIBUTING.md
  .github/workflows/ci.yml
  .gitignore
```

## 7. Implementation steps
1. Scaffold package.json/bin/license/gitignore.
2. `git.mjs`: `assertRepo()`, `detectBase()` (main→master→`git symbolic-ref refs/remotes/origin/HEAD`), `listMerged(base)`, `listStale(days)`, `listGone()`, `deleteBranch(name, force)`. Keep **parsing** pure and unit-tested; keep **spawning** thin.
3. `args.mjs` + tests.
4. `select.mjs`: raw-mode arrow/space checklist; graceful fallback to numbered list when non-TTY.
5. Wire `bin`: gather candidates → filter protected → picker (unless `--yes`) → confirm → delete → summary.
6. Polish empty-state ("nothing to sweep — your branches are tidy"), errors, colours.
7. Tests + CI + README + GIF.

## 8. Edge cases & safety
- **Always** exclude: current branch, detected base branch, anything in `--keep`, and common protected names (`main`, `master`, `develop`, `release/*`).
- Default delete is **`-d` (safe)** — git itself refuses to drop unmerged branches. `-D` only via explicit `--force` with an extra confirmation.
- Detached HEAD → explain and exit.
- Not a git repo → clear error, exit non-zero.
- Validate branch names before passing to git; never build a shell string via concatenation — pass args as an array to `spawn`.
- Remote deletion is **off** unless `--remote`, and then double-confirm.

## 9. Testing plan (`node --test`)
- Parse `git branch --merged` output → correct set, excludes `*` current.
- Parse `git for-each-ref` timestamps → stale filter by days.
- Protected-branch filter removes base/current/keep.
- Args: `--stale 30`, `--keep a,b`, `--dry-run`, force flag.

## 10. README outline
Badges → the "branch graveyard" pain → one-command fix + GIF → safety section (front and center) → options table → how it works → install → contributing → license.

## 11. Distribution
`npm publish`, executable bin + shebang, tag `v0.1.0`, GitHub Release with GIF.

## 12. Launch checklist
GIF of sweeping 10+ branches → Show HN → r/git, r/programming, r/commandline → dev.to → add to `awesome-zero-dependency`.

## 13. Definition of Done + star-magnet checklist
- [ ] Safe by default; protected branches never offered.
- [ ] Interactive picker + `--dry-run` + `--yes`.
- [ ] Works in a repo with 0, 1, and many merged branches.
- [ ] README with GIF + prominent safety notes; CI green; tests pass.
- [ ] Published to npm; Release cut; listed in awesome list.
