import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { AgentSessionEvent, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { recordChildSessionFinished, recordChildSessionStarted } from "./session-links.ts";

const DEFAULT_SESSION_DIR = path.join(homedir(), ".agent", "isolated-sessions");

export interface IsolatedSessionOptions {
  extensionFactories: ExtensionFactory[];
  systemPrompt: string;
  task: string;
  label: string;
  sessionDir?: string;
  model?: ExtensionContext["model"];
  allowedTools?: string[];
  onProgress?: (toolCalls: number) => void;
}

export interface IsolatedSessionResult {
  text: string;
  isError: boolean;
  errorMessage?: string;
  toolCalls: number;
  subSessionFile?: string;
}

type IsolatedMessageLike = {
  role: string;
  content?: ReadonlyArray<{ type: string; text?: string }>;
};

function lastAssistantText(messages: readonly IsolatedMessageLike[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant" || !msg.content) continue;
    const chunks: string[] = [];
    for (const part of msg.content) {
      if (part.type === "text" && typeof part.text === "string") chunks.push(part.text);
    }
    const text = chunks.join("").trim();
    if (text) return text;
  }
  return "";
}

export async function runIsolatedSession(
  ctx: ExtensionContext,
  options: IsolatedSessionOptions,
  signal?: AbortSignal,
): Promise<IsolatedSessionResult> {
  const model = options.model ?? ctx.model;
  if (!model) {
    return {
      text: "",
      isError: true,
      errorMessage: `${options.label}: no model available — set a session model first.`,
      toolCalls: 0,
    };
  }

  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const parentHeader = ctx.sessionManager.getHeader();
  const sessionDir = options.sessionDir ?? DEFAULT_SESSION_DIR;

  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionManager = SessionManager.create(cwd, sessionDir, {
    id: randomUUID(),
    ...(parentHeader?.id ? { parentSession: parentHeader.id } : {}),
  });

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    extensionFactories: options.extensionFactories,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => options.systemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const modelRuntime = await ModelRuntime.create();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model,
    tools: options.allowedTools,
    resourceLoader: loader,
    sessionManager,
    settingsManager,
  });

  await session.bindExtensions({});

  const parentSessionId = ctx.sessionManager.getHeader()?.id;
  const parentSessionFile = ctx.sessionManager.getSessionFile() ?? "";
  const childSessionFile = session.sessionManager.getSessionFile() ?? "";
  if (parentSessionId) {
    recordChildSessionStarted(parentSessionId, { parentSessionFile, childSessionFile });
  }

  let toolCalls = 0;
  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === "tool_execution_end") {
      toolCalls += 1;
      options.onProgress?.(toolCalls);
    }
  });

  const onAbort = () => {
    void session.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  let errored = false;
  try {
    await session.prompt(options.task);
  } catch (e) {
    errored = true;
    const msg = e instanceof Error ? e.message : String(e);
    return {
      text: "",
      isError: true,
      errorMessage: `${options.label} side-call failed: ${msg}`,
      toolCalls,
      subSessionFile: session.sessionManager.getSessionFile() ?? undefined,
    };
  } finally {
    unsub();
    signal?.removeEventListener("abort", onAbort);
    if (parentSessionId) {
      recordChildSessionFinished(parentSessionId, {
        parentSessionFile,
        childSessionFile,
        toolCalls,
        status: errored ? "error" : "done",
      });
    }
  }

  const text = lastAssistantText(session.messages);
  return {
    text,
    isError: text.length === 0,
    errorMessage: text.length === 0 ? `${options.label} side-call produced no output` : undefined,
    toolCalls,
    subSessionFile: session.sessionManager.getSessionFile() ?? undefined,
  };
}
