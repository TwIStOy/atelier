import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type IsolatedSessionResult, runIsolatedSession } from "@htwang-contrib/common";
import { registerWikiLintTool } from "./index.ts";

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
): Promise<LintSessionResult> {
  const fixClause = input.fix ? " Pass `fix: true` to auto-capture uncaptured Inbox files." : "";
  const task = `Run the wiki health check using the wiki_lint tool, then report the summary.${fixClause}`;
  return runIsolatedSession(
    ctx,
    { label: "/wiki-lint", extensionFactories: [lintToolsFactory], systemPrompt: LINT_SYSTEM_PROMPT, task },
    signal,
  );
}
