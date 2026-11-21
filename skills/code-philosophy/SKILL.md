---
name: code-philosophy
description: "Pragmatic internal-logic style for small, readable, defensive code. Use when reviewing or writing backend logic, React components, hooks, or state management, or when the user mentions guard clauses, parse don't validate, illegal states, fail fast, pure functions, or intentional naming."
---

# Code Philosophy

Use this skill for internal logic and data flow. It applies to backend code, React components, hooks, state transitions, and other places where correctness matters more than presentation.

The default stance is pragmatic:

- Prefer the smallest correct change.
- Preserve existing local patterns unless they are the problem.
- Do not add helpers, abstractions, or compatibility branches without a concrete need.
- Comments are a last resort. Fix the shape or the names first.

## The 6 Laws

### 1. The Law of the Early Exit (Guard Clauses)
- Keep the happy path flat.
- Handle empty, invalid, and error cases at the top.
- Prefer `if (!valid) return;` over wrapping the main path in `if (valid) { ... }`.

### 2. Make Illegal States Unrepresentable (Parse, Don't Validate)
- Parse unknown input at the boundary.
- Convert it once into a trusted shape, then operate on that shape.
- Internal code should not keep re-validating data that was already accepted.

### 3. The Law of Atomic Predictability
- A function should not surprise the caller.
- Prefer clear inputs and outputs over hidden mutation.
- Return data instead of mutating shared state when that keeps behavior easier to reason about.

### 4. The Law of "Fail Fast, Fail Loud"
- Silent repair usually spreads complexity.
- If a state is impossible or invalid, throw or return an explicit error immediately.
- Do not patch bad data into a half-working state unless there is a real compatibility requirement.

### 5. The Law of Intentional Naming
- Names should carry the logic.
- Prefer booleans like `isReady`, `hasError`, `canRetry`.
- Prefer verbs for functions and concrete nouns for data.
- If a comment is explaining obvious mechanics, improve the names instead.

### 6. The Law of the Single Source of Truth
- One fact lives in one place. If two stores both claim to be authoritative for the same fact, they will desync, and the divergence is where bugs hide.
- A client mirror of server state is fine **as long as the server is the only writer of record** and the client only reads back from it. The client must never independently decide the fact and then ignore the server.
- Classic SPA auth trap: a persisted client flag ("is authed" in `sessionStorage`) coexisting with a full-page `window.location` redirect on 401. The reload drops in-memory state but the persisted flag survives → `login → page → 401 → reload login → flag says authed → back to page → 401 → ⟲`. Fix: the server session is the single authority; the client probes it on mount and reacts to 401 via a state handler, never via a full-page navigation.
- Smell to grep for: any auth/identity decision based on `sessionStorage`/`localStorage`/a cookie the client also sets, alongside a hard redirect on a 4xx response.

## Review Questions

Before finishing, check:

- [ ] Is this the smallest correct change?
- [ ] Is the happy path flat and easy to scan?
- [ ] Did we parse once at the boundary instead of checking everywhere?
- [ ] Is any hidden mutation or fallback masking a bug?
- [ ] Would better names remove the need for comments?

## Anti-Patterns

- Nesting the main path under a success condition.
- Re-validating trusted data deep inside the logic.
- Adding helpers that save lines but hide the real control flow.
- Keeping defensive fallback branches for states that should be impossible.
- Adding backward-compatibility code without an active caller, persisted data, or explicit requirement.
- Writing comments that explain obvious mechanics instead of intent.
- Keeping two stores that both claim to own the same fact (e.g. a client flag and a server session) — the desync is the bug.
