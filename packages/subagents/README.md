# subagents

In-process subagent delegation (WIP). See [docs/subagents/DESIGN.md](../../docs/subagents/DESIGN.md) and [docs/subagents/STEPS.md](../../docs/subagents/STEPS.md).

## Tool: `subagent`

In-process `AgentSession` runs (no extra `pi` process). **Single mode:** set `task` and required **`description`** (short label for the collapsed tool tree). **Parallel mode:** set `tasks` (array); each element must include **`description`**; runs use `mapConcurrent` with limits from `~/.agent/subagents/settings.json` (`max_concurrent`, `max_total`; defaults 4 and 8). Optional per-call overrides: `max_concurrent`, `max_total` on the tool arguments.

Subagent state is written under `~/.agent/subagents/session`; each run appends a JSON line to `~/.agent/subagents/by-parent/<parent_session_id>.jsonl` so subagents stay associated with the parent Pi session across reloads. Defaults: `isolated=true` (read/grep/find/ls only, no extensions). Set `isolated=false` to allow bash/edit/write; extensions remain off so this extension is not re-registered in the child.

Batch results list every task with `ok` or `error`; partial failures do not abort the whole tool call. `details.mode` is `single` or `batch`; batch runs set `details.batch` (per-index outcomes and `tool_calls`) and `details.tool_calls` as the sum across tasks.

**Background (`background: true`):** the tool returns immediately with `details.background_id` and instructions to call **`subagent_status`** with `{ "id": "<uuid>" }`. The run uses **`ctx.signal`** only (not the foreground tool-call abort). When the job finishes, the extension updates an in-memory table (capped; very old completed jobs may be pruned), emits **`subagent:complete`** on `pi.events`, and calls **`ctx.ui.notify`**. JSON from `subagent_status` uses `status`: `running`, `done` (check `ok` and optional `batch_counts`), `error` (unhandled exception), or `unknown` (id not found).

Streaming `onUpdate` is driven from a **100ms timer** while the child session runs (same idea as tintinweb/pi-subagents foreground `setInterval` + `streamUpdate`): child `subscribe` only updates local buffers so parent `Agent.processEvents` is never entered from the child event stack. After `prompt` finishes, one last flush runs before unsubscribe.

Optional **`agent_type`** (`default`, `research`, `review`, `plan`) selects the injected system prompt; omit for `default`. Per-task `tasks[].agent_type` overrides the batch default.

For TUI tool rows, load **`packages/tool-display`** in your Pi config (before or after `subagents`); it registers a `subagent` display adapter so headers and collapsed/expanded output match **Read** / **Bash** styling.

## Tool: `subagent_status`

Read-only lookup for **background** jobs: pass the `id` string from a `subagent` result. Response is JSON (pretty-printed in the tool result text).

## Try

```bash
pi -e packages/subagents/index.ts
```

Then ask the model to call `subagent` with a small read-only task, for example summarizing a file under the project.
