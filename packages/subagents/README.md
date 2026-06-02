# subagents

In-process subagent delegation. Same docs as the monorepo root: [docs/subagents/DESIGN.md](../../docs/subagents/DESIGN.md), [docs/subagents/STEPS.md](../../docs/subagents/STEPS.md), and [AGENTS.md](../../AGENTS.md) (project map + links).

**Runtime:** this extension targets **`@earendil-works/pi-coding-agent` ≥ `0.76.0`** (see `docs/subagents/STEPS.md` phase 0 API verification).

## Tool: `subagent`

In-process `AgentSession` runs (no extra `pi` process). **Single mode:** set `task`; set **`description`** on the tool or in the persona file’s YAML **`description`**. **Parallel mode:** set `tasks`; each element needs **`description`** on the tool or in that row’s persona frontmatter (resolved from `tasks[].agent_type` or the batch-level `agent_type`). Runs use `mapConcurrent` with limits from `~/.agent/subagents/settings.json` (`max_concurrent`, `max_total`; built-in defaults **3** and **10** if the file is missing). Optional per-call overrides: `max_concurrent`, `max_total`, **`timeout_ms`** on the tool arguments; batch items may set **`tasks[].timeout_ms`**.

**`timeout_ms`:** non-zero values merge an `AbortSignal.timeout` with the parent/tool abort (and, in foreground mode, the tool-call `signal`). `0` means no extra wall-clock timeout beyond parent cancellation.

Subagent state is written under `~/.agent/subagents/session`; each run appends a JSON line to `~/.agent/subagents/by-parent/<parent_session_id>.jsonl` so subagents stay associated with the parent Pi session across reloads. Defaults: `isolated=true` (read/grep/glob/find/ls only). The child `DefaultResourceLoader` sets `noExtensions: true` (no user extension scan) but **`extensionFactories`** always includes **`@htwang-contrib/protect-secrets`** and **`@htwang-contrib/extra-tools`** (grep / glob / ls), so `/run/agenix` and bash read-like rules match the main session and child personas get those tools without requiring `extra-tools` on the parent. Set `isolated=false` to allow bash/edit/write. **Child sessions never receive** the tools **`subagent`** or **`subagent_status`** (filtered in `child-tools.ts` before `createAgentSession`).

Optional **`defaults_by_agent_type`** in settings (see below) supplies default **`model`** / **`thinking`** per agent id when the tool call omits them and the persona Markdown does not set them (single mode uses the resolved `agent_type`; batch merges per task with precedence **task field → batch-level param → persona frontmatter → `defaults_by_agent_type` → parent model** for `model`/`thinking`; same idea for `inherit_context`, `isolated`, `max_turns`, `description`).

Batch results list every task with `ok` or `error`; partial failures do not abort the whole tool call. `details.mode` is `single` or `batch`; batch runs set `details.batch` (per-index outcomes and `tool_calls`) and `details.tool_calls` as the sum across tasks. Each subagent run mirrors the main session for **token usage** (`usage_input` / `usage_output`, same semantics as statusline ↑/↓) and **context** (`context_percent`, `context_tokens`, `context_window` from the child `AgentSession.getContextUsage()` / model window). Batch live updates expose `per_task_usage_input`, `per_task_usage_output`, and `per_task_context_percent` alongside `per_task_tool_calls`.

**Background (`background: true`):** the tool returns immediately with `details.background_id` and instructions to call **`subagent_status`** with `{ "id": "<uuid>" }`. The run uses **`ctx.signal`** merged with optional **`timeout_ms`** from settings / tool args (not the foreground tool-call `signal`). When the job finishes, the extension updates an in-memory table (capped; very old completed jobs may be pruned), emits **`subagent:complete`** on `pi.events`, and calls **`ctx.ui.notify`**. JSON from `subagent_status` uses `status`: `running`, `done` (check `ok` and optional `batch_counts`), `error` (unhandled exception), or `unknown` (id not found).

Streaming live tool rows: the child session **never** calls the parent Pi `onUpdate` from `session.subscribe`. Each `tool_execution_end` updates a **local progress snapshot** via optional `onChildProgress`; orchestration in **`tool.ts`** runs a **`setInterval` (~100ms)** that reads that snapshot and calls `tryParentToolUpdate` (same separation as tintinweb/pi-subagents: local state + timer, not child event stack → parent `emit`). Batch mode also flushes once when each task completes so `per_task_done` stays accurate.

