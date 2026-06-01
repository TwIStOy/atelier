# subagents

In-process subagent delegation. Same docs as the monorepo root: [docs/subagents/DESIGN.md](../../docs/subagents/DESIGN.md), [docs/subagents/STEPS.md](../../docs/subagents/STEPS.md), and [AGENTS.md](../../AGENTS.md) (project map + links).

**Runtime:** this extension targets **`@earendil-works/pi-coding-agent` ≥ `0.76.0`** (see `docs/subagents/STEPS.md` phase 0 API verification).

## Tool: `subagent`

In-process `AgentSession` runs (no extra `pi` process). **Single mode:** set `task` and required **`description`** (short label for the collapsed tool tree). **Parallel mode:** set `tasks` (array); each element must include **`description`**; runs use `mapConcurrent` with limits from `~/.agent/subagents/settings.json` (`max_concurrent`, `max_total`; built-in defaults **3** and **10** if the file is missing). Optional per-call overrides: `max_concurrent`, `max_total`, **`timeout_ms`** on the tool arguments; batch items may set **`tasks[].timeout_ms`**.

**`timeout_ms`:** non-zero values merge an `AbortSignal.timeout` with the parent/tool abort (and, in foreground mode, the tool-call `signal`). `0` means no extra wall-clock timeout beyond parent cancellation.

Subagent state is written under `~/.agent/subagents/session`; each run appends a JSON line to `~/.agent/subagents/by-parent/<parent_session_id>.jsonl` so subagents stay associated with the parent Pi session across reloads. Defaults: `isolated=true` (read/grep/find/ls only, no extensions). Set `isolated=false` to allow bash/edit/write; extensions remain off so this extension is not re-registered in the child. **Child sessions never receive** the tools **`subagent`** or **`subagent_status`** (filtered in `child-tools.ts` before `createAgentSession`).

Optional **`defaults_by_agent_type`** in settings (see below) supplies default **`model`** / **`thinking`** per persona when the tool call omits them (single mode uses the resolved `agent_type`; batch merges per task with the same precedence as other fields: task field → batch-level param → settings default → parent model).

Batch results list every task with `ok` or `error`; partial failures do not abort the whole tool call. `details.mode` is `single` or `batch`; batch runs set `details.batch` (per-index outcomes and `tool_calls`) and `details.tool_calls` as the sum across tasks. Each subagent run mirrors the main session for **token usage** (`usage_input` / `usage_output`, same semantics as statusline ↑/↓) and **context** (`context_percent`, `context_tokens`, `context_window` from the child `AgentSession.getContextUsage()` / model window). Batch live updates expose `per_task_usage_input`, `per_task_usage_output`, and `per_task_context_percent` alongside `per_task_tool_calls`.

**Background (`background: true`):** the tool returns immediately with `details.background_id` and instructions to call **`subagent_status`** with `{ "id": "<uuid>" }`. The run uses **`ctx.signal`** merged with optional **`timeout_ms`** from settings / tool args (not the foreground tool-call `signal`). When the job finishes, the extension updates an in-memory table (capped; very old completed jobs may be pruned), emits **`subagent:complete`** on `pi.events`, and calls **`ctx.ui.notify`**. JSON from `subagent_status` uses `status`: `running`, `done` (check `ok` and optional `batch_counts`), `error` (unhandled exception), or `unknown` (id not found).

Streaming live tool rows: the child session **never** calls the parent Pi `onUpdate` from `session.subscribe`. Each `tool_execution_end` updates a **local progress snapshot** via optional `onChildProgress`; orchestration in **`tool.ts`** runs a **`setInterval` (~100ms)** that reads that snapshot and calls `tryParentToolUpdate` (same separation as tintinweb/pi-subagents: local state + timer, not child event stack → parent `emit`). Batch mode also flushes once when each task completes so `per_task_done` stays accurate.

Optional **`agent_type`** (`default`, `research`, `review`, `plan`) selects the injected system prompt; omit for `default`. Per-task `tasks[].agent_type` overrides the batch default.

For TUI tool rows, load **`packages/tool-display`** in your Pi config (before or after `subagents`); it registers display adapters for **`subagent`** and **`subagent_status`** so headers and collapsed/expanded output match **Read** / **Bash** styling.

## Settings: `~/.agent/subagents/settings.json`

Optional JSON object (missing file → built-in defaults only):

| Field                    | Type   | Default | Role                                                                                                                                           |
| ------------------------ | ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `max_concurrent`         | number | 3       | Parallel batch: max simultaneous `runSubAgent` calls.                                                                                          |
| `max_total`              | number | 10      | Parallel batch: max length of `tasks` array.                                                                                                   |
| `timeout_ms`             | number | 0       | Wall-clock cap merged via `AbortSignal.timeout`; `0` = disabled.                                                                               |
| `defaults_by_agent_type` | object | —       | Keys: `default`, `research`, `review`, `plan`. Each value may include `model` and/or `thinking` strings used when the tool omits those fields. |

Example:

```json
{
  "max_concurrent": 4,
  "max_total": 8,
  "timeout_ms": 600000,
  "defaults_by_agent_type": {
    "research": { "thinking": "medium" },
    "review": { "thinking": "low" }
  }
}
```

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
| `child-tools.ts`        | Built-in tool name list + filter excluding delegation tools.      |
| `abort-timeout.ts`      | Merges optional `AbortSignal.timeout` into run signals.           |
| `settings.ts`           | Reads `settings.json`; concurrency, timeout, persona defaults.    |

## Tool: `subagent_status`

Read-only lookup for **background** jobs: pass the `id` string from a `subagent` result. Response is JSON (pretty-printed in the tool result text).

## Try

```bash
pi -e packages/subagents/index.ts
```

Then ask the model to call `subagent` with a small read-only task, for example summarizing a file under the project.
