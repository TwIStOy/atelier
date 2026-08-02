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
import { registerWikiCaptureTool } from "./index.ts";

const CAPTURE_SESSION_DIR = path.join(homedir(), ".agent", "llm-wiki", "session");

const CAPTURE_SYSTEM_PROMPT = [
  "You are the LLM Wiki capture agent, running in an isolated session.",
  "Your only job is to capture ONE source into the wiki as an immutable Source Packet, then report the result.",
  "",
  "Call the `wiki_capture` tool exactly once. Pick sourceType from the source you are given:",
  '- an http(s) URL -> sourceType "url" (pass it as `url`);',
  '- a path to an existing local .md/.txt file -> sourceType "file" (pass it as `originPath`);',
  '- otherwise treat the input as pasted text -> sourceType "text" (pass it as `text`).',
  "",
  "After the tool returns, reply with one short line: the Source Packet id and the vault it landed in.",
  "Do not read files, do not ingest, do not create pages, do not do anything else.",
].join("\n");

const captureToolsFactory: ExtensionFactory = (pi: ExtensionAPI) => {
  registerWikiCaptureTool(pi);
};

export interface CaptureSessionInput {
  source: string;
}

export interface CaptureSessionResult {
  text: string;
  isError: boolean;
  errorMessage?: string;
  toolCalls: number;
  subSessionFile?: string;
}

type CaptureMessageLike = {
  role: string;
  content: ReadonlyArray<{ type: string; text?: string }>;
};

function lastAssistantText(messages: readonly CaptureMessageLike[]): string {
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

export async function runCaptureSession(
  ctx: ExtensionContext,
  input: CaptureSessionInput,
  signal?: AbortSignal,
): Promise<CaptureSessionResult> {
  const source = input.source.trim();
  if (!source) {
    return { text: "", isError: true, errorMessage: "/wiki-capture: source argument is empty", toolCalls: 0 };
  }
  if (!ctx.model) {
    return {
      text: "",
      isError: true,
      errorMessage: "/wiki-capture: no model available — set a session model first.",
      toolCalls: 0,
    };
  }

  const task = `Capture the following source into the LLM Wiki as an immutable Source Packet using the wiki_capture tool, then report the packet id.\n\nSource:\n${source}`;

  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const parentHeader = ctx.sessionManager.getHeader();

  fs.mkdirSync(CAPTURE_SESSION_DIR, { recursive: true });
  const sessionManager = SessionManager.create(cwd, CAPTURE_SESSION_DIR, {
    id: randomUUID(),
    ...(parentHeader?.id ? { parentSession: parentHeader.id } : {}),
  });

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    extensionFactories: [captureToolsFactory],
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => CAPTURE_SYSTEM_PROMPT,
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
      errorMessage: `/wiki-capture side-call failed: ${msg}`,
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
    errorMessage: text.length === 0 ? "/wiki-capture side-call produced no output" : undefined,
    toolCalls,
    subSessionFile: session.sessionManager.getSessionFile() ?? undefined,
  };
}
