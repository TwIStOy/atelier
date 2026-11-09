# Context Map

Multi-context monorepo of pi extensions. Each context has a `CONTEXT.md` glossary under `docs/<context>/`; shared conventions and cross-package decisions live in `packages/common` and `docs/adr/`.

## Contexts

- [tool-display](./docs/tool-display/CONTEXT.md) — TUI rendering of tool calls: per-tool adapters and layout-time grouping
- [agent-todo-linking](./docs/agent-todo-linking/CONTEXT.md) — how tracked Tasks relate to delegated agent execution outcomes
- [auto-compact](./docs/auto-compact/CONTEXT.md) — proactive context-window management: occupancy and idle compaction
- [child-sessions](./docs/child-sessions/CONTEXT.md) — spawning, driving, and settling independent child agent sessions

## Relationships

- **child-sessions → agent-todo-linking**: a child session's Execution Finish settles Task Links via session-links records
- **tool-display ↔ child-sessions**: subagent tool calls render through tool-display adapters and Aggregate Rules
