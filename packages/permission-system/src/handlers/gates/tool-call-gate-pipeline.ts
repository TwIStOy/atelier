import { BashProgram } from "../../access-intent/bash/program.ts";
import type { DecisionLogger } from "../../decision-log.ts";
import type { PathNormalizer } from "../../path-normalizer.ts";
import { approvalKeyFromTrigger, type SessionApprovalStore } from "../../session-approval.ts";
import type {
  AccessIntent,
  GateResult,
  PermissionCheckResult,
  PermissionState,
  ScopedPermissionResolver,
  ToolCallContext,
} from "../../types.ts";
import { resolveBashCommandCheck } from "./bash-command.ts";
import { describeBashExternalDirectoryGate } from "./bash-external-directory.ts";
import { describeBashPathGate } from "./bash-path.ts";
import { describeExternalDirectoryGate } from "./external-directory.ts";
import { describePathGate } from "./path.ts";
import { describeToolGate } from "./tool.ts";

/** What the pipeline hands to a caller that can show a UI. */
export interface PipelineUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface PipelineDeps {
  resolver: ScopedPermissionResolver;
  normalizer: PathNormalizer;
  /** UI to prompt on `ask`. `null` means headless — ask resolves to deny. */
  ui: PipelineUI | null;
  /** Whether dialog-capable UI is available (ctx.hasUI). Default true. */
  hasUI?: boolean;
  /** Per-session store of approvals the user chose to remember. */
  approvals?: SessionApprovalStore;
  /** Optional JSONL audit logger for every decision. */
  logger?: DecisionLogger;
}

export type PipelineResult = { block: true; reason: string } | undefined;

const ALLOW_ONCE = "Allow once";
const ALLOW_SESSION = "Allow always (session)";
const DENY_CHOICE = "Deny";
const CHOICES = [ALLOW_ONCE, ALLOW_SESSION, DENY_CHOICE];

/** A compact config snippet that would make this call `allow` permanently.
 * Shown in the prompt so the user knows how to stop being asked. The bash
 * pattern is `prefix *` so it matches the same family of subcommands the
 * session approval would (e.g. `npm test *` covers `npm test --verbose`). */
function configHint(result: GateResult): string {
  switch (result.trigger.kind) {
    case "command": {
      const p = result.trigger.prefix ?? result.trigger.command;
      const pattern = p === result.trigger.command ? p : `${p} *`;
      return `bash: { "${pattern}": "allow" }`;
    }
    case "path":
      return `${result.trigger.surface}: { "${result.trigger.display}": "allow" }`;
    case "none":
      return `${result.trigger.toolName}: "allow"`;
  }
}

const RESTRICTIVENESS: Record<PermissionState, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

/**
 * Compose the five gates into a single pre-execution decision and translate it
 * into a pi `tool_call` return value (`{ block: true; reason } | undefined`).
 *
 * The gates are evaluated in order, but the **decision is aggregated**: the
 * most restrictive result across all gates wins (deny > ask > allow), so a
 * single confirmation covers the whole operation. This avoids prompting twice
 * for the same call (e.g. an external-directory `ask` and a tool `ask`).
 *
 * Gate order (most specific first; the order only matters for tie-breaking the
 * prompt message, never for correctness — deny always wins):
 *  1. path                 — cross-cutting path surface on path-bearing tools
 *  2. external_directory   — working-directory boundary on path-bearing tools
 *  3. bash-path            — cross-cutting path surface on bash path tokens
 *  4. bash-external_directory — working-directory boundary on bash tokens
 *  5. tool                 — per-tool / bash-command surface
 *
 * For bash the command is parsed **once** via `BashProgram.parse` and the
 * resulting program is shared by gates 3–5. The aggregated result is then:
 * `allow`/no-result → proceed; `deny` → block; `ask` → prompt (headless fails
 * closed, an interactive `false` answer blocks).
 */
export async function runGatePipeline(tcc: ToolCallContext, deps: PipelineDeps): Promise<PipelineResult> {
  const { resolver, normalizer, ui } = deps;
  const hasUI = deps.hasUI ?? true;

  const bashProgram = await maybeParseBash(tcc, normalizer);

  const results: GateResult[] = [];
  pushNonNull(results, describePathGate(tcc, resolver, normalizer));
  pushNonNull(results, describeExternalDirectoryGate(tcc, [], resolver, normalizer));
  pushNonNull(results, describeBashPathGate(tcc, bashProgram, resolver));
  pushNonNull(results, describeBashExternalDirectoryGate(tcc, bashProgram, resolver));

  const toolCheck = resolveToolCheck(tcc, bashProgram, resolver);
  results.push(describeToolGate(tcc, toolCheck));

  const decision = mostRestrictive(results);
  return dispatch(decision, tcc.toolName, deps.approvals, deps.logger, ui, hasUI);
}

