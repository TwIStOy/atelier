import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ChildAgentProgress, ChildAgentUsageSnapshot, RunChildAgentResult } from "@htwang-contrib/common";
import { runChildAgent } from "@htwang-contrib/common";
import { buildSubagentAgentCatalog, type SubagentAgentCatalog } from "./agent-catalog.ts";
import { SUBAGENT_SESSION_DIR } from "./paths.ts";

export {
  extractAssistantText,
  finalTurnError,
  parseThinking,
} from "@htwang-contrib/common";
export { assistantMessageText } from "@htwang-contrib/common/child-agent";

export type SubagentUsageSnapshot = ChildAgentUsageSnapshot;

export type SubagentBatchItemDetail = {
  index: number;
  ok: boolean;
  text?: string;
  error?: string;
  tool_calls: number;
  sub_session_file?: string;
  agent_type?: string;
  description: string;
} & Partial<SubagentUsageSnapshot>;

export type SubagentRunDetails = {
  tool_calls: number;
  sub_session_file?: string;
  parent_session_id: string;
  parent_session_file: string;
  mode?: "single" | "batch";
  task_index?: number;
  task_total?: number;
  per_task_tool_calls?: number[];
  per_task_started?: boolean[];
  per_task_done?: boolean[];
  per_task_ok?: boolean[];
  per_task_usage_input?: number[];
  per_task_usage_output?: number[];
  per_task_context_percent?: (number | null)[];
  batch?: SubagentBatchItemDetail[];
  agent_type?: string;
  description?: string;
  ok?: boolean;
  error?: string;
  background?: boolean;
  background_id?: string;
} & Partial<SubagentUsageSnapshot>;

export type RunSubAgentInput = {
  task: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
  stream?: { task_index: number; task_total: number };
  agent_type?: string;
};

export type RunSubAgentResult = Omit<RunChildAgentResult, "value">;

export type SubagentChildProgress = ChildAgentProgress;

export async function runSubAgent(
  ctx: ExtensionContext,
  input: RunSubAgentInput,
  signal: AbortSignal | undefined,
  onChildProgress?: (p: SubagentChildProgress) => void,
  catalog?: SubagentAgentCatalog,
): Promise<RunSubAgentResult> {
  const result = await runChildAgent(
    ctx,
    {
      ...input,
      catalog: catalog ?? buildSubagentAgentCatalog(ctx.cwd),
      sessionDir: SUBAGENT_SESSION_DIR,
      onProgress: onChildProgress,
    },
    signal,
  );
  return result;
}
