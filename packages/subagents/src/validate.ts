import type { SubagentAgentCatalog } from "./agent-catalog.ts";
import { resolveDispatchAgentId } from "./agent-catalog.ts";
import type { SubagentSettings } from "./settings.ts";

export function validateTaskShape(
  params: {
    task?: string;
    description?: string;
    tasks?: Array<{
      task: string;
      description?: string;
      agent_type?: string;
    }>;
    agent_type?: string;
  },
  catalog: SubagentAgentCatalog,
  settings: SubagentSettings,
): { ok: true; mode: "single" } | { ok: true; mode: "batch" } | { ok: false; message: string } {
  const hasTask = Boolean(params.task?.trim());
  const hasTasks = Boolean(params.tasks && params.tasks.length > 0);
  if (hasTask && hasTasks) {
    return {
      ok: false,
      message: "subagent: pass either `task` or `tasks`, not both.",
    };
  }
  if (!hasTask && !hasTasks) {
    return {
      ok: false,
      message: "subagent: provide `task` (single) or a non-empty `tasks` array (parallel batch).",
    };
  }
  if (hasTasks && params.tasks) {
    for (let i = 0; i < params.tasks.length; i++) {
      const row = params.tasks[i];
      if (!row.task?.trim()) {
        return {
          ok: false,
          message: `subagent: tasks[${i}].task is empty.`,
        };
      }
      const dispatch = resolveDispatchAgentId(row.agent_type ?? params.agent_type, catalog, settings);
      if (!dispatch.ok) return { ok: false, message: dispatch.message };
      const fileDesc = catalog.agents.get(dispatch.id)?.fileOptions.description?.trim();
      if (!row.description?.trim() && !fileDesc) {
        return {
          ok: false,
          message: `subagent: tasks[${i}].description is required unless the agent persona frontmatter sets description (agent_type → ${dispatch.id}).`,
        };
      }
    }
    return { ok: true, mode: "batch" };
  }
  const dispatch = resolveDispatchAgentId(params.agent_type, catalog, settings);
  if (!dispatch.ok) return { ok: false, message: dispatch.message };
  const fileDesc = catalog.agents.get(dispatch.id)?.fileOptions.description?.trim();
  if (!params.description?.trim() && !fileDesc) {
    return {
      ok: false,
      message: "subagent: pass `description` (single mode) or set `description` in the persona Markdown frontmatter.",
    };
  }
  return { ok: true, mode: "single" };
}