function pushNonNull(out: GateResult[], result: GateResult | null): void {
  if (result) out.push(result);
}

/** Most restrictive result (deny > ask > allow); first-wins on ties. */
function mostRestrictive(results: readonly GateResult[]): GateResult {
  let worst = results[0]!;
  for (let i = 1; i < results.length; i++) {
    const candidate = results[i]!;
    if (RESTRICTIVENESS[candidate.state] > RESTRICTIVENESS[worst.state]) worst = candidate;
  }
  return worst;
}

async function maybeParseBash(tcc: ToolCallContext, normalizer: PathNormalizer): Promise<BashProgram | null> {
  if (tcc.toolName !== "bash") return null;
  const command = readBashCommand(tcc);
  if (!command) return null;
  return BashProgram.parse(command, normalizer);
}

function readBashCommand(tcc: ToolCallContext): string | null {
  const record = tcc.input as { command?: unknown };
  return typeof record.command === "string" && record.command.length > 0 ? record.command : null;
}

/** Resolve the per-tool surface check the final gate wraps. */
function resolveToolCheck(
  tcc: ToolCallContext,
  bashProgram: BashProgram | null,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  if (tcc.toolName === "bash") {
    const command = readBashCommand(tcc);
    const commands = bashProgram?.commands() ?? [];
    return resolveBashCommandCheck(command ?? "", commands, tcc.agentName ?? undefined, resolver);
  }
  return resolver.resolve(toolIntent(tcc));
}

function toolIntent(tcc: ToolCallContext): AccessIntent {
  return {
    kind: "tool",
    surface: tcc.toolName,
    input: tcc.input,
    agentName: tcc.agentName ?? undefined,
  };
}

/** Translate the aggregated gate decision into a pipeline return value. */
async function dispatch(
  result: GateResult,
  toolName: string,
  approvals: SessionApprovalStore | undefined,
  logger: DecisionLogger | undefined,
  ui: PipelineUI | null,
  hasUI: boolean,
): Promise<PipelineResult> {
  const trigger = approvalKeyFromTrigger(result.trigger);
  const base = { tool: toolName, action: result.action, trigger };

  if (result.state === "allow") {
    logger?.record({ ...base, decision: "allow" });
    return undefined;
  }
  if (result.state === "deny") {
    const reason = result.reason ?? `denied by permission rule`;
    logger?.record({ ...base, decision: "deny", reason });
    ui?.notify(reason, "warning");
    return { block: true, reason };
  }
  // ask — headless fail closed; never silently allow.
  if (!hasUI || !ui) {
    const reason = reasonFor(result, toolName, "requires confirmation (headless mode denies)");
    logger?.record({ ...base, decision: "ask-headless-denied", reason });
    return { block: true, reason };
  }
  // A remembered approval covers this call without a prompt.
  const key = approvalKeyFromTrigger(result.trigger);
  if (approvals?.has(key)) {
    logger?.record({ ...base, decision: "allow" });
    return undefined;
  }

  const choice = await ui.select(
    `${describeForPrompt(result, toolName)} — allow? (permanent: ${configHint(result)})`,
    CHOICES,
  );
  if (choice === ALLOW_ONCE) {
    logger?.record({ ...base, decision: "ask-allowed" });
    return undefined;
  }
  if (choice === ALLOW_SESSION) {
    approvals?.remember(key);
    logger?.record({ ...base, decision: "ask-allowed" });
    return undefined;
  }
  // Deny or dismissed (undefined) — headless select returns undefined too.
  const reason = reasonFor(result, toolName, "user declined the permission prompt");
  logger?.record({ ...base, decision: "ask-denied", reason });
  return { block: true, reason };
}

function reasonFor(result: GateResult, toolName: string, fallback: string): string {
  return result.reason ?? describeForPrompt(result, toolName) ?? fallback;
}

/** Build the one-line confirmation message. Always leads with the tool name,
 * the clearest signal of what the user is approving (a `memory-read` is not
 * the same as a built-in `read`). */
function describeForPrompt(result: GateResult, toolName: string): string {
  switch (result.trigger.kind) {
    case "path":
      return `${toolName}: ${result.trigger.display}`;
    case "command":
      return `${toolName}: ${result.trigger.command}`;
    case "none":
      return toolName;
  }
}
