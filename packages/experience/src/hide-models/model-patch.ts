import type { Api, Model } from "@earendil-works/pi-ai";
import { type ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ConfigItemSelectOption } from "@htwang-contrib/common";
import { loadConfig } from "./config.ts";
import { buildRuleSet, isModelHidden } from "./rules.ts";

type ModelArray = Model<Api>[];

type SnapshotMethod = (this: ModelRuntime) => readonly Model<Api>[];
type AvailableMethod = (
  this: ModelRuntime,
  ...args: Parameters<ModelRuntime["getAvailable"]>
) => Promise<readonly Model<Api>[]>;

interface StoredOriginals {
  getAvailableSnapshot: SnapshotMethod;
  getAvailable: AvailableMethod;
}

const ORIGINALS: unique symbol = Symbol.for("experience.modelRuntime.originals");
const SUPPRESS: unique symbol = Symbol.for("experience.modelRuntime.suppress");

type PatchedPrototype = {
  getAvailableSnapshot: SnapshotMethod;
  getAvailable: AvailableMethod;
} & Record<symbol, unknown>;

// ModelRegistry is a per-extension compatibility facade; its `runtime` field is
// private in the .d.ts but is the live ModelRuntime every host surface reads.
type RegistryFacade = { runtime: ModelRuntime };

let capturedRuntime: ModelRuntime | null = null;

function getPrototype(): PatchedPrototype {
  return ModelRuntime.prototype as unknown as PatchedPrototype;
}

function getStoredOriginals(): StoredOriginals | undefined {
  return getPrototype()[ORIGINALS] as StoredOriginals | undefined;
}

export function setSuppress(value: boolean): void {
  getPrototype()[SUPPRESS] = value;
}

export function isSuppressed(): boolean {
  return getPrototype()[SUPPRESS] === true;
}

export function captureRegistry(registry: ModelRegistry): void {
  capturedRuntime = (registry as unknown as RegistryFacade).runtime;
}

function callSnapshotOriginal(runtime: ModelRuntime): ModelArray {
  const stored = getStoredOriginals();
  const fn = stored ? stored.getAvailableSnapshot : getPrototype().getAvailableSnapshot;
  return [...fn.call(runtime)];
}

function filterModels(models: readonly Model<Api>[]): ModelArray {
  const cfg = loadConfig();
  if (!cfg.enabled || cfg.hiddenRules.length === 0) return [...models];
  const ruleSet = buildRuleSet(cfg.hiddenRules);
  return models.filter((m) => !isModelHidden(String(m.provider), String(m.id), ruleSet));
}

export function installPatch(): void {
  const proto = getPrototype();
  if (getStoredOriginals()) return;
  if (typeof proto.getAvailableSnapshot !== "function" || typeof proto.getAvailable !== "function") {
    throw new Error(
      "experience/hide-models: ModelRuntime no longer exposes getAvailableSnapshot/getAvailable — pi internals changed, the patch needs a review",
    );
  }
  const originals: StoredOriginals = {
    getAvailableSnapshot: proto.getAvailableSnapshot,
    getAvailable: proto.getAvailable,
  };
  proto[ORIGINALS] = originals;
  proto[SUPPRESS] = false;
  proto.getAvailableSnapshot = function (this: ModelRuntime): ModelArray {
    const models = originals.getAvailableSnapshot.call(this);
    return isSuppressed() ? [...models] : filterModels(models);
  };
  proto.getAvailable = async function (this: ModelRuntime, ...args: Parameters<AvailableMethod>): Promise<ModelArray> {
    const models = await originals.getAvailable.apply(this, args);
    return isSuppressed() ? [...models] : filterModels(models);
  };
}

export function listAllModels(registry: ModelRegistry): ModelArray {
  return registry.getAll();
}

export function listAvailableModels(registry: ModelRegistry): ModelArray {
  return callSnapshotOriginal((registry as unknown as RegistryFacade).runtime);
}

export function buildHideRuleOptions(): ConfigItemSelectOption<string>[] {
  const runtime = capturedRuntime;
  if (!runtime) return [];
  const models = callSnapshotOriginal(runtime);
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
