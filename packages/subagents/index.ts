import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  buildSubagentAgentCatalog,
  subagentsPersonasSystemPromptXml,
} from "./agent-catalog.ts";
import { registerSubagentStatusTool, registerSubagentTool } from "./tool.ts";

export default function (pi: ExtensionAPI) {
  registerSubagentTool(pi);
  registerSubagentStatusTool(pi);

  pi.on("before_agent_start", (event, ctx) => {
    const catalog = buildSubagentAgentCatalog(ctx.cwd);
    const block = subagentsPersonasSystemPromptXml(catalog);
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });
}
