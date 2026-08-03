import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type IsolatedSessionResult, runIsolatedSession } from "@htwang-contrib/common";
import { resolveIngestModel } from "./config.ts";
import { registerWikiDeepResearchTool } from "./index.ts";
import { WIKI_SIDE_CALL_FACTORIES } from "./side-call-base.ts";

const RESEARCH_SYSTEM_PROMPT = [
  "You are the LLM Wiki deep research agent, running in an isolated session.",
  "Your only job is to run the Deep Research pipeline for open deep_research Review Queue items, then report the result.",
  "",
  "Call the `wiki_deep_research` tool exactly once. If a specific Review Queue item id is given, pass it as `reviewItemId`.",
  "",
  "After the tool returns, reply with its summary. Do not do anything else.",
].join("\n");

const researchToolsFactory: ExtensionFactory = (pi: ExtensionAPI) => {
  registerWikiDeepResearchTool(pi);
};

export interface ResearchSessionInput {
  reviewItemId?: string;
}

export type ResearchSessionResult = IsolatedSessionResult;

export async function runResearchSession(
  ctx: ExtensionContext,
  input: ResearchSessionInput,
  signal?: AbortSignal,
): Promise<ResearchSessionResult> {
  const itemClause = input.reviewItemId
    ? ` Restrict the run to Review Queue item ${input.reviewItemId} by passing \`reviewItemId: "${input.reviewItemId}"\` to wiki_deep_research.`
    : "";
  const task = `Run the Deep Research pipeline using the wiki_deep_research tool, then report the summary.${itemClause}`;
  return runIsolatedSession(
    ctx,
    {
      label: "/wiki-research",
      extensionFactories: [...WIKI_SIDE_CALL_FACTORIES, researchToolsFactory],
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      task,
      model: resolveIngestModel(ctx) ?? undefined,
      allowedTools: ["wiki_deep_research"],
    },
    signal,
  );
}