Optional **`agent_type`** selects the injected system prompt from the [agent catalog](#agent-definitions-markdown-catalog). Omit **`agent_type`** or pass an unknown id to use **`general-purpose`**. Per-task `tasks[].agent_type` overrides the batch default.

For TUI tool rows, load **`packages/tool-display`** in your Pi config (before or after `subagents`); it registers display adapters for **`subagent`** and **`subagent_status`** so headers and collapsed/expanded output match **Read** / **Bash** styling.

Loaded personas are listed for the model only inside the **`<subagents>`** block appended to the parent **system prompt** each turn (`before_agent_start`). There is no separate **`[Agents]`** chat row: extensions cannot append to the same pass as Pi’s built-in `showLoadedResources`, and `sendMessage` entries are session messages—on `/reload`, Pi redraws messages first then re-appends resource sections, so a custom block would jump above `[Context]` / `[Skills]` and stack on every reload.

**Command `/subagents-agents`:** TUI only. Opens a **picker** (same family of prompts as other Pi settings-style flows). Choose an agent to open a **read-only editor** with the Markdown **source path**, merged **defaults** (single-call merge: persona then `defaults_by_agent_type`, no tool-call overrides), **resolved model** via the parent registry + `resolveModel`, **thinking / isolated / inherit_context / max_turns**, the **builtin tool** list for that isolation mode, and a short note on child **resource loader** and batch overrides.

## Agent definitions (Markdown catalog)

At each `subagent` run, prompts are merged from layers in order (**later layers override** the same id):

1. Shipped **`agents/*.md`** in this package (see `package.json` → `pi.agents`).
2. **`$HOME/.config/pi/agents`** — one Markdown file per agent; id from `foo.md` → `foo` unless frontmatter overrides.
3. **`<cwd>/.pi/agents`** — project-local agents (same file rules).
4. **`pi.agents`** on the **project** `package.json` (paths relative to the repo root), same array shape as **`pi.skills`**.
5. For each path in **`pi.extensions`** on the project `package.json`, that extension’s **`package.json`** → **`pi.agents`** entries (directories relative to the extension root); each directory contributes `*.md` files.

Markdown **body** is the main child system prompt. If **`whenToUse`** / **`when_to_use`** is set in frontmatter, the child prompt is prefixed with **`<when_to_use>…</when_to_use>`** (XML-escaped) before the body—the same text shape the parent sees in the catalog XML. YAML **frontmatter** is parsed with Pi’s **`parseFrontmatter`**. Supported keys (all optional except having a non-empty body):

| Field             | Role                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`            | Overrides the agent id from the filename; must normalize to `^[a-z][a-z0-9_-]*$`.                                                                                                                                                                                                                                                                                        |
| `description`     | Default short label for the collapsed tool tree when the tool omits `description` (single or per batch row). Max 72 characters (truncated if longer).                                                                                                                                                                                                                    |
| `whenToUse`       | Also accepted as `when_to_use`. Guidance on when to pick this persona: parent **`<subagents>`** XML includes **`<when_to_use>`**; the **child** system prompt is prefixed with the same **`<when_to_use>…</when_to_use>`** block (XML-escaped) before the Markdown body when the subagent runs. Max 2000 characters (truncated if longer). Not used for tool row labels. |
| `model`           | Default model hint when the tool omits `model` / per-task `model`.                                                                                                                                                                                                                                                                                                       |
| `thinking`        | Default thinking level when the tool omits `thinking`.                                                                                                                                                                                                                                                                                                                   |
| `inherit_context` | Boolean; when true, same behavior as tool `inherit_context`.                                                                                                                                                                                                                                                                                                             |
| `isolated`        | Boolean; when false, enables bash/edit/write in the child (same as tool `isolated`).                                                                                                                                                                                                                                                                                     |
| `max_turns`       | Positive integer; cap agentic turns when the tool omits `max_turns`.                                                                                                                                                                                                                                                                                                     |
| `tools`           | Optional allowlist of child tool names (YAML string array, or one comma/whitespace-separated string). Each name must appear in Pi’s default set for this persona’s effective `isolated` mode (read-only vs full); unknown names are dropped. If none remain after filtering, the default full list is used. At most 50 names are read from frontmatter.                  |

**Precedence:** any value set on the **`subagent` tool call** wins over frontmatter; frontmatter wins over **`defaults_by_agent_type`** in `settings.json`; then the parent session model applies for `model` where still unset.

On each **main** workspace agent start, `before_agent_start` appends a short **Subagents feature** block and the **`<subagents>`** persona catalog after the base system prompt. When the session file is under `~/.agent/subagents/session` (in-process child sessions), this extension **does not modify** the system prompt—no feature block and no persona XML (child loaders use `noExtensions: true`, so they normally do not load this package). Each **`<agent>`** has **`<name>`** and **`<when_to_use>`** (from frontmatter `whenToUse` or `when_to_use`, or empty). This is the supported way to surface the catalog to the parent model; there is no duplicate TUI “agents” strip in chat.

```yaml
---
name: my_agent
description: My label
whenToUse: When the user needs a focused pass on this workflow only.
inherit_context: false
isolated: true
tools:
  - read
  - grep
  - glob
---
System prompt text…
```

Unknown `agent_type` arguments resolve to **`general-purpose`**. If you used the old built-in id **`default`**, rename your Markdown to **`general-purpose.md`** (or `name: general-purpose` in frontmatter) and rename **`defaults_by_agent_type.default`** to **`general-purpose`** in `settings.json`.

## Settings: `~/.agent/subagents/settings.json`

Optional JSON object (missing file → built-in defaults only):

| Field                    | Type   | Default | Role                                                                                                                                                                        |
| ------------------------ | ------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `max_concurrent`         | number | 3       | Parallel batch: max simultaneous `runSubAgent` calls.                                                                                                                       |
| `max_total`              | number | 10      | Parallel batch: max length of `tasks` array.                                                                                                                                |
| `timeout_ms`             | number | 0       | Wall-clock cap merged via `AbortSignal.timeout`; `0` = disabled.                                                                                                            |
| `defaults_by_agent_type` | object | —       | Keys are agent ids (e.g. `general-purpose`, `explore`, or custom ids from your catalog). Each value may include `model` and/or `thinking` when the tool omits those fields. |

Example:

```json
{
  "max_concurrent": 4,
  "max_total": 8,
  "timeout_ms": 600000,
  "defaults_by_agent_type": {
    "explore": { "thinking": "medium" },
    "plan": { "thinking": "low" }
  }
}
```

## Package layout (this extension)

| File                    | Role                                                                                                                        |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `tool.ts`               | Registers `subagent` / `subagent_status`; `execute` routing only.                                                           |
| `schemas.ts`            | TypeBox parameter schemas.                                                                                                  |
| `validate.ts`           | Single vs batch argument validation.                                                                                        |
| `details.ts`            | Normalizes `SubagentRunDetails` for tool results.                                                                           |
| `parent-update.ts`      | Safe `onUpdate` + throttled interval flush helper.                                                                          |
| `orchestrate-single.ts` | Single-task run + live `details` updates.                                                                                   |
| `orchestrate-batch.ts`  | Parallel batch + per-task arrays + live updates.                                                                            |
| `batch-text.ts`         | Markdown/text body for completed batch results.                                                                             |
| `background-finish.ts`  | Job table updates, `pi.events`, `notify` after async runs.                                                                  |
| `run-agent.ts`          | `createAgentSession` + `runSubAgent`; child loader uses `extensionFactories` for `protect-secrets` and `extra-tools`.       |
| `agent-catalog.ts`      | Agent Markdown catalog, id normalization, system prompt + **`<subagents>`** XML for the parent prompt, `SubagentAgentType`. |
| `child-tools.ts`        | Built-in tool name list + filter excluding delegation tools.                                                                |
| `abort-timeout.ts`      | Merges optional `AbortSignal.timeout` into run signals.                                                                     |
| `settings.ts`           | Reads `settings.json`; concurrency, timeout, persona defaults.                                                              |

## Tool: `subagent_status`

Read-only lookup for **background** jobs: pass the `id` string from a `subagent` result. Response is JSON (pretty-printed in the tool result text).

## Try

```bash
pi -e packages/subagents/index.ts
```

Then ask the model to call `subagent` with a small read-only task, for example summarizing a file under the project.
