---
description: Implement a piece of work based on a spec or set of tickets — TDD at pre-agreed seams, then code-review, then commit, push, open a PR, keep it green (CI + rebase) and act on review comments (react, analyze, fix), and wait for the user to merge
argument-hint: "[spec-path | #issue | ticket-path | description]"
---

# Implement with PR

## 0. Work to implement

$@

If empty, ask which spec, ticket, or description to implement before starting.

Implement the work described above (or already present in conversation context), then land it as a PR and babysit the PR until the user merges it.

## Unattended rules

You may run unattended in a background tmux/herdr pane: nobody can answer an interactive prompt. Keep every commit and push non-interactive so a failure fails fast instead of hanging; if a command genuinely needs interaction, stop and report.

Do not ask the user questions (no ask_user_question, no pausing on decisions): the ticket/spec is already a scope you can implement independently. Resolve every open question from the issue text and the repo's existing conventions, and note non-obvious choices in the PR body. Stop and report only when no reasonable interpretation lets you proceed safely.

## Issue tracker

**Prefer repo config when present.** If the work is an issue/ticket, read `docs/agents/issue-tracker.md` (if it exists) for how to fetch it. Fall back to `gh issue view <n> --comments` on GitHub, or reading a local `.scratch/...` path. If config is missing and you need to publish or label, prefer running `/setup-agent-repo-context` first when practical.

## Process

1. **Load context.** If section 0 references a path, issue number, or URL, fetch and read it fully (body + comments / acceptance criteria). Prefer the agent brief on a `ready-for-agent` issue when present — that is the contract.

2. **Pick seams, then TDD.** Load `skills/tdd/SKILL.md` and use TDD where possible, at pre-agreed seams. Seams not already locked in the ticket/spec: pick them yourself from the issue text and the repo's existing conventions instead of asking.

3. **Check continuously.** Run typechecking regularly, single test files regularly, and the full test suite once at the end.

4. **Review.** Once the work is done, load `skills/code-review/SKILL.md` and review the diff since the branch point (or since the commit you started from).

5. **Commit, push, open the PR.** Commit your work to the current branch: stage only the files you changed; never `git add -A` / `git add .`. Push it with `git push -u origin HEAD`. Then open the PR: `gh pr create` with explicit `--title` and `--body` flags only (never interactive), base branch = the repo default branch your current branch forked from, body referencing the originating issue when there is one. If the PR cannot be opened at all (permissions, not a GitHub repo), report that after the push and stop.

6. **Babysit the PR until the user merges it.** One poll loop, sleeping 60–90s between iterations, never busy-loop. The only blocking wait `gh` offers is `gh pr checks --watch`, and it covers checks only — comments and reviews have no watch primitive — so the loop polls state, CI, and review feedback together. Each iteration, in order:
   1. **State and mergeability**: `gh pr view --json state,mergeable`. Terminal states: `MERGED` — report and stop. `CLOSED` without merge — report and stop. If it conflicts, or the base branch moved and branch protection now requires an update, fetch the base and `git rebase` onto it. Resolve conflicts only in files your branch touched — if a conflict lands in files you did not touch, stop and report. Push the rebase with `git push --force-with-lease`, permitted only for your own PR branch and only after a rebase. CI reruns after the push; keep looping.
   2. **CI**: `gh pr checks <pr>`; exit 0 = all green, 1 = a check failed, 8 = pending. A failure in your change: fix it, push, keep looping. Rerun a flaky- or infra-looking check once (`gh run rerun <run-id>`) before treating it as a real failure.
   3. **Review feedback**: resolve `<owner>/<repo>` and `<n>` once at PR creation. Per iteration, `gh pr view --json comments,reviews` for conversation comments and review bodies, plus `gh api "repos/<owner>/<repo>/pulls/<n>/comments"` for inline review comments. Track processed comment/review IDs; skip your own comments and bot comments (`.user.type == "Bot"`). For each new reviewer comment or review body:
      - React first, before any analysis or work, so the reviewer sees it was read: `gh api -X POST repos/<owner>/<repo>/issues/comments/<id>/reactions -f content=eyes` (inline comments: `pulls/comments/<id>/reactions`).
      - Then analyze. Questions and notes get a short reply — `gh pr comment <pr> --body "..."` in the conversation, or `gh api repos/<owner>/<repo>/pulls/<n>/comments/<id>/replies -f body="..."` to stay in an inline thread. Change requests are more work on the same PR: apply them like the original ticket — same TDD and commit discipline, same branch — push, and reply noting the fixing commit. If you disagree with a request, state your reasoning once in the reply and leave the decision to the reviewer.
      - A `CHANGES_REQUESTED` review with nothing actionable in its body or comments: reply asking for specifics, and report it.
   4. Never merge, never enable auto-merge, never close or reopen the PR: the human merges. After every push, rebase, or base-branch move, the next iteration re-checks state, CI, and feedback — keep looping.

## Discipline

- Do not expand scope beyond the ticket/spec. Out-of-scope discoveries go in a note or a new ticket, not this commit.
- Prefer the project's domain glossary (`CONTEXT.md`) for names of modules, types, and tests.
- If the ticket is blocked, stop and report — do not start work that depends on unfinished blockers.
- One branch, one PR. Do not bundle unrelated work into the landing commit.
