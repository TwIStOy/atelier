import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildSubagentAgentCatalog, subagentsPersonasSystemPromptXml } from "./agent-catalog.ts";
import { runSubagentsAgentsCommand } from "./agents-inspect.ts";
import { shouldInjectSubagentsParentSystemPrompt, subagentsFeatureSystemPrompt } from "./feature-system-prompt.ts";
import { registerGitCloneTool } from "./git-clone/index.ts";
import { registerSubagentStatusTool, registerSubagentTool } from "./tool.ts";
import { runSubagentViewerCommand } from "./viewer/command.ts";

export default function (pi: ExtensionAPI) {
  registerSubagentTool(pi);
  registerSubagentStatusTool(pi);

  pi.registerCommand("subagents-agents", {
    description: "Browse subagent personas (TUI): pick an id, inspect source path, tools, and resolved model defaults",
    async handler(_args, ctx) {
      await runSubagentsAgentsCommand(ctx as ExtensionContext);
    },
  });

  pi.registerCommand("view-subagents", {
    description:
      "View subagent run output (TUI): pick a run from this session, then read its conversation, tool calls, and thinking blocks in a popup; ←/→ switches runs, Tab reopens the picker",
    async handler(_args, ctx) {
      await runSubagentViewerCommand(ctx);
    },
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (!shouldInjectSubagentsParentSystemPrompt(ctx)) {
      return { systemPrompt: event.systemPrompt };
    }
    const catalog = buildSubagentAgentCatalog(ctx.cwd);
    const block = subagentsPersonasSystemPromptXml(catalog);
    return {
      systemPrompt: [event.systemPrompt, subagentsFeatureSystemPrompt(), block].join("\n\n"),
    };
  });
}

export function gitCloneExtension(pi: ExtensionAPI) {
  registerGitCloneTool(pi);
}
