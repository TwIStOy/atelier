import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  truncateHead,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import extraTools from "@htwang-contrib/extra-tools/index.ts";
import protectSecrets from "@htwang-contrib/protect-secrets/index.ts";
import { resolveVerifierModel, loadGoalConfig } from "./config.ts";
import type { Goal } from "./types.ts";

const VERIFIER_TOOLS = ["read", "bash", "grep", "glob", "ls"];
const VERIFIER_EXTENSION_FACTORIES: ExtensionFactory[] = [
  protectSecrets,
  extraTools,
];
const TURN_GRACE = 3;
const FORMAT_NUDGE =
  "Your previous response did not end with a valid verdict line. Based on your investigation so far, do not run more tools — respond now with a brief summary ending with exactly one line on its own: VERDICT: COMPLETE or VERDICT: INCOMPLETE.";

type VerdictParseResult =
  | { parsed: true; complete: boolean; reasoning: string }
  | { parsed: false };

export type GoalVerificationResult =
  | { complete: true; reasoning: string }
  | { complete: false; reasoning: string }
  | { error: true; message: string };

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const parts = msg.content;
    if (!Array.isArray(parts)) continue;
    const chunks: string[] = [];
    for (const part of parts as TextContent[]) {
      if (part.type === "text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
    const joined = chunks.join("").trim();
    if (joined) return joined;
  }
  return "";
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
    extensionFactories: VERIFIER_EXTENSION_FACTORIES,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => buildVerificationSystemPrompt(),
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();

  let session: AgentSession;
  try {
    const { session: created } = await createAgentSession({
      cwd,
      agentDir,
      modelRegistry: ctx.modelRegistry,
      model: verifierModel,
      tools: VERIFIER_TOOLS,
      resourceLoader: loader,
      sessionManager,
      settingsManager,
    });
    session = created;
    await created.bindExtensions({});
  } catch (e) {
    return {
      error: true,
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const onAbort = () => {
    void session.abort();
  };
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  const { verifierMaxTurns, verifierMaxRetries } = loadGoalConfig();
  const maxTurns = verifierMaxTurns;
  const limited = maxTurns > 0;

  let turnCount = 0;
  let soft = false;
  const unsub = session.subscribe((event: AgentSessionEvent) => {
    if (event.type !== "turn_end") return;
    turnCount += 1;
    if (!limited) return;
    if (!soft && turnCount >= maxTurns) {
      soft = true;
      void session.steer(
        "You have reached the investigation turn limit. Stop running new tools and give your final verdict now.",
      );
    } else if (soft && turnCount >= maxTurns + TURN_GRACE) {
      void session.abort();
    }
  });

  let outcome: GoalVerificationResult;
  try {
    await session.prompt(buildVerificationTask(goal.objective));
    let parsed: VerdictParseResult | undefined;
    let retriesLeft = verifierMaxRetries;
    while (true) {
      parsed = parseVerdict(extractAssistantText(session.messages));
      if (parsed.parsed) break;
      if (retriesLeft <= 0) {
        parsed = undefined;
        break;
      }
      retriesLeft -= 1;
      await session.prompt(FORMAT_NUDGE);
    }
    if (parsed?.parsed) {
      outcome = {
        complete: parsed.complete,
        reasoning: truncateForDisplay(parsed.reasoning),
      };
    } else {
      outcome = {
        error: true,
        message: `verifier did not emit a valid VERDICT line after ${verifierMaxRetries + 1} attempt(s)`,
      };
    }
  } catch (e) {
    if (signal?.aborted) {
      outcome = {
        error: true,
        message: "verification aborted by parent session",
      };
    } else {
      outcome = {
        error: true,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  } finally {
    unsub();
    if (signal) signal.removeEventListener("abort", onAbort);
  }
  return outcome;
}
