# subagents

In-process subagent delegation (WIP). See [docs/subagents/DESIGN.md](../../docs/subagents/DESIGN.md) and [docs/subagents/STEPS.md](../../docs/subagents/STEPS.md).

## Tool: `subagent`

In-process `AgentSession` runs (no extra `pi` process). **Single mode:** set `task` and required **`description`** (short label for the collapsed tool tree). **Parallel mode:** set `tasks` (array); each element must include **`description`**; runs use `mapConcurrent` with limits from `~/.agent/subagents/settings.json` (`max_concurrent`, `max_total`; defaults 4 and 8). Optional per-call overrides: `max_concurrent`, `max_total` on the tool arguments.

Subagent state is written under `~/.agent/subagents/session`; each run appends a JSON line to `~/.agent/subagents/by-parent/<parent_session_id>.jsonl` so subagents stay associated with the parent Pi session across reloads. Defaults: `isolated=true` (read/grep/find/ls only, no extensions). Set `isolated=false` to allow bash/edit/write; extensions remain off so this extension is not re-registered in the child.

Batch results list every task with `ok` or `error`; partial failures do not abort the whole tool call. `details.mode` is `single` or `batch`; batch runs set `details.batch` (per-index outcomes and `tool_calls`) and `details.tool_calls` as the sum across tasks. Each subagent run mirrors the main session for **token usage** (`usage_input` / `usage_output`, same semantics as statusline ↑/↓) and **context** (`context_percent`, `context_tokens`, `context_window` from the child `AgentSession.getContextUsage()` / model window). Batch live updates expose `per_task_usage_input`, `per_task_usage_output`, and `per_task_context_percent` alongside `per_task_tool_calls`.

**Background (`background: true`):** the tool returns immediately with `details.background_id` and instructions to call **`subagent_status`** with `{ "id": "<uuid>" }`. The run uses **`ctx.signal`** only (not the foreground tool-call abort). When the job finishes, the extension updates an in-memory table (capped; very old completed jobs may be pruned), emits **`subagent:complete`** on `pi.events`, and calls **`ctx.ui.notify`**. JSON from `subagent_status` uses `status`: `running`, `done` (check `ok` and optional `batch_counts`), `error` (unhandled exception), or `unknown` (id not found).

Streaming live tool rows: the child session **never** calls the parent Pi `onUpdate` from `session.subscribe`. Each `tool_execution_end` updates a **local progress snapshot** via optional `onChildProgress`; orchestration in **`tool.ts`** runs a **`setInterval` (~100ms)** that reads that snapshot and calls `tryParentToolUpdate` (same separation as tintinweb/pi-subagents: local state + timer, not child event stack → parent `emit`). Batch mode also flushes once when each task completes so `per_task_done` stays accurate.

Optional **`agent_type`** (`default`, `research`, `review`, `plan`) selects the injected system prompt; omit for `default`. Per-task `tasks[].agent_type` overrides the batch default.

For TUI tool rows, load **`packages/tool-display`** in your Pi config (before or after `subagents`); it registers display adapters for **`subagent`** and **`subagent_status`** so headers and collapsed/expanded output match **Read** / **Bash** styling.

## Package layout (this extension)

| File                    | Role                                                              |
| ----------------------- | ----------------------------------------------------------------- |
| `tool.ts`               | Registers `subagent` / `subagent_status`; `execute` routing only. |
| `schemas.ts`            | TypeBox parameter schemas.                                        |
| `validate.ts`           | Single vs batch argument validation.                              |
| `details.ts`            | Normalizes `SubagentRunDetails` for tool results.                 |
| `parent-update.ts`      | Safe `onUpdate` + throttled interval flush helper.                |
| `orchestrate-single.ts` | Single-task run + live `details` updates.                         |
| `orchestrate-batch.ts`  | Parallel batch + per-task arrays + live updates.                  |
| `batch-text.ts`         | Markdown/text body for completed batch results.                   |
| `background-finish.ts`  | Job table updates, `pi.events`, `notify` after async runs.        |
| `run-agent.ts`          | `createAgentSession` + `runSubAgent` (child session lifecycle).   |

## Tool: `subagent_status`

Read-only lookup for **background** jobs: pass the `id` string from a `subagent` result. Response is JSON (pretty-printed in the tool result text).

## Try

```bash
pi -e packages/subagents/index.ts
```

Then ask the model to call `subagent` with a small read-only task, for example summarizing a file under the project.
