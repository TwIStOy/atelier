import type { SubagentRunDetails } from "./run-agent.ts";

export type SubagentDetailsInput = Partial<SubagentRunDetails> &
  Pick<SubagentRunDetails, "tool_calls">;

export function subagentDetails(
  partial: SubagentDetailsInput,
): SubagentRunDetails {
  return {
    ...partial,
    parent_session_id: partial.parent_session_id ?? "unknown",
    parent_session_file: partial.parent_session_file ?? "",
  } satisfies SubagentRunDetails;
}
