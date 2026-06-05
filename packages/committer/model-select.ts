import type {
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { resolveModel, readConfig, updateConfig } from "@htwang-contrib/common";
import type { ExtensionConfigSchema } from "@htwang-contrib/common";
import {
  ModelSelectController,
  buildModelEntries,
  buildUseCurrentEntry,
  SPECIAL_USE_CURRENT,
} from "./model-selector.ts";

type AnyModel = Model<any>;

export interface CommitterConfig {
  model: string;
}

const CONFIG_NAME = "committer";

const CONFIG_SCHEMA: ExtensionConfigSchema<CommitterConfig> = {
  defaults: {
    model: "",
  },
};

function loadConfig(): CommitterConfig {
  return readConfig(CONFIG_NAME, CONFIG_SCHEMA);
}

function saveConfig(patch: Partial<CommitterConfig>): CommitterConfig {
  return updateConfig(CONFIG_NAME, CONFIG_SCHEMA, patch);
}

export function getConfiguredModel(
  ctx: ExtensionContext,
): AnyModel | undefined {
  const config = loadConfig();
  if (!config.model) return undefined;
  const models = ctx.modelRegistry.getAvailable();
  return (
    (resolveModel(models, config.model) as AnyModel | undefined) ?? undefined
  );
}

export async function selectModel(
  ctx: ExtensionCommandContext,
): Promise<AnyModel | undefined> {
  const models = ctx.modelRegistry.getAvailable();
  if (models.length === 0) {
    ctx.ui.notify("No models available.", "warning");
    return undefined;
  }

  const current = ctx.model;
  const useCurrentEntry = buildUseCurrentEntry(current as AnyModel | undefined);
  const modelEntries = buildModelEntries(models as AnyModel[]);

  const entries = useCurrentEntry
    ? [useCurrentEntry, ...modelEntries]
    : modelEntries;

  const result = await ModelSelectController.show(
    ctx,
    entries,
    current as AnyModel | undefined,
  );

  if (result === undefined) return undefined;

  if (result === SPECIAL_USE_CURRENT) {
    saveConfig({ model: "" });
    ctx.ui.notify("Commit model: using current session model", "info");
    return undefined;
  }

  const model = result;
  if (model) {
    saveConfig({ model: `${model.provider}/${model.id}` });
    ctx.ui.notify(`Commit model: ${model.provider}/${model.id}`, "info");
  }
  return model;
}

export function resolveCommitModel(
  ctx: ExtensionContext,
): AnyModel | undefined {
  const selected = getConfiguredModel(ctx);
  return selected ?? (ctx.model as AnyModel | undefined);
}
