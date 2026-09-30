import type { Usage } from "@earendil-works/pi-ai";
import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildSubagentAgentCatalog, resolveDispatchAgentId, resolveSubagentAgentId } from "./agent-catalog.ts";
import { subagentDetails } from "./details.ts";
import { tryParentToolUpdate, withThrottledParentFlush } from "./parent-update.ts";
import { runSubAgent, type SubagentRunDetails } from "./run-agent.ts";
import { defaultsForAgentType, type SubagentSettings } from "./settings.ts";
import { toPiUsage } from "./usage-report.ts";

export async function runSingleSubagent(
  ctx: ExtensionContext,
  args: {
    task: string;
    description: string;
    parentBase: {
      parent_session_id: string;
      parent_session_file: string;
    };
    merged: AbortSignal | undefined;
    subagentSettings: SubagentSettings;
    onUpdate?: AgentToolUpdateCallback<SubagentRunDetails>;
    globalModel?: string;
    globalThinking?: string;
    globalInherit: boolean | undefined;
    globalIsolated: boolean | undefined;
    globalMaxTurns?: number;
    globalAgentType?: string;
  },
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: SubagentRunDetails;
  usage?: Usage;
}> {
  const {
    task,
    description,
    parentBase,
    merged,
    subagentSettings,
    onUpdate,
    globalModel,
    globalThinking,
    globalInherit,
    globalIsolated,
    globalMaxTurns,
    globalAgentType,
  } = args;
  const catalog = buildSubagentAgentCatalog(ctx.cwd);
  const dispatch = resolveDispatchAgentId(globalAgentType, catalog, subagentSettings);
  const singleAgentType = dispatch.ok ? dispatch.id : resolveSubagentAgentId(globalAgentType, catalog);
  const file = catalog.agents.get(singleAgentType)?.fileOptions ?? {};
  const defs = defaultsForAgentType(subagentSettings, singleAgentType);
  const effectiveThinking = globalThinking ?? file.thinking ?? defs.thinking;
  const effectiveInherit = globalInherit ?? file.inherit_context ?? false;
  const effectiveIsolated = globalIsolated ?? file.isolated ?? true;
  const effectiveMaxTurns = globalMaxTurns ?? file.max_turns;
  let prog = {
    tool_calls: 0,
    sub_session_file: undefined as string | undefined,
    usage_input: 0,
    usage_output: 0,
    context_percent: null as number | null,
    context_tokens: null as number | null,
    context_window: 0,
  };
  const flushSingle = () => {
    if (!onUpdate) return;
    tryParentToolUpdate(onUpdate, {
      content: [
        {
          type: "text" as const,
          text: `${prog.tool_calls} tool uses…`,
        },
      ],
      details: subagentDetails({
        ...parentBase,
        tool_calls: prog.tool_calls,
        sub_session_file: prog.sub_session_file,
        mode: "single",
        agent_type: singleAgentType,
        description,
        usage_input: prog.usage_input,
        usage_output: prog.usage_output,
        context_percent: prog.context_percent,
        context_tokens: prog.context_tokens,
        context_window: prog.context_window,
      }),
    });
  };

  const ui = withThrottledParentFlush(onUpdate, flushSingle);
  ui.start();

  let result: Awaited<ReturnType<typeof runSubAgent>>;
  try {
    result = await runSubAgent(
      ctx,
      {
        task,
        model: globalModel,
        thinking: effectiveThinking,
        inherit_context: effectiveInherit,
        isolated: effectiveIsolated,
        max_turns: effectiveMaxTurns,
        agent_type: singleAgentType,
      },
      merged,
      (p) => {
        prog = {
          tool_calls: p.tool_calls,
          sub_session_file: p.sub_session_file ?? prog.sub_session_file,
          usage_input: p.usage_input,
          usage_output: p.usage_output,
          context_percent: p.context_percent,
          context_tokens: p.context_tokens,
          context_window: p.context_window,
        };
      },
      catalog,
    );
  } finally {
    ui.stopAndFlush();
  }
  if (result.isError) {
    const failureText = result.errorMessage ?? "subagent failed";
    const partial = result.text.trim();
    const usage = toPiUsage(result);
    return {
      content: [
        {
          type: "text",
          text: partial ? `${failureText}\n\nPartial output before the failure:\n\n${partial}` : failureText,
        },
      ],
      details: subagentDetails({
        tool_calls: result.tool_calls,
        sub_session_file: result.sub_session_file,
        parent_session_id: result.parent_session_id,
        parent_session_file: result.parent_session_file,
        mode: "single",
        agent_type: singleAgentType,
        description,
        ok: false,
        error: result.errorMessage ?? "subagent failed",
        usage_input: result.usage_input,
        usage_output: result.usage_output,
        usage_cache_read: result.usage_cache_read,
        usage_cache_write: result.usage_cache_write,
        usage_cost_usd: result.usage_cost_usd,
        context_percent: result.context_percent,
        context_tokens: result.context_tokens,
        context_window: result.context_window,
      }),
      ...(usage ? { usage } : {}),
    };
  }
  const usage = toPiUsage(result);
  return {
    content: [
      {
        type: "text",
        text: result.text.length > 0 ? result.text : "(empty subagent reply)",
      },
    ],
    details: subagentDetails({
      tool_calls: result.tool_calls,
      sub_session_file: result.sub_session_file,
      parent_session_id: result.parent_session_id,
      parent_session_file: result.parent_session_file,
      mode: "single",
      agent_type: singleAgentType,
      description,
      ok: true,
      usage_input: result.usage_input,
      usage_output: result.usage_output,
      usage_cache_read: result.usage_cache_read,
      usage_cache_write: result.usage_cache_write,
      usage_cost_usd: result.usage_cost_usd,
      context_percent: result.context_percent,
      context_tokens: result.context_tokens,
      context_window: result.context_window,
    }),
    ...(usage ? { usage } : {}),
  };
}
