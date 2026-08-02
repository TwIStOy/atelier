import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type {
  AgentSessionEvent,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { registerWikiIngestTool } from "./index.ts";

const INGEST_SESSION_DIR = path.join(homedir(), ".agent", "llm-wiki", "session");

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

export interface IngestSessionResult {
  text: string;
  isError: boolean;
  errorMessage?: string;
  toolCalls: number;
  subSessionFile?: string;
}

type IngestMessageLike = {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
};

function lastAssistantText(messages: readonly IngestMessageLike[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const chunks: string[] = [];
    for (const part of msg.content) {
      if (part.type === "text" && typeof part.text === "string") chunks.push(part.text);
    }
    const text = chunks.join("").trim();
    if (text) return text;
  }
  return "";
}

export async function runIngestSession(
  ctx: ExtensionContext,
  input: IngestSessionInput,
  signal?: AbortSignal,
): Promise<IngestSessionResult> {
  if (!ctx.model) {
    return {
      text: "",
      isError: true,
      errorMessage: "/wiki-ingest: no model available — set a session model first.",
      toolCalls: 0,
    };
  }

  const packetClause = input.packetId
    ? ` Restrict the run to the Source Packet ${input.packetId} by passing \`packetId: "${input.packetId}"\` to wiki_ingest.`
    : "";
  const task = `Ingest pending Source Packets into the LLM Wiki using the wiki_ingest tool, then report the summary.${packetClause}`;

  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const parentHeader = ctx.sessionManager.getHeader();

  fs.mkdirSync(INGEST_SESSION_DIR, { recursive: true });
  const sessionManager = SessionManager.create(cwd, INGEST_SESSION_DIR, {
    id: randomUUID(),
    ...(parentHeader?.id ? { parentSession: parentHeader.id } : {}),
  });

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    extensionFactories: [ingestToolsFactory],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => INGEST_SYSTEM_PROMPT,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const modelRuntime = await ModelRuntime.create();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: ctx.model,
    tools: [],
    resourceLoader: loader,
    sessionManager,
    settingsManager,
  });

  await session.bindExtensions({});

  let toolCalls = 0;
  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "tool_execution_end") toolCalls += 1;
  });

  const onAbort = () => {
    void session.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await session.prompt(task);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      text: "",
      isError: true,
      errorMessage: `/wiki-ingest side-call failed: ${msg}`,
      toolCalls,
      subSessionFile: session.sessionManager.getSessionFile() ?? undefined,
    };
  } finally {
    unsub();
    signal?.removeEventListener("abort", onAbort);
  }

  const text = lastAssistantText(session.messages);
  return {
    text,
    isError: text.length === 0,
    errorMessage: text.length === 0 ? "/wiki-ingest side-call produced no output" : undefined,
    toolCalls,
    subSessionFile: session.sessionManager.getSessionFile() ?? undefined,
  };
}
