import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { getChildExtensionFactories } from "@htwang-contrib/common/agents/child-extensions";
import { loadGoalConfig, resolveVerifierModel } from "./config.ts";
import type { Goal } from "./types.ts";

const VERIFIER_TOOLS = ["read", "bash", "grep", "glob", "ls"];
const TURN_GRACE = 3;
const FORMAT_NUDGE =
  "Your previous response did not end with a valid verdict line. Based on your investigation so far, do not run more tools — respond now with a brief summary ending with exactly one line on its own: VERDICT: COMPLETE or VERDICT: INCOMPLETE.";

type VerdictParseResult = { parsed: true; complete: boolean; reasoning: string } | { parsed: false };

export type GoalVerificationResult =
  | { complete: true; reasoning: string }
  | { complete: false; reasoning: string }
  | { error: true; message: string };

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildVerificationSystemPrompt(): string {
  return [
    "You are an independent verification agent inside a coding session.",
    "Your ONLY job is to judge whether a stated objective has been FULLY completed in the current repository. You did not do the work yourself — verify it from scratch.",
    "",
    "Hard rules:",
    "- Do NOT create, edit, or delete any files. You are here to inspect and validate, never to fix.",
    "- Run the project's build and test commands (for example `npx tsc --build`, `npm test`) to confirm the code actually compiles and passes.",
    "- Read relevant files and grep for leftover TODOs, unhandled errors, or unmet requirements tied to the objective.",
    "- Be skeptical and thorough. Anything you cannot confirm as done counts as not done.",
    "",
    "When you finish investigating, write a concise evidence summary (what you checked and what you found), then end your reply with exactly one verdict line on its own line:",
    "  VERDICT: COMPLETE",
    "or",
    "  VERDICT: INCOMPLETE",
    "",
    "Use VERDICT: INCOMPLETE if any build or test fails, or any part of the objective is not satisfied. The verdict line must be the final line of your reply.",
  ].join("\n");
}

function buildVerificationTask(objective: string): string {
  return [
    "Determine whether the following objective is fully completed in this repository. Investigate now using your tools.",
    "",
    "<objective>",
    escapeXml(objective),
    "</objective>",
    "",
    "Remember: finish with exactly one line — VERDICT: COMPLETE or VERDICT: INCOMPLETE.",
  ].join("\n");
}

function extractAssistantText(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = assistantMessageText(messages[i]);
    if (text) return text;
  }
  return "";
}

function assistantMessageText(msg: AgentMessage): string {
  if (msg.role !== "assistant") return "";
  return joinTextParts(msg.content);
}

function joinTextParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts as TextContent[]) {
    if (part.type === "text" && typeof part.text === "string") chunks.push(part.text);
  }
  return chunks.join("").trim();
}

function parseVerdict(text: string): VerdictParseResult {
  const match = text.match(/VERDICT:\s*(COMPLETE|INCOMPLETE)\b/i);
  if (!match || match.index === undefined) {
    return { parsed: false };
  }
  const reasoning = text.slice(0, match.index).trim();
  const complete = /^complete$/i.test(match[1]);
  return {
    parsed: true,
    complete,
    reasoning: reasoning.length > 0 ? reasoning : text.trim(),
  };
}

function truncateForDisplay(text: string): string {
  const trunc = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  let out = trunc.content;
  if (trunc.truncated) {
    out += `\n\n[Verifier output truncated: ${trunc.outputLines} of ${trunc.totalLines} lines.]`;
  }
  return out;
}

export async function verifyGoalCompletion(
  ctx: ExtensionContext,
  goal: Goal,
  signal: AbortSignal | undefined,
): Promise<GoalVerificationResult> {
  const verifierModel = resolveVerifierModel(ctx);
  if (!verifierModel) {
    return {
      error: true,
      message: "no active model available to run the verification agent",
    };
  }
  const setup = await createVerifierSession(ctx, verifierModel);
  if ("error" in setup) {
    return { error: true, message: setup.error };
  }
  return runVerifierSession(setup.session, goal, signal);
}

type VerifierModel = ReturnType<typeof resolveVerifierModel>;

