export function validateTaskShape(params: {
  task?: string;
  description?: string;
  tasks?: { task: string; description: string }[];
}):
  | { ok: true; mode: "single" }
  | { ok: true; mode: "batch" }
  | { ok: false; message: string } {
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
      message:
        "subagent: provide `task` (single) or a non-empty `tasks` array (parallel batch).",
    };
  }
  if (hasTasks && params.tasks) {
    for (let i = 0; i < params.tasks.length; i++) {
      if (!params.tasks[i].task?.trim()) {
        return {
          ok: false,
          message: `subagent: tasks[${i}].task is empty.`,
        };
      }
      if (!params.tasks[i].description?.trim()) {
        return {
          ok: false,
          message: `subagent: tasks[${i}].description is required (short tree label).`,
        };
      }
    }
    return { ok: true, mode: "batch" };
  }
  if (!params.description?.trim()) {
    return {
      ok: false,
      message:
        "subagent: `description` is required in single-task mode (short label for the tool tree).",
    };
  }
  return { ok: true, mode: "single" };
}
