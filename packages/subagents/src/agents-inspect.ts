import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  type AgentPersonaEntry,
  type AgentPersonaFileOptions,
  loadSubagentModelConfig,
  resolveChildToolNames,
  resolveModel,
  resolveSubagentModelPattern,
  type SubagentModelConfig,
} from "@htwang-contrib/common";
import { buildSubagentAgentCatalog, type SubagentAgentCatalog } from "./agent-catalog.ts";
import { defaultsForAgentType, readSubagentSettings, type SubagentSettings } from "./settings.ts";

function parentModelLine(ctx: ExtensionContext, reason: string): string {
  const m = ctx.model;
  if (!m) return "(parent session has no model)";
  const prov = m.provider ?? "?";
  return `${m.name} (${prov}/${m.id}) — ${reason}parent session model`;
}

function unresolvedPatternLine(ctx: ExtensionContext, pattern: string): string {
  const m = ctx.model;
  if (!m) return `pattern "${pattern}" did not match registry; parent has no model`;
  const prov = m.provider ?? "?";
  return `${m.name} (${prov}/${m.id}) — pattern "${pattern}" unresolved, parent fallback`;
}

function unsetTierReason(rawPattern: string | undefined): string {
  return rawPattern?.trim() ? `tier "${rawPattern.trim()}" is unset; ` : "";
}

function formatResolvedModel(
  rawPattern: string | undefined,
  tiers: SubagentModelConfig["modelTiers"],
  ctx: ExtensionContext,
): string {
  const pattern = resolveSubagentModelPattern(rawPattern, tiers);
  if (!pattern) return parentModelLine(ctx, unsetTierReason(rawPattern));
  const found = resolveModel(ctx.modelRegistry.getAvailable(), pattern);
  if (found) {
    const prov = found.provider ?? "?";
    return `${found.name} (${prov}/${found.id}) — resolved pattern "${pattern}"`;
  }
  return unresolvedPatternLine(ctx, pattern);
}

function trimmedOrEmpty(v: string | undefined): string {
  return v?.trim() ?? "";
}

function inspectFileFields(file: AgentPersonaFileOptions): {
  isolated: boolean;
  inherit: boolean;
  maxTurns: number | undefined;
  desc: string;
  whenToUse: string;
} {
  return {
    isolated: file.isolated ?? true,
    inherit: file.inherit_context ?? false,
    maxTurns: file.max_turns,
    desc: trimmedOrEmpty(file.description),
    whenToUse: trimmedOrEmpty(file.whenToUse),
  };
}

function inspectHeaderLines(
  agentId: string,
  entry: AgentPersonaEntry | undefined,
  desc: string,
  whenToUse: string,
): string[] {
  return [
    `id: ${agentId}`,
    `source file: ${entry?.sourcePath ?? "(unknown)"}`,
    "",
    `frontmatter description (truncated in catalog to 72 chars): ${desc || "(none)"}`,
    `frontmatter whenToUse (truncated in catalog to 2000 chars): ${whenToUse || "(none)"}`,
  ];
}

function inspectDefaultsLines(
  rawModel: string | undefined,
  rawThinking: string | undefined,
  isolated: boolean,
  inherit: boolean,
  maxTurns: number | undefined,
  modelConfig: SubagentModelConfig,
  ctx: ExtensionContext,
): string[] {
  return [
    "Effective defaults when the subagent tool omits model, thinking, inherit_context, isolated, and max_turns (model: /config agentModels override, then persona frontmatter, then defaults_by_agent_type in ~/.agent/subagents/settings.json, then parent session; other fields use persona frontmatter then defaults):",
    `  model or tier before resolve: ${rawModel || "(current session model)"}`,
    `  resolved model: ${formatResolvedModel(rawModel, modelConfig.modelTiers, ctx)}`,
    `  thinking: ${rawThinking ?? "(omit → Pi child session default)"}`,
    `  isolated: ${isolated}`,
    `  inherit_context: ${inherit}`,
    `  max_turns: ${maxTurns ?? "(omit → unlimited with soft stop + grace)"}`,
  ];
}

function fmToolsDisplayOf(fmTools: string[] | undefined): string {
  return fmTools && fmTools.length > 0 ? fmTools.join(", ") : "(omit → default list for isolation mode)";
}

