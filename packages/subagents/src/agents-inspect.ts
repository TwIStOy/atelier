import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveChildToolNames, resolveModel } from "@htwang-contrib/common";
import { buildSubagentAgentCatalog, type SubagentAgentCatalog } from "./agent-catalog.ts";
import { defaultsForAgentType, readSubagentSettings, type SubagentSettings } from "./settings.ts";

function formatResolvedModel(rawPattern: string | undefined, ctx: ExtensionContext): string {
  const pattern = rawPattern?.trim();
  if (!pattern) {
    const m = ctx.model;
    if (!m) return "(parent session has no model)";
    const prov = m.provider ?? "?";
    return `${m.name} (${prov}/${m.id}) — parent session model`;
  }
  const found = resolveModel(ctx.modelRegistry.getAvailable(), pattern);
  if (found) {
    const prov = found.provider ?? "?";
    return `${found.name} (${prov}/${found.id}) — resolved pattern "${pattern}"`;
  }
  const m = ctx.model;
  if (!m) return `pattern "${pattern}" did not match registry; parent has no model`;
  const prov = m.provider ?? "?";
  return `${m.name} (${prov}/${m.id}) — pattern "${pattern}" unresolved, parent fallback`;
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
  const rawModel = file.model ?? defs.model;
  const rawThinking = file.thinking ?? defs.thinking;
  const isolated = file.isolated ?? true;
  const inherit = file.inherit_context ?? false;
  const maxTurns = file.max_turns;
  const desc = file.description?.trim() ?? "";
  const whenToUse = file.whenToUse?.trim() ?? "";

  const fmTools = file.tools;
  const fmToolsDisplay =
    fmTools && fmTools.length > 0 ? fmTools.join(", ") : "(omit → default list for isolation mode)";
  const toolsEffective = resolveChildToolNames(isolated, fmTools).join(", ");

  const lines: string[] = [
    `id: ${agentId}`,
    `source file: ${entry?.sourcePath ?? "(unknown)"}`,
    "",
    `frontmatter description (truncated in catalog to 72 chars): ${desc || "(none)"}`,
    `frontmatter whenToUse (truncated in catalog to 2000 chars): ${whenToUse || "(none)"}`,
    "",
    "Effective defaults when the subagent tool omits model, thinking, inherit_context, isolated, and max_turns (persona frontmatter, then defaults_by_agent_type in ~/.agent/subagents/settings.json, then fallbacks):",
    `  model pattern before resolve: ${rawModel ?? "(omit → parent session model)"}`,
    `  resolved model: ${formatResolvedModel(rawModel, ctx)}`,
    `  thinking: ${rawThinking ?? "(omit → Pi child session default)"}`,
    `  isolated: ${isolated}`,
    `  inherit_context: ${inherit}`,
    `  max_turns: ${maxTurns ?? "(omit → unlimited with soft stop + grace)"}`,
    "",
    `frontmatter tools (subset of Pi defaults for this isolation mode; unknown names omitted): ${fmToolsDisplay}`,
    `effective child tools (${isolated ? "isolated" : "non-isolated"}): ${toolsEffective}`,
    "",
    "Child session: DefaultResourceLoader uses noExtensions: true, noSkills, noPromptTemplates, noThemes, noContextFiles; extensionFactories come from the shared child-extension registry (extensions loaded in the main session self-register via registerChildExtensionFactory).",
    "",
    "Batch mode: per-task tool fields override the same keys for that row only (task > batch tool args > persona > defaults_by_agent_type).",
  ];
  return lines.join("\n");
}

function pickIndex(picked: string | number, labels: string[]): number | null {
  if (typeof picked === "number") {
    if (!Number.isFinite(picked) || picked < 0 || picked >= labels.length) return null;
    return picked;
  }
  const s = String(picked);
  if (s === "← Close") return null;
  const i = labels.indexOf(s);
  return i >= 0 ? i : null;
}

export async function runSubagentsAgentsCommand(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("subagents-agents requires the Pi TUI.", "warning");
    return;
  }
  while (true) {
    const catalog = buildSubagentAgentCatalog(ctx.cwd);
    const settings = readSubagentSettings();
    const ids = [...catalog.agents.keys()].sort((a, b) => a.localeCompare(b));
    if (ids.length === 0) {
      ctx.ui.notify("No agents in catalog.", "info");
      return;
    }
    const labels = ids.map((id) => {
      const d = catalog.agents.get(id)?.fileOptions.description?.trim() ?? "";
      const short = d.length > 48 ? `${d.slice(0, 45)}…` : d;
      return short ? `${id} — ${short}` : id;
    });
    labels.push("← Close");
    const picked = await ctx.ui.select("Subagents — choose an agent", labels);
    if (picked === undefined) return;
    const idx = pickIndex(picked, labels);
    if (idx === null) continue;
    if (idx === labels.length - 1) return;
    const id = ids[idx];
    if (!id) continue;
    const body = formatSubagentAgentInspect(id, catalog, settings, ctx);
    await ctx.ui.editor(`Subagent: ${id}`, body);
  }
}
