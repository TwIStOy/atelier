import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  isExtensionDisabled,
  registerSystemPromptContribution,
  registerTuiCommands,
  SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES,
} from "@htwang-contrib/common";
import { buildSubagentAgentCatalog, subagentsPersonasSystemPromptXml } from "./agent-catalog.ts";
import { runSubagentsAgentsCommand } from "./agents-inspect.ts";
import { shouldInjectSubagentsParentSystemPrompt, subagentsFeatureSystemPrompt } from "./feature-system-prompt.ts";
import { registerGitCloneTool } from "./git-clone/index.ts";
import { registerSubagentStatusTool, registerSubagentTool } from "./tool.ts";
import { registerSubagentsConfig } from "./usage-report.ts";
import { runSubagentViewerCommand } from "./viewer/command.ts";

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("subagents")) return;
  registerSubagentsConfig();
  registerSubagentTool(pi);
  registerSubagentStatusTool(pi);

  pi.registerCommand("subagents-agents", {
    description: "Browse subagent personas (TUI): pick an id, inspect source path, tools, and resolved model defaults",
    async handler(_args, ctx) {
      await runSubagentsAgentsCommand(ctx as ExtensionContext);
    },
  });

  registerTuiCommands(pi, (api) => {
    api.registerCommand("view-subagents", {
      description:
        "View subagent run output (TUI): pick a run from this session, then read its conversation, tool calls, and thinking blocks in a popup; ←/→ switches runs, Tab reopens the picker",
      async handler(_args, ctx) {
        await runSubagentViewerCommand(ctx);
      },
    });
  });

  registerSystemPromptContribution(pi, {
    id: "subagents",
    priority: SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES.subagents,
    contribute(_event, ctx) {
      if (!shouldInjectSubagentsParentSystemPrompt(ctx)) return null;
      const catalog = buildSubagentAgentCatalog(ctx.cwd);
      const block = subagentsPersonasSystemPromptXml(catalog);
      return [subagentsFeatureSystemPrompt(), block].join("\n\n");
    },
  });
}

export function gitCloneExtension(pi: ExtensionAPI) {
  registerGitCloneTool(pi);
}
