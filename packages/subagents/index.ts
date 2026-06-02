import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  buildSubagentAgentCatalog,
  subagentsPersonasSystemPromptXml,
} from "./agent-catalog.ts";
import { runSubagentsAgentsCommand } from "./agents-inspect.ts";
import { registerSubagentStatusTool, registerSubagentTool } from "./tool.ts";

export default function (pi: ExtensionAPI) {
  registerSubagentTool(pi);
  registerSubagentStatusTool(pi);

  pi.registerCommand("subagents-agents", {
    description:
      "Browse subagent personas (TUI): pick an id, inspect source path, tools, and resolved model defaults",
    async handler(_args, ctx) {
      await runSubagentsAgentsCommand(ctx as ExtensionContext);
    },
  });

  pi.on("before_agent_start", (event, ctx) => {
    const catalog = buildSubagentAgentCatalog(ctx.cwd);
    const block = subagentsPersonasSystemPromptXml(catalog);
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });
}