function inspectToolsLines(fmTools: string[] | undefined, isolated: boolean): string[] {
  const toolsEffective = resolveChildToolNames(isolated, fmTools).join(", ");
  return [
    `frontmatter tools (subset of Pi defaults for this isolation mode; unknown names omitted): ${fmToolsDisplayOf(fmTools)}`,
    `effective child tools (${isolated ? "isolated" : "non-isolated"}): ${toolsEffective}`,
  ];
}

export function formatSubagentAgentInspect(
  agentId: string,
  catalog: SubagentAgentCatalog,
  settings: SubagentSettings,
  ctx: ExtensionContext,
): string {
  const entry = catalog.agents.get(agentId);
  const file = entry?.fileOptions ?? {};
  const defs = defaultsForAgentType(settings, agentId);
  const modelConfig = loadSubagentModelConfig();
  const rawModel = modelConfig.agentModels[agentId] ?? file.model ?? defs.model;
  const rawThinking = file.thinking ?? defs.thinking;
  const { isolated, inherit, maxTurns, desc, whenToUse } = inspectFileFields(file);

  const lines: string[] = [
    ...inspectHeaderLines(agentId, entry, desc, whenToUse),
    "",
    ...inspectDefaultsLines(rawModel, rawThinking, isolated, inherit, maxTurns, modelConfig, ctx),
    "",
    ...inspectToolsLines(file.tools, isolated),
    "",
    "Child session: DefaultResourceLoader uses noExtensions: true, noSkills, noPromptTemplates, noThemes, noContextFiles; extensionFactories come from the shared child-extension registry (extensions loaded in the main session self-register via registerChildExtensionFactory).",
    "",
    "Batch mode: per-task tool fields override the same keys for that row only (model: task > batch tool args > /config agentModels > persona > defaults_by_agent_type).",
  ];
  return lines.join("\n");
}

function validIndex(picked: number, labels: string[]): number | null {
  if (!Number.isFinite(picked) || picked < 0 || picked >= labels.length) return null;
  return picked;
}

function pickIndex(picked: string | number, labels: string[]): number | null {
  if (typeof picked === "number") return validIndex(picked, labels);
  const s = String(picked);
  if (s === "← Close") return null;
  const i = labels.indexOf(s);
  return i >= 0 ? i : null;
}

type AgentPick = { kind: "again" } | { kind: "close" } | { kind: "view"; index: number };

async function pickAgent(ctx: ExtensionContext, labels: string[]): Promise<AgentPick> {
  const picked = await ctx.ui.select("Subagents — choose an agent", labels);
  if (picked === undefined) return { kind: "close" };
  const idx = pickIndex(picked, labels);
  if (idx === null) return { kind: "again" };
  if (idx === labels.length - 1) return { kind: "close" };
  return { kind: "view", index: idx };
}

function agentLabel(catalog: SubagentAgentCatalog, id: string): string {
  const d = catalog.agents.get(id)?.fileOptions.description?.trim() ?? "";
  const short = d.length > 48 ? `${d.slice(0, 45)}…` : d;
  return short ? `${id} — ${short}` : id;
}

function agentLabels(catalog: SubagentAgentCatalog, ids: string[]): string[] {
  const labels = ids.map((id) => agentLabel(catalog, id));
  labels.push("← Close");
  return labels;
}

async function viewOneAgent(ctx: ExtensionContext): Promise<boolean> {
  const catalog = buildSubagentAgentCatalog(ctx.cwd);
  const settings = readSubagentSettings();
  const ids = [...catalog.agents.keys()].sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) {
    ctx.ui.notify("No agents in catalog.", "info");
    return false;
  }
  const pick = await pickAgent(ctx, agentLabels(catalog, ids));
  const id = pick.kind === "view" ? ids[pick.index] : undefined;
  if (id) {
    await ctx.ui.editor(`Subagent: ${id}`, formatSubagentAgentInspect(id, catalog, settings, ctx));
  }
  return pick.kind !== "close";
}

export async function runSubagentsAgentsCommand(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("subagents-agents requires the Pi TUI.", "warning");
    return;
  }
  while (await viewOneAgent(ctx)) {
    // keep picking agents until the picker is closed
  }
}
