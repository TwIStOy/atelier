# worktree-merged.sh

Check whether each git worktree's branch has been merged into a mainline
branch (`master`/`main` by default). Worktrees whose branches are merged are
safe to delete. The script is a standalone shell tool — no build step, drop it
into any git repo.

## Usage

```
scripts/worktree-merged.sh            # report status (dry run)
scripts/worktree-merged.sh --prune    # remove merged worktrees (asks first)
```

Sample output:

```
   WORKTREE                                 BRANCH                                   STATUS
-  /home/me/repo                            master                                   mainline
-  /home/me/repo-8                          pi/issue/8-header-line                   at-mainline
X  /home/me/repo-feature                    feature/login                            merged
   /home/me/repo-wip                        feature/rewrite                          active

Mainlines checked: master
X = merged into mainline, safe to remove (- = mainline/at-mainline/detached, blank = active)
```

- `X` — merged into a mainline, safe to remove.
- `-` — mainline branch itself, a coincident-tip branch, or detached HEAD. Never removed.
- blank — branch has unmerged commits, still active.

## Flags

| Flag | Description |
| --- | --- |
| `--prune` | Remove worktrees detected as merged. |
| `--mainline <branch\|glob>` | Add a branch or glob pattern to the mainline set. Repeatable. |
| `--json` | Emit machine-readable JSON instead of the human table. With `--prune`, removal is non-interactive and results are included. |
| `-y`, `--yes` | Skip confirmation when pruning. |
| `-h`, `--help` | Show help. |

## JSON output

`--json` switches stdout to a single JSON object for machine consumption
(piping into `jq`, scripts, etc.). Human-only messages and the table are
suppressed.

```json
{
  "mainlines": ["master", "origin/master"],
  "worktrees": [
    {"path": "/home/me/repo", "branch": "master", "status": "mainline", "removable": 0},
    {"path": "/home/me/repo-8", "branch": "pi/issue/8-x", "status": "squash-merged", "removable": 1}
  ]
}
```

- `status` matches the human values: `mainline`, `at-mainline`, `merged`,
  `squash-merged`, `active`, `detached`.
- `removable` is `1` if the worktree is merged and eligible for removal, else `0`.
  The current worktree and the repo root are always `0`.
- With `--json --prune`, removal is **non-interactive** (no prompt) and a
  `pruned` array is appended reporting each removal's outcome:

```json
{
  "mainlines": ["master"],
  "worktrees": [ ... ],
  "pruned": [
    {"path": "/home/me/repo-8", "ok": 1},
    {"path": "/home/me/repo-dirty", "ok": 0, "error": "dirty or locked"}
  ]
}
```

Without `--prune`, the `pruned` key is omitted entirely.

## Merge detection

Two cases are covered:

1. **True merge** — branch tip is reachable from a mainline
   (`git merge-base --is-ancestor`). This is the standard `git --merged` case.
2. **Squash merge** — branch commits absorbed via patch-id equivalence
   (`git cherry`). Squash merges are not reachable, so `--merged` alone would
   miss them.

A branch whose tip is identical to a mainline tip is reported as `at-mainline`
and never removed: `merge-base --is-ancestor X X` is always true (every commit
is its own ancestor), so without this guard a coincident tip — a branch checked
out at mainline's current HEAD with no work landed — would be misreported as
merged.

## Mainline branches

Defaults to `master`, `main` (local then `origin/*`). Missing branches are
dropped silently, and the final set is de-duplicated by resolved SHA so
local+remote pairs (or a glob that hits the same ref) count once.

### Adding mainlines per run (glob supported)

`--mainline` accepts a literal branch name or a glob pattern. Patterns expand
to both local heads and all remotes:

```bash
scripts/worktree-merged.sh --mainline develop
scripts/worktree-merged.sh --mainline 'release/*' --mainline 'hotfix/*'
```

A pattern with no matches is dropped silently. A literal name that does not
resolve is also dropped.

### Persistent config (per repo)

Set mainlines once per repo via `git config`. Repeatable with `--add`:

```bash
git config        worktree-merged.mainline develop
git config --add  worktree-merged.mainline 'release/*'
```

Config entries are read at startup and merged with any `--mainline` flags and
the `master`/`main` defaults. To inspect what's set:

```bash
git config --get-all worktree-merged.mainline
```

To clear all persisted mainlines:

```bash
git config --unset-all worktree-merged.mainline
```

Config values live in `.git/config`, so they are **not** shared with the team
via version control. Set them per clone.

## Safety

- Never removes the mainline branch's worktree, a detached-HEAD worktree, or
  the worktree the script is run from.
- `--prune` prompts before removing unless `-y` is passed.
- `git worktree remove` runs **without** `--force`: a dirty or locked worktree
  is skipped rather than having uncommitted work discarded. A failed removal
  means the branch was merged but the worktree has local changes worth
  reviewing.
