import { BashProgram } from "../../access-intent/bash/program.ts";
import type { PathNormalizer } from "../../path-normalizer.ts";
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
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface PipelineDeps {
  resolver: ScopedPermissionResolver;
  normalizer: PathNormalizer;
  /** UI to prompt on `ask`. `null` means headless — ask resolves to deny. */
  ui: PipelineUI | null;
  /** Whether dialog-capable UI is available (ctx.hasUI). Default true. */
  hasUI?: boolean;
}

export type PipelineResult = { block: true; reason: string } | undefined;

const CONFIRM_TITLE = "Permission required";

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
  return dispatch(decision, ui, hasUI);
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
async function dispatch(result: GateResult, ui: PipelineUI | null, hasUI: boolean): Promise<PipelineResult> {
  if (result.state === "allow") return undefined;
  if (result.state === "deny") {
    const reason = result.reason ?? `denied by permission rule`;
    ui?.notify(reason, "warning");
    return { block: true, reason };
  }
  // ask — headless fail closed; never silently allow.
  if (!hasUI || !ui) {
    return { block: true, reason: reasonFor(result, "requires confirmation (headless mode denies)") };
  }
  const message = describeForPrompt(result);
  const accepted = await ui.confirm(CONFIRM_TITLE, message);
  if (accepted) return undefined;
  return { block: true, reason: reasonFor(result, "user declined the permission prompt") };
}

function reasonFor(result: GateResult, fallback: string): string {
  return result.reason ?? describeForPrompt(result) ?? fallback;
}

function describeForPrompt(result: GateResult): string {
  switch (result.trigger.kind) {
    case "path":
      return `${result.action} on ${result.trigger.display}`;
    case "command":
      return `${result.action}: ${result.trigger.command}`;
    case "none":
      return `${result.action} (no specific path or command)`;
  }
}
