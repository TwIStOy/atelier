---
description: Implement a piece of work based on a spec or set of tickets — TDD at pre-agreed seams, then code-review, then commit, push, and open a PR
argument-hint: "[spec-path | #issue | ticket-path | description]"
---

# Implement with PR

## 0. Work to implement

$@

If empty, ask which spec, ticket, or description to implement before starting.

Implement the work described above (or already present in conversation context), then land it as a PR.

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

After the PR is open, stop and report. Do not watch CI, rebase, or respond to review comments: the user owns the PR from there. Never merge, never enable auto-merge, never close or reopen the PR.

## Discipline

- Do not expand scope beyond the ticket/spec. Out-of-scope discoveries go in a note or a new ticket, not this commit.
- Prefer the project's domain glossary (`CONTEXT.md`) for names of modules, types, and tests.
- If the ticket is blocked, stop and report — do not start work that depends on unfinished blockers.
- One branch, one PR. Do not bundle unrelated work into the landing commit.
