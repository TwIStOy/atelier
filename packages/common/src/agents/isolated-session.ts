import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type {
  AgentSession,
  AgentSessionEvent,
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
import { recordChildSessionFinished, recordChildSessionStarted } from "./session-links.ts";
import { shutdownChildSession } from "./session-shutdown.ts";

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
  content?: string | ReadonlyArray<{ type: string; text?: string }>;
};

function messageContentText(content: ReadonlyArray<{ type: string; text?: string }>): string {
  const chunks: string[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") chunks.push(part.text);
  }
  return chunks.join("").trim();
}

function assistantContentText(msg: IsolatedMessageLike): string {
  const content = msg.content;
  if (!content || typeof content === "string") return "";
  return messageContentText(content);
}

function lastAssistantText(messages: readonly IsolatedMessageLike[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const text = assistantContentText(msg);
    if (text) return text;
  }
  return "";
}

type IsolatedSessionLinks = {
  parentSessionId: string | undefined;
  parentSessionFile: string;
  childSessionFile: string;
};

function isolatedSessionLinks(ctx: ExtensionContext, session: AgentSession): IsolatedSessionLinks {
  return {
    parentSessionId: ctx.sessionManager.getHeader()?.id,
    parentSessionFile: ctx.sessionManager.getSessionFile() ?? "",
    childSessionFile: session.sessionManager.getSessionFile() ?? "",
  };
}

async function createIsolatedSession(
  ctx: ExtensionContext,
  options: IsolatedSessionOptions,
  model: NonNullable<IsolatedSessionOptions["model"]>,
): Promise<AgentSession> {
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
  return session;
}

type IsolatedToolCallProgress = { unsub: () => void; toolCalls: () => number };

function subscribeToolCallProgress(
  session: AgentSession,
  onProgress: ((toolCalls: number) => void) | undefined,
): IsolatedToolCallProgress {
  let count = 0;
  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (event.type !== "tool_execution_end") return;
    count += 1;
    onProgress?.(count);
  });
  return { unsub, toolCalls: () => count };
}

function wireAbortToSession(session: AgentSession, signal: AbortSignal | undefined): () => void {
  const onAbort = () => {
    void session.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  return () => signal?.removeEventListener("abort", onAbort);
}

function isolatedErrorResult(
  label: string,
  msg: string,
  toolCalls: number,
  session: AgentSession,
): IsolatedSessionResult {
  return {
    text: "",
    isError: true,
    errorMessage: `${label} side-call failed: ${msg}`,
    toolCalls,
    subSessionFile: session.sessionManager.getSessionFile() ?? undefined,
  };
}

function isolatedSuccessResult(label: string, toolCalls: number, session: AgentSession): IsolatedSessionResult {
  const text = lastAssistantText(session.messages);
  return {
    text,
    isError: text.length === 0,
    errorMessage: text.length === 0 ? `${label} side-call produced no output` : undefined,
    toolCalls,
    subSessionFile: session.sessionManager.getSessionFile() ?? undefined,
  };
}

function settleIsolatedSession(links: IsolatedSessionLinks, toolCalls: number, errored: boolean): void {
  if (!links.parentSessionId) return;
  recordChildSessionFinished(links.parentSessionId, {
    parentSessionFile: links.parentSessionFile,
    childSessionFile: links.childSessionFile,
    toolCalls,
    status: errored ? "error" : "done",
  });
}

async function runIsolatedPrompt(
  session: AgentSession,
  options: IsolatedSessionOptions,
  progress: IsolatedToolCallProgress,
): Promise<IsolatedSessionResult | undefined> {
  try {
    await session.prompt(options.task);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return isolatedErrorResult(options.label, msg, progress.toolCalls(), session);
  }
  return undefined;
}

async function driveIsolatedSession(
  ctx: ExtensionContext,
  options: IsolatedSessionOptions,
  session: AgentSession,
  signal: AbortSignal | undefined,
): Promise<IsolatedSessionResult> {
  const links = isolatedSessionLinks(ctx, session);
  if (links.parentSessionId) {
    recordChildSessionStarted(links.parentSessionId, {
      parentSessionFile: links.parentSessionFile,
      childSessionFile: links.childSessionFile,
    });
  }

  const progress = subscribeToolCallProgress(session, options.onProgress);
  const removeAbort = wireAbortToSession(session, signal);

  let result: IsolatedSessionResult | undefined;
  try {
    result = await runIsolatedPrompt(session, options, progress);
  } finally {
    progress.unsub();
    removeAbort();
    settleIsolatedSession(links, progress.toolCalls(), result !== undefined);
    await shutdownChildSession(session);
  }

  return result ?? isolatedSuccessResult(options.label, progress.toolCalls(), session);
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

  const session = await createIsolatedSession(ctx, options, model);
  return driveIsolatedSession(ctx, options, session, signal);
}
