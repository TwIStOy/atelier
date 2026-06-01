import type { SubagentRunDetails } from "./run-agent.ts";

export function subagentDetails(
  partial: SubagentRunDetails,
): SubagentRunDetails {
  return {
    tool_calls: partial.tool_calls,
    sub_session_file: partial.sub_session_file,
    parent_session_id: partial.parent_session_id ?? "unknown",
    parent_session_file: partial.parent_session_file ?? "",
    mode: partial.mode,
    task_index: partial.task_index,
    task_total: partial.task_total,
    per_task_tool_calls: partial.per_task_tool_calls,
    per_task_started: partial.per_task_started,
    per_task_done: partial.per_task_done,
    per_task_ok: partial.per_task_ok,
    per_task_usage_input: partial.per_task_usage_input,
    per_task_usage_output: partial.per_task_usage_output,
    per_task_context_percent: partial.per_task_context_percent,
    batch: partial.batch,
    agent_type: partial.agent_type,
    description: partial.description,
    ok: partial.ok,
    error: partial.error,
    background: partial.background,
    background_id: partial.background_id,
    usage_input: partial.usage_input,
    usage_output: partial.usage_output,
    context_percent: partial.context_percent,
    context_tokens: partial.context_tokens,
    context_window: partial.context_window,
  };
}
