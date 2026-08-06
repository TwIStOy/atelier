# 0001: Guard `ask_user_question` against goal mode

**Status**: accepted

When a `goal` is `active`, the agent runs autonomously (AFK): `goal` auto-queues a continuation turn after each `agent_end`, with no human present. `ask_user_question` only checks `ctx.hasUI`, which is `true` whenever the TUI is up — so in goal mode it opens its modal and blocks forever waiting for an answer that never comes, stalling the goal. `ctx.hasUI` means "a UI exists", not "a human is present". We decided to refuse the tool in goal mode and steer the agent to proceed autonomously instead.

## Decision

Four coupled choices:

1. **Trigger** — refuse whenever a `Goal` with `status === "active"` exists (coarse model). `paused` / `budgetLimited` / `complete` / no-goal do not trigger.
2. **Detection** — promote the `goal:update` event (payload `Goal | null`) to a stable constant in `@htwang-contrib/common` (`GOAL_UPDATE_EVENT`); `ask_user_question` subscribes and keeps a module-level `activeGoal` boolean. `goal` gains one `emitGoalUpdate` on `session_start` when a goal is already loaded, to close the resume-sync gap.
3. **Return shape** — return a *non-error* directive text result via the existing `buildToolResult`, with `details: { answers: [], cancelled: true, error: "goal_mode" }`. Deliberately **not** `isError: true`.
4. **Prompt layer** — add an explicit AFK instruction to `goal`'s continuation and budget-limited prompts only. `ask_user_question`'s static `promptGuidelines` are left untouched.

## Considered options

- **Detection by reading `goal`'s store file directly** — rejected: tight coupling to `goal`'s on-disk format; a silent break if `goal` changes its store layout. Event subscription keeps the two extensions decoupled, matching the repo's existing cross-extension event channels (`MODAL_ACTIVE_EVENT`, `ASK_USER_PROMPT_EVENT`).
- **A global "active goal" flag in `common`, written by `goal`** — rejected: adds a second layer of shared mutable state on top of the event bus, for no benefit over subscribing to the event `goal` already emits.
- **Refuse only on actual AFK-continuation turns (precise model)** — rejected as infeasible today: `TurnStartEvent` carries no source, and `goal`'s continuation goes through `sendMessage` (no `input` event), so a consumer cannot distinguish a goal-driven turn from a human-driven one without new `pi` infrastructure. The coarse model is also semantically defensible: an active goal means autonomous mode; a human who wants to interact pauses the goal.
- **Return `isError: true`** — rejected: many agents auto-retry on error tool results; in goal mode that is a call → refuse → call loop burning the goal's token budget. A non-error directive text (mirroring the existing no-UI refusal path) avoids the retry hazard while still telling the agent to change course.
- **Runtime tool (un)registration in goal mode** — rejected: `pi` exposes only `registerTool`; there is no unregister or enable/disable API.
- **Prompt-layer note in `ask_user_question`'s static guidelines** — rejected: the guidelines are static and can't be conditional, and `goal`'s continuation prompt is the authoritative source of "you are autonomous now", so the instruction belongs there.

## Consequences

- `ask_user_question` gains a soft runtime dependency on the `goal:update` event. If `goal` is disabled or absent, `activeGoal` stays `false` and the tool behaves exactly as today — the guard is a no-op, which is correct (no goal ⇒ no goal mode).
- The `goal:update` event becomes part of the cross-extension public contract (it moves to `common`). `common` must not reverse-depend on `goal`, so the payload contract describes only the minimal structural shape a consumer needs (the `status` field and its literal union), defined in `common`, not an import of `goal`'s `Goal` type. Changing the event name or that minimal shape now affects `ask_user_question`.
- `goal` emits one extra `goal:update` on session resume. Existing consumers (currently none beyond the widget) must tolerate receiving the current goal on startup.
