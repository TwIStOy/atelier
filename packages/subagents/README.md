# subagents

In-process subagent delegation (WIP). See [docs/subagents/DESIGN.md](../../docs/subagents/DESIGN.md) and [docs/subagents/STEPS.md](../../docs/subagents/STEPS.md).

## Tool: `subagent`

In-process `AgentSession` runs (no extra `pi` process). **Single mode:** set `task` and required **`description`** (short label for the collapsed tool tree). **Parallel mode:** set `tasks` (array); each element must include **`description`**; runs use `mapConcurrent` with limits from `~/.agent/subagents/settings.json` (`max_concurrent`, `max_total`; defaults 4 and 8). Optional per-call overrides: `max_concurrent`, `max_total` on the tool arguments.

Subagent state is written under `~/.agent/subagents/session`; each run appends a JSON line to `~/.agent/subagents/by-parent/<parent_session_id>.jsonl` so subagents stay associated with the parent Pi session across reloads. Defaults: `isolated=true` (read/grep/find/ls only, no extensions). Set `isolated=false` to allow bash/edit/write; extensions remain off so this extension is not re-registered in the child.

Batch results list every task with `ok` or `error`; partial failures do not abort the whole tool call. `details.mode` is `single` or `batch`; batch runs set `details.batch` (per-index outcomes and `tool_calls`) and `details.tool_calls` as the sum across tasks.

Streaming `onUpdate` includes `details.tool_calls`, session paths, and in batch mode `details.task_index` / `details.task_total` for the sub-run that produced the update.

Optional **`agent_type`** (`default`, `research`, `review`, `plan`) selects the injected system prompt; omit for `default`. Per-task `tasks[].agent_type` overrides the batch default.

For TUI tool rows, load **`packages/tool-display`** in your Pi config (before or after `subagents`); it registers a `subagent` display adapter so headers and collapsed/expanded output match **Read** / **Bash** styling.

## Try

```bash
pi -e packages/subagents/index.ts
```

Then ask the model to call `subagent` with a small read-only task, for example summarizing a file under the project.
