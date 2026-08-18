import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getGlobalState } from "./global-state.ts";
import { createLogger } from "./log.ts";

export const SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES = {
  subagents: 100,
  memory: 200,
  "inject-prompt-by-model": 300,
} as const;

export type KnownSystemPromptContributionId = keyof typeof SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES;

export type SystemPromptContributeFn = (
  event: BeforeAgentStartEvent,
  ctx: ExtensionContext,
) => string | null | undefined | Promise<string | null | undefined>;

export type SystemPromptContributionMode = "append" | "replace";

export type SystemPromptContribution = {
  id: string;
  priority: number;
  mode?: SystemPromptContributionMode;
  contribute: SystemPromptContributeFn;
};

type RegistryState = {
  contributions: Map<string, SystemPromptContribution>;
};

const STATE_KEY = "htwang-contrib.system-prompt-contributions";
const ASSEMBLER_GUARD = Symbol.for("htwang-contrib.system-prompt-assembler.installed");
const logger = createLogger("system-prompt-contributions");

function registry(): RegistryState {
  return getGlobalState(STATE_KEY, () => ({ contributions: new Map() }));
}

function expectedPriority(id: string): number | undefined {
  if (Object.hasOwn(SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES, id)) {
    return SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES[id as KnownSystemPromptContributionId];
  }
  return undefined;
}

function normalizeAppendix(result: unknown): string | undefined {
  if (typeof result !== "string") return undefined;
  return result.trim().length > 0 ? result : undefined;
}

function resolveMode(id: string, mode: SystemPromptContributionMode | undefined): SystemPromptContributionMode {
  if (mode === undefined || mode === "append" || mode === "replace") return mode ?? "append";
  throw new Error(`system prompt contribution "${id}" mode must be "append" or "replace"`);
}

export function registerSystemPromptContribution(
  pi: Pick<ExtensionAPI, "on">,
  contribution: SystemPromptContribution,
): void {
  if (contribution.id.trim().length === 0) {
    throw new Error("system prompt contribution id must be non-empty");
  }
  if (!Number.isFinite(contribution.priority)) {
    throw new Error(`system prompt contribution "${contribution.id}" priority must be a finite number`);
  }
  const expected = expectedPriority(contribution.id);
  if (expected !== undefined && expected !== contribution.priority) {
    throw new Error(
      `system prompt contribution "${contribution.id}" priority ${contribution.priority} does not match documented ${expected}`,
    );
  }
  const mode = resolveMode(contribution.id, contribution.mode);
  registry().contributions.set(contribution.id, { ...contribution, mode });
  installSystemPromptAssembler(pi);
}

export function unregisterSystemPromptContribution(id: string): void {
  registry().contributions.delete(id);
}

export function listSystemPromptContributions(): SystemPromptContribution[] {
  return [...registry().contributions.values()].sort(compareContributions);
}

export function clearSystemPromptContributions(): void {
  registry().contributions.clear();
}

export async function applySystemPromptContributions(
  event: BeforeAgentStartEvent,
  ctx: ExtensionContext,
): Promise<string | undefined> {
  let current = event.systemPrompt;
  let modified = false;
  for (const contribution of listSystemPromptContributions()) {
    try {
      const next = normalizeAppendix(await contribution.contribute({ ...event, systemPrompt: current }, ctx));
      if (next === undefined) continue;
      current = contribution.mode === "replace" ? next : [current, next].join("\n\n");
      modified = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`contribution "${contribution.id}" failed: ${message}`);
    }
  }
  return modified ? current : undefined;
}

export function installSystemPromptAssembler(pi: Pick<ExtensionAPI, "on">): void {
  const guard = pi as unknown as Record<symbol, boolean>;
  if (guard[ASSEMBLER_GUARD]) return;
  guard[ASSEMBLER_GUARD] = true;
  pi.on("before_agent_start", async (event, ctx) => {
    const systemPrompt = await applySystemPromptContributions(event, ctx);
    if (systemPrompt === undefined) return;
    return { systemPrompt };
  });
}

function compareContributions(a: SystemPromptContribution, b: SystemPromptContribution): number {
  return a.priority - b.priority || a.id.localeCompare(b.id);
}
