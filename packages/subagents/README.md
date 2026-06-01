# subagents

In-process subagent delegation (WIP). See [docs/subagents/DESIGN.md](../../docs/subagents/DESIGN.md) and [docs/subagents/STEPS.md](../../docs/subagents/STEPS.md).

## Tool: `subagent`

Single-task, in-process `AgentSession` (no extra `pi` process). Subagent state is written under `~/.agent/subagents/session`; each run appends a JSON line to `~/.agent/subagents/by-parent/<parent_session_id>.jsonl` so subagents stay associated with the parent Pi session across reloads. Defaults: `isolated=true` (read/grep/find/ls only, no extensions). Set `isolated=false` to allow bash/edit/write; extensions remain off so this extension is not re-registered in the child.

Streaming `onUpdate` callbacks include `details.tool_calls` (cumulative tool executions in the subagent), `details.sub_session_file`, `details.parent_session_id`, and `details.parent_session_file`.

## Try

```bash
pi -e packages/subagents/index.ts
```

Then ask the model to call `subagent` with a small read-only task, for example summarizing a file under the project.
