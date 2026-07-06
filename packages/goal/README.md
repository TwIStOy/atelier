# @htwang-contrib/goal

Persistent goal tracking for pi coding agent — brings Codex-style goal mode to pi.

## Features

- **Persistent goals** — objectives survive across turns and sessions
- **Automatic continuation** — injects hidden prompts to keep the agent working until the goal is done
- **Token budget** — optionally limit token spend per goal; auto-pauses when exceeded
- **Completion audit** — prompts the agent to verify all work before marking complete
- **TUI integration** — goal status shown in the statusline footer

## Commands

| Command              | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `/create-goal <task>` | Expand a task into a strict completion contract and create the goal (recommended) |
| `/goal <objective>`  | Set a new goal (prompts to replace if one exists)                            |
| `/goal`              | Show current goal                                                            |
| `/goal pause`        | Pause the active goal                                                        |
| `/goal resume`       | Resume a paused goal                                                         |
| `/goal clear`        | Clear the current goal                                                       |

## Agent Tools

| Tool          | Description                                        |
| ------------- | -------------------------------------------------- |
| `create_goal` | Create a goal with optional token budget           |
| `update_goal` | Mark goal as complete (with audit rules in prompt) |
| `get_goal`    | Retrieve current goal status                       |

## How It Works

1. A goal is stored as a JSON file per session thread in the session directory.
2. On `agent_end`, token usage and elapsed time are accumulated into the goal.
3. If the goal is still active and no messages are pending, a hidden continuation prompt is injected to drive the agent to keep working.
4. If a token budget is set and exceeded, the goal transitions to `budgetLimited` and a summary prompt is injected instead.
5. The agent must verify all work is done before calling `update_goal` with `status: "complete"`.

## Reliability

- **Error recovery** — if the provider keeps erroring, the goal stops auto-continuing and pauses after `maxConsecutiveErrors` (default 3, configurable via `/config`) consecutive errors. Resume with `/goal resume` once the provider recovers. The host's own retries are absorbed into this count.
- **Stale-continuation guard** — hidden continuation prompts are debounced per goal and released on turn start, so compaction or goal replacement cannot pile up duplicate or stale continuations. Budget-limit prompts fire once per budget-limited episode.
- **Aborted turns** — when a turn is aborted (e.g. Esc), no continuation is queued, so work does not immediately restart against the user's intent.

## Dependencies

- `@earendil-works/pi-coding-agent` — Extension API
- `@earendil-works/pi-ai` — AssistantMessage types
- `@sinclair/typebox` — JSON schema for tool parameters
- `@htwang-contrib/common` — shared utilities (`formatTokens`, `formatElapsedSeconds`, `isStaleCtxError`)

## Design Document

See [docs/goal/ANALYSIS.md](../../docs/goal/ANALYSIS.md) for the full design analysis and migration notes.
