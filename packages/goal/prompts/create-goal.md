---
description: Convert a plain task into a strict evidence-based goal and create it
argument-hint: "<task>"
---

User task:
$@

Turn the user task into exactly one durable goal objective, then call the `create_goal` tool with that objective.

This prompt invocation is an explicit user request to set a new goal. If a non-complete goal already exists for this session, ask the user whether to clear it first (`/goal clear`) before creating a new one, because `create_goal` refuses to overwrite an existing goal.

Do not set a token budget unless the user explicitly provides a budget or limit in the task. If no explicit budget is given, omit the token budget field entirely.

The goal must be a completion contract, not a task summary. Preserve the user's full intent. Do not weaken broad acceptance criteria such as "all", "any", "complete", "no tech debt", "do it right", "fully", or "hard acceptance criteria".

The goal must require:

1. Outcome
   - State what must be true when complete.
   - Preserve the full requested end state.
   - Do not narrow scope after the fact unless the original task explicitly defined that scope.

2. Verification evidence
   - Name the concrete evidence required before completion.
   - Include relevant tests, lint, type checks, builds, smoke checks, diffs, docs, generated outputs, rendered UI inspection, or artifact checks when applicable.
   - If the repo has an existing local CI or validation command (for example `npm run check`, `npx tsc --build`, `npm test`), require it unless clearly irrelevant.

3. Constraints
   - Preserve existing behavior unless the task explicitly changes it.
   - Do not discard user changes.
   - Do not leave unapproved shortcuts, compatibility shims, TODO placeholders, dead code, duplicated logic, hidden assumptions, or undocumented behavior changes.

4. Iteration policy
   - After each attempt, inspect evidence, update the plan, and keep taking the next low-risk useful step.
   - Do not stop at a plan when implementation or verification remains.
   - If validation fails, triage and fix the cause rather than reporting partial completion.

5. Completion audit
   - Calling `update_goal` with status "complete" launches an independent verification agent that runs the project build and tests from scratch and inspects the repository. Map every explicit requirement in the goal to fresh evidence first.
   - The goal is not complete if any requirement is unverified, narrowed, deferred, or only probably satisfied.
   - Phrases like "for the scope this is complete", "good enough", "out of scope", or "remaining tech debt" are not valid completion evidence unless the original task explicitly allowed that limitation.

6. Blocked stop condition
   - If completion is impossible with current access, tools, budget, or missing decisions, stop without marking complete.
   - Report attempted paths, evidence gathered, exact blockers, remaining unmet requirements, and what input would unblock progress.

Use concise imperative language in the goal. If the task is blank or only whitespace, infer the goal from the conversation context or ask the user to clarify.
