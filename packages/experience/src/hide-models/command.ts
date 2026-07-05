import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { fitColWidths, formatNumber, makeTable } from "@htwang-contrib/common";
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
  const trimmed = args.trim();
  const firstSpace = trimmed.search(/\s/);
  const sub = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const target = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

  switch (sub) {
    case "":
      await printStatus(ctx);
      return;
    case "add":
      await cmdAdd(target, ctx);
      return;
    case "remove":
      await cmdRemove(target, ctx);
      return;
    case "reset":
      await cmdReset(ctx);
      return;
    case "help":
    case "-h":
    case "--help":
      ctx.ui.notify(HELP_LINES.join("\n"), "info");
      return;
    default:
      ctx.ui.notify(`Unknown subcommand "${sub}". Try: /hide-models help`, "warning");
  }
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
  const parsed = parseTarget(target);
  if (!parsed) {
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
  if (result.changed) {
    const note = matched ? "" : "  (no matching model right now — added anyway)";
    ctx.ui.notify(`Hidden ${describeRule(result.canonical)}.${note}`, "info");
  } else {
    ctx.ui.notify(`Already hidden: ${describeRule(result.canonical)}`, "info");
  }
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
