import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type IsolatedSessionResult, runIsolatedSession } from "@htwang-contrib/common";
import { resolveIngestModel } from "./config.ts";
import { registerWikiIngestTool } from "./index.ts";
import { WIKI_SIDE_CALL_BASE_TOOLS, WIKI_SIDE_CALL_FACTORIES } from "./side-call-base.ts";

const INGEST_SYSTEM_PROMPT = [
  "You are the LLM Wiki ingest agent, running in an isolated session.",
  "Your only job is to batch-ingest pending Source Packets into cited Wiki Pages, then report the result.",
  "",
  "Call the `wiki_ingest` tool exactly once. If a specific Source Packet id is given, pass it as `packetId`; otherwise call it with no arguments to ingest every pending packet.",
  "",
  "After the tool returns, reply with its summary line (ingested/failed/skipped counts).",
  "Do not read files, do not capture, do not create pages yourself, do not do anything else.",
].join("\n");

const ingestToolsFactory: ExtensionFactory = (pi: ExtensionAPI) => {
  registerWikiIngestTool(pi);
};

export interface IngestSessionInput {
  packetId?: string;
}

export type IngestSessionResult = IsolatedSessionResult;

export async function runIngestSession(
  ctx: ExtensionContext,
  input: IngestSessionInput,
  signal?: AbortSignal,
): Promise<IngestSessionResult> {
  const packetClause = input.packetId
    ? ` Restrict the run to the Source Packet ${input.packetId} by passing \`packetId: "${input.packetId}"\` to wiki_ingest.`
    : "";
  const task = `Ingest pending Source Packets into the LLM Wiki using the wiki_ingest tool, then report the summary.${packetClause}`;
  return runIsolatedSession(
    ctx,
    {
      label: "/wiki-ingest",
      extensionFactories: [...WIKI_SIDE_CALL_FACTORIES, ingestToolsFactory],
      systemPrompt: INGEST_SYSTEM_PROMPT,
      task,
      model: resolveIngestModel(ctx) ?? undefined,
      allowedTools: [...WIKI_SIDE_CALL_BASE_TOOLS, "wiki_ingest"],
    },
    signal,
  );
}
