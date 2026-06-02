import { Type } from "typebox";

const subagentAgentTypeSchema = Type.String({
  maxLength: 64,
  description:
    "Persona id (`[a-z][a-z0-9_-]*`); unknown → `default`. Markdown agents: shipped dirs, `$HOME/.config/pi/agents`, `<cwd>/.pi/agents`, `pi.agents` paths. YAML frontmatter (Pi `parseFrontmatter`) may set defaults for this run: `name` (id), `description`, `model`, `thinking`, `inherit_context`, `isolated`, `max_turns`. Tool arguments override frontmatter when both are set.",
});

const taskItem = Type.Object({
  task: Type.String({
    description:
      "Instructions for this sub-agent; optional fields below override batch-level defaults.",
  }),
  description: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 72,
      description:
        "Short tree label; optional if this task’s persona frontmatter sets `description`.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "Optional per-task model hint; falls back to batch `model` then parent model.",
    }),
  ),
  thinking: Type.Optional(
    Type.String({
      description:
        "Optional per-task thinking level; falls back to batch `thinking`.",
    }),
  ),
  inherit_context: Type.Optional(
    Type.Boolean({
      description:
        "When true, prepends truncated parent system prompt; falls back to batch `inherit_context`.",
      default: false,
    }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description:
        "Per-task isolated flag; falls back to batch `isolated` (default true).",
    }),
  ),
  max_turns: Type.Optional(
    Type.Number({
      description: "Per-task turn cap; falls back to batch `max_turns`.",
      minimum: 1,
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description:
        "Per-task wall-clock cap merged with parent/tool abort; falls back to batch `timeout_ms` then ~/.agent/subagents/settings.json `timeout_ms`. 0 disables extra timeout.",
      minimum: 0,
    }),
  ),
  agent_type: Type.Optional(subagentAgentTypeSchema),
});

export const subagentParams = Type.Object({
  task: Type.Optional(
    Type.String({
      description:
        "Single-task mode: one assignment (mutually exclusive with non-empty `tasks`).",
    }),
  ),
  description: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 72,
      description:
        "Single mode: short tree label with `task`. Optional if the selected persona frontmatter sets `description`. Omit when using `tasks`.",
    }),
  ),
  tasks: Type.Optional(
    Type.Array(taskItem, {
      minItems: 1,
      maxItems: 32,
      description:
        "Parallel batch: multiple assignments run with a concurrency limit (mutually exclusive with non-empty `task`). Partial failures are all reported in the tool result text and `details.batch`.",
    }),
  ),
  background: Type.Optional(
    Type.Boolean({
      default: false,
      description:
        "When true, starts the run asynchronously and returns immediately with { id } in the reply; use `subagent_status` to read results. Cancellation follows the parent session signal and optional `timeout_ms`.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "Optional model hint: exact provider/modelId, model id, fuzzy name, etc. Resolved via @htwang-contrib/common resolveModel against getAvailable(); falls back to parent model. In batch mode, applies to any task without its own `model`.",
    }),
  ),
  thinking: Type.Optional(
    Type.String({
      description:
        "Optional thinking level: off, minimal, low, medium, high, xhigh. Invalid values are ignored.",
    }),
  ),
  inherit_context: Type.Optional(
    Type.Boolean({
      description:
        "When true, prepends a truncated copy of the parent system prompt before each task (unless overridden per task).",
      default: false,
    }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description:
        "When true (default), each sub-agent loads only the bundled `@htwang-contrib/protect-secrets` extension (via `extensionFactories`) plus read/search tools (read, grep, find, ls). When false, bash/edit/write are enabled; other user extensions stay disabled to avoid nested subagent registration. Child sessions never receive `subagent` or `subagent_status` tools.",
      default: true,
    }),
  ),
  max_turns: Type.Optional(
    Type.Number({
      description:
        "Optional cap on agentic turns per sub-agent; after this count the sub-agent is steered to finish, then hard-aborted if it continues.",
      minimum: 1,
    }),
  ),
  max_concurrent: Type.Optional(
    Type.Number({
      description:
        "Parallel batch only: overrides ~/.agent/subagents/settings.json `max_concurrent` for this call (minimum 1).",
      minimum: 1,
    }),
  ),
  max_total: Type.Optional(
    Type.Number({
      description:
        "Parallel batch only: overrides settings `max_total` (maximum number of tasks accepted in `tasks`) for this call (minimum 1).",
      minimum: 1,
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description:
        "Optional wall-clock cap (milliseconds) merged with parent/tool `AbortSignal` via `AbortSignal.timeout`; overrides ~/.agent/subagents/settings.json `timeout_ms` when set. 0 disables extra timeout. In batch mode, applies to tasks without their own `timeout_ms`.",
      minimum: 0,
    }),
  ),
  agent_type: Type.Optional(subagentAgentTypeSchema),
});

export const subagentStatusParams = Type.Object({
  id: Type.String({
    description: "Job id printed in the background `subagent` tool result.",
  }),
});
