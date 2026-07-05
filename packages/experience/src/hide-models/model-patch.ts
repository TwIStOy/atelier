import type { Api, Model } from "@earendil-works/pi-ai";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { ConfigItemSelectOption } from "@htwang-contrib/common";
import { loadConfig } from "./config.ts";
import { buildRuleSet, isModelHidden } from "./rules.ts";

type ModelArray = Model<Api>[];
type RegistryMethod = (this: ModelRegistry) => ModelArray;

interface StoredOriginals {
  getAll: RegistryMethod;
  getAvailable: RegistryMethod;
}

const ORIGINALS: unique symbol = Symbol.for("experience.modelRegistry.originals");

type PatchedPrototype = {
  getAll: RegistryMethod;
  getAvailable: RegistryMethod;
} & Record<symbol, unknown>;

let suppress = false;
let capturedRegistry: ModelRegistry | null = null;

export function setSuppress(value: boolean): void {
  suppress = value;
}

export function isSuppressed(): boolean {
  return suppress;
}

export function captureRegistry(registry: ModelRegistry): void {
  capturedRegistry = registry;
}

export function getCapturedRegistry(): ModelRegistry | null {
  return capturedRegistry;
}

function getPrototype(): PatchedPrototype {
  return ModelRegistry.prototype as unknown as PatchedPrototype;
}

function getStoredOriginals(): StoredOriginals | undefined {
  return getPrototype()[ORIGINALS] as StoredOriginals | undefined;
}

function callOriginal(registry: ModelRegistry, key: "getAll" | "getAvailable"): ModelArray {
  const stored = getStoredOriginals();
  const fn = stored ? stored[key] : getPrototype()[key];
  return fn.call(registry);
}

function filterModels(models: ModelArray): ModelArray {
  const cfg = loadConfig();
  if (!cfg.enabled || cfg.hiddenRules.length === 0) return models;
  const ruleSet = buildRuleSet(cfg.hiddenRules);
  return models.filter((m) => !isModelHidden(String(m.provider), String(m.id), ruleSet));
}

export function installPatch(): void {
  const proto = getPrototype();
  if (getStoredOriginals()) return;
  const originals: StoredOriginals = {
    getAll: proto.getAll,
    getAvailable: proto.getAvailable,
  };
  proto[ORIGINALS] = originals;
  proto.getAvailable = function (this: ModelRegistry): ModelArray {
    const original = callOriginal(this, "getAvailable");
    return suppress ? original : filterModels(original);
  };
  proto.getAll = function (this: ModelRegistry): ModelArray {
    const original = callOriginal(this, "getAll");
    return suppress ? original : filterModels(original);
  };
}

export function listAllModels(registry: ModelRegistry): ModelArray {
  return callOriginal(registry, "getAll");
}

export function listAvailableModels(registry: ModelRegistry): ModelArray {
  return callOriginal(registry, "getAvailable");
}

export function buildHideRuleOptions(): ConfigItemSelectOption<string>[] {
  const registry = capturedRegistry;
  if (!registry) return [];
  const models = listAvailableModels(registry);
  const byProvider = new Map<string, Model<Api>[]>();
  for (const m of models) {
    const provider = String(m.provider);
    const list = byProvider.get(provider);
    if (list) list.push(m);
    else byProvider.set(provider, [m]);
  }
  const options: ConfigItemSelectOption<string>[] = [];
  for (const [provider, list] of byProvider) {
    const count = list.length;
    options.push({
      label: `${provider}/*  (whole provider · ${count} model${count === 1 ? "" : "s"})`,
      value: provider,
    });
    for (const m of list) {
      options.push({ label: `  ${provider}/${m.id} — ${m.name}`, value: `${provider}/${m.id}` });
    }
  }
  return options;
}
