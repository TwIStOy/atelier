import type { SubagentAgentCatalog } from "./agent-catalog.ts";
import { resolveDispatchAgentId } from "./agent-catalog.ts";
import type { SubagentSettings } from "./settings.ts";

type TaskRow = {
  task: string;
  description?: string;
  agent_type?: string;
};

export type TaskShapeParams = {
  task?: string;
  description?: string;
  tasks?: TaskRow[];
  agent_type?: string;
};

type ValidateResult = { ok: true; mode: "single" } | { ok: true; mode: "batch" } | { ok: false; message: string };

type ValidateError = { ok: false; message: string };

function fail(message: string): ValidateError {
  return { ok: false, message };
}

function hasAnyTasks(params: TaskShapeParams): boolean {
  return Boolean(params.tasks && params.tasks.length > 0);
}

function taskMode(params: TaskShapeParams): "both" | "neither" | "single" | "batch" {
  const hasTask = Boolean(params.task?.trim());
  if (hasTask) return hasAnyTasks(params) ? "both" : "single";
  return hasAnyTasks(params) ? "batch" : "neither";
}

function batchRowDescriptionError(
  row: TaskRow,
  i: number,
  agentId: string,
  catalog: SubagentAgentCatalog,
): ValidateError | null {
  const fileDesc = catalog.agents.get(agentId)?.fileOptions.description?.trim();
  if (row.description?.trim() || fileDesc) return null;
  return fail(
    `subagent: tasks[${i}].description is required unless the agent persona frontmatter sets description (agent_type → ${agentId}).`,
  );
}

function validateBatchRow(
  row: TaskRow,
  i: number,
  globalAgentType: string | undefined,
  catalog: SubagentAgentCatalog,
  settings: SubagentSettings,
): ValidateError | null {
  if (!row.task?.trim()) {
    return fail(`subagent: tasks[${i}].task is empty.`);
  }
  const dispatch = resolveDispatchAgentId(row.agent_type ?? globalAgentType, catalog, settings);
  if (!dispatch.ok) return fail(dispatch.message);
  return batchRowDescriptionError(row, i, dispatch.id, catalog);
}

function validateBatchRows(
  tasks: TaskRow[],
  globalAgentType: string | undefined,
  catalog: SubagentAgentCatalog,
  settings: SubagentSettings,
): ValidateResult {
  for (let i = 0; i < tasks.length; i++) {
    const err = validateBatchRow(tasks[i]!, i, globalAgentType, catalog, settings);
    if (err) return err;
  }
  return { ok: true, mode: "batch" };
}

function validateSingle(
  params: TaskShapeParams,
  catalog: SubagentAgentCatalog,
  settings: SubagentSettings,
): ValidateResult {
  const dispatch = resolveDispatchAgentId(params.agent_type, catalog, settings);
  if (!dispatch.ok) return fail(dispatch.message);
  const fileDesc = catalog.agents.get(dispatch.id)?.fileOptions.description?.trim();
  if (!params.description?.trim() && !fileDesc) {
    return fail("subagent: pass `description` (single mode) or set `description` in the persona Markdown frontmatter.");
  }
  return { ok: true, mode: "single" };
}

export function validateTaskShape(
  params: TaskShapeParams,
  catalog: SubagentAgentCatalog,
  settings: SubagentSettings,
): ValidateResult {
  const mode = taskMode(params);
  if (mode === "both") {
    return fail("subagent: pass either `task` or `tasks`, not both.");
  }
  if (mode === "neither") {
    return fail("subagent: provide `task` (single) or a non-empty `tasks` array (parallel batch).");
  }
  if (mode === "batch") {
    return validateBatchRows(params.tasks!, params.agent_type, catalog, settings);
  }
  return validateSingle(params, catalog, settings);
}
