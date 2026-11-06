import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatNumber } from "@htwang-contrib/common/format";
import { fitColWidths, makeTable } from "@htwang-contrib/common/terminal";
import { addHiddenRule, loadConfig, removeHiddenRule } from "./config.ts";
import { isSuppressed, listAllModels, listAvailableModels, setSuppress } from "./model-patch.ts";
import { buildRuleSet, canonicalRule, describeRule, isModelHidden, parseTarget } from "./rules.ts";

const HELP_LINES = [
  "Usage: /hide-models [subcommand] [target]",
  "",
  "Subcommands:",
  "  /hide-models                      Show current rules, patch status, hidden count",
  "  /hide-models add <target>         Hide a provider or model",
  "  /hide-models remove <target>      Remove a hide rule",
  "  /hide-models reset                Unpatch at runtime — all models visible now",
  "  /hide-models help                 Show this reference",
  "",
  "Target forms:",
  "  ollama                            Hide the entire ollama provider",
  "  openrouter/*                      Hide the entire openrouter provider (explicit)",
  "  openrouter/cheap-model            Hide a specific model",
  "",
  "Editing is also available via /config -> experience (dynamic multiselect).",
  "Changes take effect immediately. `reset` is temporary — rules re-apply on reload.",
];

type AnyModel = Model<Api>;

export async function handleHideModels(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const { sub, target } = parseSubcommandArgs(args);
  await dispatchSubcommand(sub, target, ctx);
}

function parseSubcommandArgs(args: string): { sub: string; target: string } {
  const trimmed = args.trim();
  const firstSpace = trimmed.search(/\s/);
  if (firstSpace === -1) return { sub: trimmed, target: "" };
  return { sub: trimmed.slice(0, firstSpace), target: trimmed.slice(firstSpace + 1).trim() };
}

async function dispatchSubcommand(sub: string, target: string, ctx: ExtensionCommandContext): Promise<void> {
  if (sub === "") {
    await printStatus(ctx);
    return;
  }
  if (await runRuleCommand(sub, target, ctx)) return;
  if (isHelpFlag(sub)) {
    ctx.ui.notify(HELP_LINES.join("\n"), "info");
    return;
  }
  ctx.ui.notify(`Unknown subcommand "${sub}". Try: /hide-models help`, "warning");
}

async function runRuleCommand(sub: string, target: string, ctx: ExtensionCommandContext): Promise<boolean> {
  if (sub === "add") {
    await cmdAdd(target, ctx);
    return true;
  }
  if (sub === "remove") {
    await cmdRemove(target, ctx);
    return true;
  }
  if (sub === "reset") {
    await cmdReset(ctx);
    return true;
  }
  return false;
}

function isHelpFlag(sub: string): boolean {
  return sub === "help" || sub === "-h" || sub === "--help";
}

interface Snapshot {
  available: AnyModel[];
  hiddenCount: number;
}

function readSnapshot(ctx: ExtensionCommandContext): Snapshot {
  const available = listAvailableModels(ctx.modelRegistry);
  const cfg = loadConfig();
  const ruleSet = buildRuleSet(cfg.hiddenRules);
  const hiddenCount = available.filter((m) => isModelHidden(String(m.provider), String(m.id), ruleSet)).length;
  return { available, hiddenCount };
}

function patchStateLabel(): string {
  const cfg = loadConfig();
  if (!cfg.enabled) return "disabled (toggle via /config)";
  if (cfg.hiddenRules.length === 0) return "idle (no rules)";
  if (isSuppressed()) return "reset (suppressed — all models visible)";
  return "active";
}

async function printStatus(ctx: ExtensionCommandContext): Promise<void> {
  const cfg = loadConfig();
  const allCount = listAllModels(ctx.modelRegistry).length;
  const snapshot = readSnapshot(ctx);

  const lines: string[] = [];
  lines.push("Hide Models — experience");
  lines.push(`State: ${patchStateLabel()} · rules: ${cfg.hiddenRules.length} · enabled: ${cfg.enabled ? "on" : "off"}`);
  lines.push(
    `Models: ${formatNumber(snapshot.available.length)} available (of ${formatNumber(allCount)} total) · ${formatNumber(snapshot.hiddenCount)} hidden by current rules`,
  );

  if (cfg.hiddenRules.length > 0) {
    const widths = fitColWidths(2, 4, 60);
    const table = makeTable(["#", "rule", "scope"], widths);
    cfg.hiddenRules.forEach((rule, i) => {
      const parsed = parseTarget(rule);
      const scope = parsed && parsed.model == null ? "whole provider" : "single model";
      table.push([String(i + 1), describeRule(rule), scope]);
    });
    lines.push("");
    lines.push(table.toString().trimEnd());
  } else {
    lines.push("");
    lines.push("No hide rules. Use: /hide-models add <provider[/model]>");
  }
  ctx.ui.notify(lines.join("\n"), "info");
}

function targetMatchesRegistry(target: string, models: AnyModel[]): boolean {
  const parsed = parseTarget(target);
  if (!parsed) return false;
  if (parsed.model == null) {
    return models.some((m) => String(m.provider).toLowerCase() === parsed.provider);
  }
  const canonical = canonicalRule(parsed);
  return models.some((m) => {
    const modelCanonical = canonicalRule({ provider: String(m.provider), model: String(m.id) });
    return modelCanonical === canonical;
  });
}

async function cmdAdd(target: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!target) {
    ctx.ui.notify("Usage: /hide-models add <provider[/model]>", "warning");
    return;
  }
  if (!parseTarget(target)) {
    ctx.ui.notify(`Invalid target: ${target}`, "warning");
    return;
  }
  const snapshot = readSnapshot(ctx);
  const matched = targetMatchesRegistry(target, snapshot.available);
  const result = addHiddenRule(target);
  if (!result.canonical) {
    ctx.ui.notify(`Invalid target: ${target}`, "warning");
    return;
  }
  setSuppress(false);
  notifyAddResult(result.changed, result.canonical, matched, ctx);
}

function notifyAddResult(changed: boolean, canonical: string, matched: boolean, ctx: ExtensionCommandContext): void {
  if (!changed) {
    ctx.ui.notify(`Already hidden: ${describeRule(canonical)}`, "info");
    return;
  }
  const note = matched ? "" : "  (no matching model right now — added anyway)";
  ctx.ui.notify(`Hidden ${describeRule(canonical)}.${note}`, "info");
}

async function cmdRemove(target: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!target) {
    ctx.ui.notify("Usage: /hide-models remove <provider[/model]>", "warning");
    return;
  }
  const result = removeHiddenRule(target);
  if (!result.canonical) {
    ctx.ui.notify(`Invalid target: ${target}`, "warning");
    return;
  }
  setSuppress(false);
  if (result.changed) {
    ctx.ui.notify(`Removed rule: ${describeRule(result.canonical)}`, "info");
  } else {
    ctx.ui.notify(`No such rule: ${describeRule(result.canonical)}`, "info");
  }
}

async function cmdReset(ctx: ExtensionCommandContext): Promise<void> {
  void ctx;
  setSuppress(true);
  ctx.ui.notify(
    "Registry unpatched at runtime — all models visible now. Rules are preserved and re-apply on reload or the next add/remove.",
    "info",
  );
}