async function createVerifierSession(
  ctx: ExtensionContext,
  verifierModel: VerifierModel,
): Promise<{ session: AgentSession } | { error: string }> {
  try {
    const session = await buildVerifierSession(ctx, verifierModel);
    await session.bindExtensions({});
    return { session };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function buildVerifierSession(ctx: ExtensionContext, verifierModel: VerifierModel): Promise<AgentSession> {
  const cwd = ctx.cwd;
  const agentDir = getAgentDir();
  const verifierDir = path.join(agentDir, "goal-verifiers");
  fs.mkdirSync(verifierDir, { recursive: true });

  const parentHeader = ctx.sessionManager.getHeader();
  const sessionManager = SessionManager.create(cwd, verifierDir, {
    id: randomUUID(),
    ...(parentHeader?.id ? { parentSession: parentHeader.id } : {}),
  });
  const settingsManager = SettingsManager.create(cwd, agentDir);

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    extensionFactories: getChildExtensionFactories(),
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => buildVerificationSystemPrompt(),
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  const modelRuntime = await ModelRuntime.create();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: verifierModel,
    tools: VERIFIER_TOOLS,
    resourceLoader: loader,
    sessionManager,
    settingsManager,
  });
  return session;
}

async function runVerifierSession(
  session: AgentSession,
  goal: Goal,
  signal: AbortSignal | undefined,
): Promise<GoalVerificationResult> {
  const detachAbort = attachAbort(signal, () => void session.abort());
  const unsub = subscribeTurnLimiter(session);
  try {
    return await collectVerifierOutcome(session, goal, loadGoalConfig().verifierMaxRetries);
  } catch (e) {
    return verifierFailure(e, signal);
  } finally {
    unsub();
    detachAbort();
  }
}

function attachAbort(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) return () => {};
  signal.addEventListener("abort", onAbort, { once: true });
  return () => signal.removeEventListener("abort", onAbort);
}

function subscribeTurnLimiter(session: AgentSession): () => void {
  const maxTurns = loadGoalConfig().verifierMaxTurns;
  const state = { count: 0, soft: false };
  return session.subscribe((event: AgentSessionEvent) => {
    if (event.type !== "turn_end") return;
    noteVerifierTurn(session, state, maxTurns);
  });
}

function noteVerifierTurn(session: AgentSession, state: { count: number; soft: boolean }, maxTurns: number): void {
  state.count += 1;
  if (maxTurns <= 0) return;
  applyTurnLimit(session, state, maxTurns);
}

function applyTurnLimit(session: AgentSession, state: { count: number; soft: boolean }, maxTurns: number): void {
  if (!state.soft && state.count >= maxTurns) {
    state.soft = true;
    void session.steer(
      "You have reached the investigation turn limit. Stop running new tools and give your final verdict now.",
    );
    return;
  }
  if (state.soft && state.count >= maxTurns + TURN_GRACE) {
    void session.abort();
  }
}

async function collectVerifierOutcome(
  session: AgentSession,
  goal: Goal,
  retries: number,
): Promise<GoalVerificationResult> {
  await session.prompt(buildVerificationTask(goal.objective));
  const parsed = await parseVerifierVerdict(session, retries);
  return verifierOutcome(parsed, retries);
}

async function parseVerifierVerdict(session: AgentSession, retries: number): Promise<VerdictParseResult | undefined> {
  let retriesLeft = retries;
  while (true) {
    const parsed = parseVerdict(extractAssistantText(session.messages));
    if (parsed.parsed) return parsed;
    if (retriesLeft <= 0) return undefined;
    retriesLeft -= 1;
    await session.prompt(FORMAT_NUDGE);
  }
}

function verifierOutcome(parsed: VerdictParseResult | undefined, retries: number): GoalVerificationResult {
  if (parsed?.parsed) {
    return {
      complete: parsed.complete,
      reasoning: truncateForDisplay(parsed.reasoning),
    };
  }
  return {
    error: true,
    message: `verifier did not emit a valid VERDICT line after ${retries + 1} attempt(s)`,
  };
}

function verifierFailure(e: unknown, signal: AbortSignal | undefined): GoalVerificationResult {
  if (signal?.aborted) {
    return {
      error: true,
      message: "verification aborted by parent session",
    };
  }
  return {
    error: true,
    message: e instanceof Error ? e.message : String(e),
  };
}
