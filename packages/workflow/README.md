# workflow

Dynamic multi-agent workflows for Pi. Inspired by [Michaelliv/pi-dynamic-workflows](https://github.com/Michaelliv/pi-dynamic-workflows), rebuilt on this monorepo's shared child-agent runner (`@htwang-contrib/common`).

## Tool: `workflow`

The model writes a small **JavaScript orchestration script**; the runtime parses it, validates it statically, and executes it in a `node:vm` sandbox, fanning work out to isolated in-process child agents. One tool call replaces many sequential `subagent` calls when the orchestration shape is known up front.

```
workflow({ script: "...", args?: <any JSON> })
```

### Script format

The **first statement** must be a literal meta export (extracted by acorn AST evaluation, never executed):

```js
export const meta = { name: "security-audit", description: "Audit auth code paths" };
```

The body then runs as an async function with these injected globals:

| Global | Signature | Role |
| ------ | --------- | ---- |
| `agent` | `agent(call) → Promise<value \| text \| null>` | Run one isolated child agent. |
| `parallel` | `parallel([() => agent(...), ...]) → Promise<unknown[]>` | Run agents concurrently (results keep array order). |
| `pipeline` | `pipeline(initial, (prev) => agent(...), ...) → Promise<unknown>` | Thread each stage's result into the next. |
| `phase` | `phase("title")` | Group subsequent agents under a UI phase. |
| `args` | tool-call `args` | Optional input data. |
| `console` | `log/info/warn/error` | Captured into the workflow log shown in the UI. |

`agent()` call fields:

| Field | Required | Role |
| ----- | -------- | ---- |
| `label` | yes | Unique short label shown in the progress UI. |
| `task` | yes | Instructions for the child agent. |
| `agent_type` | no | Persona id from the subagents Markdown catalog (`explore`, `plan`, `scout`, user/project personas); unknown ids fall back to `general-purpose`. Unset `model`/`thinking`/`isolated`/`max_turns`/`inherit_context` inherit the persona's frontmatter and then `defaults_by_agent_type` from `~/.agent/subagents/settings.json` before falling back to runner defaults. |
| `model` | no | Model pattern resolved against the parent's registry; defaults to the parent model. |
| `thinking` | no | Thinking level (`off` … `max`). |
| `isolated` | no | Default `true` (read-only tools); `false` enables bash/edit/write. |
| `max_turns` | no | Agentic turn cap (soft steer, then abort after a grace of 3). |
| `schema` | no | JSON Schema with `type: "object"`. When set, the child must submit its answer via a `structured_output` tool (`terminate: true`) and `agent()` resolves to the **parsed value** instead of text. |

Semantics:

- A failed agent resolves to **`null`** (logged, marked `✗`) — the workflow continues; always null-check results.
- Argument validation errors (missing `task`, non-object `schema`, promises passed to `parallel`, …) **throw** and fail the whole workflow with an actionable message.
- Top-level `return` sets the workflow result, reported back to the model as JSON.
- No `import`/`require`/`process`/`globalThis`/`eval`/`Function`; the sandbox is not a hard security boundary, it is a determinism/robustness guard for model-generated code.
- Default caps: **4** concurrent agents, **32** total `agent()` calls per workflow — both configurable via `/config` (`Workflow Max Concurrency`, `Workflow Max Agents`).

### Example

```js
export const meta = { name: "repo-audit", description: "Audit the repo from three angles" };

phase("collect");
const findings = await parallel([
  () => agent({ label: "security", task: "Audit auth and secret handling. Return findings.", agent_type: "explore" }),
  () => agent({ label: "perf", task: "Find performance hot spots. Return findings.", agent_type: "explore" }),
  () => agent({ label: "api", task: "Review public API consistency. Return findings.", agent_type: "explore" }),
]);
const valid = findings.filter((f) => f !== null);

phase("synthesize");
const report = await agent({
  label: "report",
  task: `Merge these audit findings into one ranked report:\n${valid.join("\n---\n")}`,
});
return report;
```

### Progress UI

- **TUI**: an `aboveEditor` widget renders live phases, per-agent status (colored spinner/✓/✗/◌/– glyphs via the active theme), tool-call counts, and recent log lines. Updates are event-driven with a 100ms throttle, plus a tick at the spinner frame rate (`dots`, 80ms) that keeps the spinner animating and the elapsed-time counter moving while agents think. (The no-UI streaming channel ticks at 1s instead — no spinner to animate there.) It clears itself 15s after the run finishes. **Esc** aborts the workflow and every in-flight child.
- **No UI**: the same snapshot streams through `onUpdate` partial tool results.
- **Tool row**: load **`packages/tool-display`** in your Pi config; it registers a `workflow` display adapter so the tool row matches Read/Bash/Subagent styling — the header shows the workflow's `meta.name` with live agent stats; while running, the collapsed view lists per-agent status rows; once finished, collapsed shows a truncated preview of the result summary; the expanded view shows the full script with line numbers plus the full summary.

### Child sessions

Children run through the shared `runChildAgent` runner (`@htwang-contrib/common`): real token-usage accounting, sessions under `~/.agent/workflow/session`, and by-parent link records — so workflow children appear in the subagents **`/view-subagents`** viewer like any other child run. Children never receive the `workflow` or `subagent` tools (no recursive orchestration), and `protect-secrets` / `extra-tools` / `web-tools` / inference factories are loaded exactly as for `subagent` children.

## When to use which

- **`workflow`** — the fan-out shape is known up front: audits, multi-perspective reviews, batch transforms, parallel research with a synthesis step.
- **`subagent`** — adaptive delegation (the parent needs each result before deciding the next step), background jobs, or a single focused child.

## Package layout

| File          | Role |
| ------------- | ---- |
| `script.ts`   | Markdown-fence normalization, acorn parse, meta literal evaluation, banned-reference validation. |
| `engine.ts`   | `node:vm` sandbox runtime: injected globals, concurrency semaphore, agent cap, abort wiring, snapshot events. |
| `display.ts`  | Snapshot → text lines; TUI widget display and `onUpdate` streaming display (both throttled). |
| `tool.ts`     | `workflow` tool definition: parameters, prompt guidelines, runner wiring to `runChildAgent`, result truncation. |
| `config.ts`   | `maxConcurrency` / `maxAgents` config items (`/config`). |
| `paths.ts`    | Child session directory. |

## Try

```bash
pi -e packages/workflow/src/index.ts
```

Then ask for a small fan-out task, e.g. "use a workflow to review the last commit from a correctness and a style perspective in parallel".
