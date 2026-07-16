---
description: Implement a piece of work based on a spec or set of tickets — TDD at pre-agreed seams, then code-review, then commit
argument-hint: "[spec-path | #issue | ticket-path | description]"
---

# Implement

## 0. Work to implement

$@

If empty, ask which spec, ticket, or description to implement before starting.

Implement the work described above (or already present in conversation context).

## Issue tracker

**Prefer repo config when present.** If the work is an issue/ticket, read `docs/agents/issue-tracker.md` (if it exists) for how to fetch it. Fall back to `gh issue view <n> --comments` on GitHub, or reading a local `.scratch/...` path. If config is missing and you need to publish or label, prefer running `/setup-agent-repo-context` first when practical.

## Process

1. **Load context.** If section 0 references a path, issue number, or URL, fetch and read it fully (body + comments / acceptance criteria). Prefer the agent brief on a `ready-for-agent` issue when present — that is the contract.

2. **Agree seams, then TDD.** Load `skills/tdd/SKILL.md` and use TDD where possible, at pre-agreed seams. Confirm the seams with the user before writing tests if they are not already locked in the ticket/spec.

3. **Check continuously.** Run typechecking regularly, single test files regularly, and the full test suite once at the end.

4. **Review.** Once the work is done, load `skills/code-review/SKILL.md` and review the diff since the branch point (or since the commit you started from).

5. **Commit.** Commit your work to the current branch. Stage only the files you changed; never `git add -A` / `git add .`. Do not push unless asked.

## Discipline

- Do not expand scope beyond the ticket/spec. Out-of-scope discoveries go in a note or a new ticket, not this commit.
- Prefer the project's domain glossary (`CONTEXT.md`) for names of modules, types, and tests.
- If the ticket is blocked, stop and report — do not start work that depends on unfinished blockers.
