import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import {
  buildSubagentAgentCatalog,
  subagentsPersonasSystemPromptXml,
} from "./agent-catalog.ts";
import { registerSubagentStatusTool, registerSubagentTool } from "./tool.ts";

const SUBAGENTS_AGENTS_MESSAGE_TYPE = "subagents_agents";

type SubagentsAgentsDetails = { ids: string[] };

function registerSubagentsAgentsStartupRenderer(pi: ExtensionAPI) {
  pi.registerMessageRenderer<SubagentsAgentsDetails>(
    SUBAGENTS_AGENTS_MESSAGE_TYPE,
    (message, options, th: Theme) => {
      const ids = message.details?.ids ?? [];
      const sorted = [...ids].sort((a, b) => a.localeCompare(b));
      const header = th.fg("mdHeading", "[Agents]");
      const compact = th.fg("dim", `  ${sorted.join(", ")}`);
      const expandedBody = sorted
        .map((id) => th.fg("dim", `  ${id}`))
        .join("\n");
      const collapsed = `${header}\n${compact}`;
      const expanded = `${header}\n${expandedBody}`;
      const body = new Text(options.expanded ? expanded : collapsed, 0, 0);
      const wrap = new Container();
      wrap.addChild(body);
      wrap.addChild(new Spacer(1));
      return wrap;
    },
  );
}

function loadedSubagentAgentIds(
  catalog: ReturnType<typeof buildSubagentAgentCatalog>,
): string[] {
  return [...catalog.agents.keys()].sort((a, b) => a.localeCompare(b));
}

export default function (pi: ExtensionAPI) {
  registerSubagentsAgentsStartupRenderer(pi);
  registerSubagentTool(pi);
  registerSubagentStatusTool(pi);

  pi.on("before_agent_start", (event, ctx) => {
    const catalog = buildSubagentAgentCatalog(ctx.cwd);
    const block = subagentsPersonasSystemPromptXml(catalog);
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });

  pi.on("session_start", (event, ctx) => {
    if (!ctx.hasUI || event.reason === "resume") return;
    const catalog = buildSubagentAgentCatalog(ctx.cwd);
    const ids = loadedSubagentAgentIds(catalog);
    pi.sendMessage(
      {
        customType: SUBAGENTS_AGENTS_MESSAGE_TYPE,
        content: ids.join(", "),
        display: true,
        details: { ids },
      },
      { triggerTurn: false },
    );
  });
}
