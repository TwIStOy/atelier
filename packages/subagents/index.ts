import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runInProcessAgent, type SubagentRunDetails } from "./run-agent.ts";

function subagentDetails(
  partial: Partial<SubagentRunDetails> & Pick<SubagentRunDetails, "tool_calls">,
): SubagentRunDetails {
  return {
    tool_calls: partial.tool_calls,
    sub_session_file: partial.sub_session_file,
    parent_session_id: partial.parent_session_id ?? "unknown",
    parent_session_file: partial.parent_session_file ?? "",
  };
}

const subagentParams = Type.Object({
  task: Type.String({
    description: "Instructions for the in-process sub-agent to carry out.",
  }),
  model: Type.Optional(
    Type.String({
      description:
        "Optional model hint: exact provider/modelId, model id, fuzzy name, etc. Resolved via @htwang-contrib/common resolveModel against getAvailable(); falls back to parent model.",
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
        "When true, prepends a truncated copy of the parent system prompt before the task.",
      default: false,
    }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description:
        "When true (default), the sub-agent loads no extensions and only read/search tools (read, grep, find, ls). When false, bash/edit/write are enabled; extensions stay disabled to avoid nested subagent registration.",
      default: true,
    }),
  ),
  max_turns: Type.Optional(
    Type.Number({
      description:
        "Optional cap on agentic turns; after this count the sub-agent is steered to finish, then hard-aborted if it continues.",
      minimum: 1,
    }),
  ),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Runs a separate in-process Pi AgentSession (no extra pi OS process). Subagent sessions persist under ~/.agent/subagents/session and are linked to the parent session in ~/.agent/subagents/by-parent/<parent_id>.jsonl. Default is isolated read-only tools. Use isolated=false only when the sub-agent must mutate files or run shell commands. Optional model uses the same resolveModel matching as other @htwang-contrib packages.",
    parameters: subagentParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (!ctx.model) {
        const parentSessionId = ctx.sessionManager.getHeader()?.id ?? "unknown";
        const parentSessionFile = ctx.sessionManager.getSessionFile() ?? "";
        return {
          content: [
            {
              type: "text",
              text: "subagent: parent session has no active model; select a model first.",
            },
          ],
          details: subagentDetails({
            tool_calls: 0,
            parent_session_id: parentSessionId,
            parent_session_file: parentSessionFile,
          }),
        };
      }
      const merged = signal
        ? ctx.signal
          ? AbortSignal.any([signal, ctx.signal])
          : signal
        : ctx.signal;
      const isolated = params.isolated !== false;
      const result = await runInProcessAgent(
        ctx,
        {
          task: params.task,
          model: params.model,
          thinking: params.thinking,
          inherit_context: params.inherit_context === true,
          isolated,
          max_turns: params.max_turns,
        },
        merged,
        onUpdate,
      );
      if (result.isError) {
        return {
          content: [
            {
              type: "text",
              text: result.errorMessage ?? "subagent failed",
            },
          ],
          details: subagentDetails({
            tool_calls: result.tool_calls,
            sub_session_file: result.sub_session_file,
            parent_session_id: result.parent_session_id,
            parent_session_file: result.parent_session_file,
          }),
        };
      }
      return {
        content: [
          {
            type: "text",
            text:
              result.text.length > 0 ? result.text : "(empty subagent reply)",
          },
        ],
        details: subagentDetails({
          tool_calls: result.tool_calls,
          sub_session_file: result.sub_session_file,
          parent_session_id: result.parent_session_id,
          parent_session_file: result.parent_session_file,
        }),
      };
    },
  });
}
