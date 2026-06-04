# @htwang-contrib/goal

Persistent goal tracking for pi coding agent — brings Codex-style goal mode to pi.

## Features

- **Persistent goals** — objectives survive across turns and sessions
- **Automatic continuation** — injects hidden prompts to keep the agent working until the goal is done
- **Token budget** — optionally limit token spend per goal; auto-pauses when exceeded
- **Completion audit** — prompts the agent to verify all work before marking complete
- **TUI integration** — goal status shown in the statusline footer

## Commands

| Command             | Description                                       |
| ------------------- | ------------------------------------------------- |
| `/goal <objective>` | Set a new goal (prompts to replace if one exists) |
| `/goal`             | Show current goal                                 |
| `/goal pause`       | Pause the active goal                             |
| `/goal resume`      | Resume a paused goal                              |
| `/goal clear`       | Clear the current goal                            |

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

## Dependencies

- `@earendil-works/pi-coding-agent` — Extension API
- `@earendil-works/pi-ai` — AssistantMessage types
- `@sinclair/typebox` — JSON schema for tool parameters
- `@htwang-contrib/common` — shared utilities (`formatTokens`, `formatElapsedSeconds`, `isStaleCtxError`)

## Design Document

See [docs/goal/ANALYSIS.md](../../docs/goal/ANALYSIS.md) for the full design analysis and migration notes.
