import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type IsolatedSessionResult, runIsolatedSession } from "@htwang-contrib/common";
import { resolveIngestModel } from "./config.ts";
import type { ReviewItem } from "./core/review.ts";
import { registerWikiEnsurePageTool, registerWikiReviewTool } from "./index.ts";
import { WIKI_SIDE_CALL_BASE_TOOLS, WIKI_SIDE_CALL_FACTORIES } from "./side-call-base.ts";

const REVIEW_EXEC_SYSTEM_PROMPT = [
  "You are the LLM Wiki Review Queue executor, running in an isolated session.",
  "You are given open review items whose suggested action is create_page. Execute EACH one, in order:",
  "",
  "1. If the item has a packetId, read its Source Packet for grounding: raw/sources/<packetId>/extracted.md under the active vault (the .llm-wiki directory in the cwd).",
  "2. Call wiki_ensure_page with a fitting type (concept | entity | synthesis — infer from the item's kind/title; default concept), the item's title, and sources=[packetId] when a packet is cited.",
  "3. Fill the page body at the path returned by wiki_ensure_page (use the write tool): a focused note grounded in the cited packet, citing it as [[sources/SRC-...]]. If the page already existed (created=false), APPEND a short section and keep prior content — never clobber it.",
  "4. Resolve the item via wiki_review with action=resolve, decision=create_page, note=<page id>.",
  "",
  "Finally report one line per item: <item id> -> <page id> (or the error).",
  "Do not capture, ingest, lint, or do anything else.",
].join("\n");

const reviewExecToolsFactory: ExtensionFactory = (pi: ExtensionAPI) => {
  registerWikiEnsurePageTool(pi);
  registerWikiReviewTool(pi);
};

export interface ReviewExecSessionInput {
  items: ReviewItem[];
}

export type ReviewExecSessionResult = IsolatedSessionResult;

export async function runReviewExecSession(
  ctx: ExtensionContext,
  input: ReviewExecSessionInput,
  signal?: AbortSignal,
  onProgress?: (toolCalls: number) => void,
): Promise<ReviewExecSessionResult> {
  const lines = input.items.map((item) =>
    JSON.stringify({
      id: item.id,
      kind: item.kind,
      title: item.title,
      ...(item.packetId !== undefined ? { packetId: item.packetId } : {}),
      ...(item.note !== undefined ? { note: item.note } : {}),
    }),
  );
  const task = [
    `Execute these ${input.items.length} create_page review item(s) for the LLM Wiki, then report one line per item.`,
    "",
    ...lines,
  ].join("\n");
  return runIsolatedSession(
    ctx,
    {
      label: "/wiki-review (create_page)",
      extensionFactories: [...WIKI_SIDE_CALL_FACTORIES, reviewExecToolsFactory],
      systemPrompt: REVIEW_EXEC_SYSTEM_PROMPT,
      task,
      model: resolveIngestModel(ctx) ?? undefined,
      allowedTools: [...WIKI_SIDE_CALL_BASE_TOOLS, "write", "wiki_ensure_page", "wiki_review"],
      onProgress,
    },
    signal,
  );
}
