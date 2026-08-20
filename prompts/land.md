---
description: Land the current branch — commit, push, open a PR, keep CI green via rebase, and wait for the human to merge; resumable from any state
argument-hint: "[branch]"
---

# Land

## 0. Branch to land

$@

Defaults to the current branch if empty.

Land this branch: commit any finished work, push, open a PR, keep it green (CI + rebase), and wait for the human to merge. Never merge, never enable auto-merge, never close or reopen the PR.

## Resume from the current state

Work out where the branch already is, then continue from that step — do not redo completed steps:

- Uncommitted changes or unpushed commits → start at step 1.
- Branch pushed, no PR → start at step 2.
- PR open → check CI (step 3) and mergeability (step 4), then wait (step 6).
- PR already `MERGED` or `CLOSED` → report and stop.

Use `git status`, `git log origin/<branch>..<branch>`, `gh pr view`, `gh pr checks` to detect the state; never assume.

## Unattended rules

You may be running unattended in a background tmux pane: nobody can answer an interactive prompt. Make every commit and push non-interactive — commit with `git -c commit.gpgsign=false commit` (same for `tag.gpgsign` if you tag), and push with `GIT_SSH_COMMAND` set to `ssh -o BatchMode=yes` so failures fail fast instead of hanging on pinentry or ssh-agent confirmation. If a human is actively present and an override genuinely blocks you (e.g. a passphrase key with no agent), ask them to run that one command instead.

## Flow

1. **Commit.** Stage only files you changed; never `git add -A`. Commit with a clean conventional message, then `git push -u origin HEAD`.
2. **Open the PR.** `gh pr create` with explicit `--title` and `--body` flags only (never interactive), base branch = the repo default branch, body referencing the originating issue when there is one. If the PR cannot be opened at all (permissions, not a GitHub repo), report that after the push and stop.
3. **Wait for CI** when the repo has checks: `gh pr checks --watch --interval 30`; one blocking call is fine. If CI fails on your change, fix it, push, and wait again. Rerun a check once if it looks flaky or infrastructural before treating it as a real failure.
4. **Keep the PR mergeable.** If it conflicts, or the base branch moved and branch protection now requires an update: fetch the base and `git rebase` onto it. Resolve conflicts only in files your branch touched — if a conflict lands in files you did not touch, stop and report. Push the rebase with `git push --force-with-lease`, permitted only for your own PR branch and only after a rebase. CI reruns after the push; go back to step 3.
5. **Never merge.** The human merges. After every base-branch move, re-check CI and mergeability (steps 3–4), handle what changed, and keep waiting.
6. **Wait for the merge.** Poll `gh pr view --json state,mergeable` every few minutes with a `sleep` between polls; never busy-loop. Terminal states: `MERGED` — report and stop. `CLOSED` without merge — report and stop.

## Discipline

- One branch, one PR. Do not bundle unrelated work into the landing commit.
- If anything needs a decision only a human can make (review feedback, scope change), report and stop rather than improvising.
