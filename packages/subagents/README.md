# subagents

In-process subagent delegation (WIP). See [docs/subagents/DESIGN.md](../../docs/subagents/DESIGN.md) and [docs/subagents/STEPS.md](../../docs/subagents/STEPS.md).

## Tool: `subagent`

Single-task, in-process `AgentSession` (no extra `pi` process). Defaults: `isolated=true` (read/grep/find/ls only, no extensions). Set `isolated=false` to allow bash/edit/write; extensions remain off so this extension is not re-registered in the child.

## Try

```bash
pi -e packages/subagents/index.ts
```

Then ask the model to call `subagent` with a small read-only task, for example summarizing a file under the project.
