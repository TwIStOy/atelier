import { Type } from "typebox";

const subagentAgentTypeSchema = Type.String({
  maxLength: 64,
  description: "Persona id to run (Markdown agent).",
});

const taskItem = Type.Object({
  task: Type.String({
    description: "Instructions for this subagent.",
  }),
  description: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 72,
      description: "Short label for this row in the tree.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description: "Model for this task.",
    }),
  ),
  thinking: Type.Optional(
    Type.String({
      description: "Thinking level for this task.",
    }),
  ),
  inherit_context: Type.Optional(
    Type.Boolean({
      description: "Prepend truncated parent system prompt.",
      default: false,
    }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description: "Use restricted read-only tools for this task.",
    }),
  ),
  max_turns: Type.Optional(
    Type.Number({
      description: "Max agent turns for this task.",
      minimum: 1,
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description: "Wall-clock timeout in milliseconds for this task.",
      minimum: 0,
    }),
  ),
  agent_type: Type.Optional(subagentAgentTypeSchema),
});

export const subagentParams = Type.Object({
  task: Type.Optional(
    Type.String({
      description: "Single-task instructions (not used with tasks).",
    }),
  ),
  description: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 72,
      description: "Short label in single-task mode.",
    }),
  ),
  tasks: Type.Optional(
    Type.Array(taskItem, {
      minItems: 1,
      maxItems: 32,
      description: "Parallel batch of tasks.",
    }),
  ),
  background: Type.Optional(
    Type.Boolean({
      default: false,
      description:
        "Return immediately with a job id; poll with subagent_status.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description: "Model for the run or batch default per task.",
    }),
  ),
  thinking: Type.Optional(
    Type.String({
      description: "Thinking level.",
    }),
  ),
  inherit_context: Type.Optional(
    Type.Boolean({
      description: "Prepend truncated parent system prompt.",
      default: false,
    }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description: "Restrict child to read-only tools when true.",
      default: true,
    }),
  ),
  max_turns: Type.Optional(
    Type.Number({
      description: "Max agent turns per subagent.",
      minimum: 1,
    }),
  ),
  max_concurrent: Type.Optional(
    Type.Number({
      description: "Max parallel tasks in a batch.",
      minimum: 1,
    }),
  ),
  max_total: Type.Optional(
    Type.Number({
      description: "Max number of tasks in tasks.",
      minimum: 1,
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({
      description: "Wall-clock timeout in milliseconds.",
      minimum: 0,
    }),
  ),
  agent_type: Type.Optional(subagentAgentTypeSchema),
});

export const subagentStatusParams = Type.Object({
  id: Type.String({
    description: "Background job id from subagent.",
  }),
});
