import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type IsolatedSessionResult, runIsolatedSession } from "@htwang-contrib/common";
import { resolveIngestModel } from "./config.ts";
import { registerWikiLintTool } from "./index.ts";
import { WIKI_SIDE_CALL_BASE_TOOLS, WIKI_SIDE_CALL_FACTORIES } from "./side-call-base.ts";

const LINT_SYSTEM_PROMPT = [
  "You are the LLM Wiki lint agent, running in an isolated session.",
  "Your only job is to run the wiki health check, then report the result.",
  "",
  "Call the `wiki_lint` tool exactly once. If asked to fix, pass `fix: true` (auto-captures uncaptured Inbox files).",
  "",
  "After the tool returns, reply with its summary line. Do not do anything else.",
].join("\n");

const lintToolsFactory: ExtensionFactory = (pi: ExtensionAPI) => {
  registerWikiLintTool(pi);
};

export interface LintSessionInput {
  fix?: boolean;
}

export type LintSessionResult = IsolatedSessionResult;

export async function runLintSession(
  ctx: ExtensionContext,
  input: LintSessionInput,
  signal?: AbortSignal,
  onProgress?: (toolCalls: number) => void,
): Promise<LintSessionResult> {
  const fixClause = input.fix ? " Pass `fix: true` to auto-capture uncaptured Inbox files." : "";
  const task = `Run the wiki health check using the wiki_lint tool, then report the summary.${fixClause}`;
  return runIsolatedSession(
    ctx,
    {
      label: "/wiki-lint",
      extensionFactories: [...WIKI_SIDE_CALL_FACTORIES, lintToolsFactory],
      systemPrompt: LINT_SYSTEM_PROMPT,
      task,
      model: resolveIngestModel(ctx) ?? undefined,
      allowedTools: [...WIKI_SIDE_CALL_BASE_TOOLS, "wiki_lint"],
      onProgress,
    },
    signal,
  );
}
