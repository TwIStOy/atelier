import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtensionConfigSchema } from "@htwang-contrib/common";
import { readConfig, resolveModel, updateConfig } from "@htwang-contrib/common";
import { buildModelEntries, ModelSelectController } from "./model-selector.ts";

export interface CommitterConfig {
  model: string;
  groupingThreshold: number;
  maxDiffLength: number;
  maxDiffLengthSingle: number;
  maxGroupingRetries: number;
}

type AnyModel = Model<any>;

const CONFIG_NAME = "committer";

const CONFIG_SCHEMA: ExtensionConfigSchema<CommitterConfig> = {
  defaults: {
    model: "",
    groupingThreshold: 4,
    maxDiffLength: 12_000,
    maxDiffLengthSingle: 8_000,
    maxGroupingRetries: 3,
  },
};

export function loadConfig(): CommitterConfig {
  return readConfig(CONFIG_NAME, CONFIG_SCHEMA);
}

function saveConfig(patch: Partial<CommitterConfig>): CommitterConfig {
  return updateConfig(CONFIG_NAME, CONFIG_SCHEMA, patch);
}

function getConfiguredModel(ctx: ExtensionContext): AnyModel | undefined {
  const config = loadConfig();
  if (!config.model) return undefined;
  const models = ctx.modelRegistry.getAvailable();
  return (resolveModel(models, config.model) as AnyModel | undefined) ?? undefined;
}

export async function selectModel(ctx: ExtensionCommandContext): Promise<AnyModel | undefined> {
  const models = ctx.modelRegistry.getAvailable();
  if (models.length === 0) {
    ctx.ui.notify("No models available.", "warning");
    return undefined;
  }

  const sessionModel = ctx.model as AnyModel | undefined;
  const effectiveDefault = effectiveDefaultModel(models as AnyModel[], sessionModel);

  const modelEntries = buildModelEntries(models as AnyModel[]);
  const defaultIdx = defaultModelIndex(modelEntries, effectiveDefault);

  const result = await ModelSelectController.show(ctx, modelEntries, sessionModel, defaultIdx);
  if (result === undefined) return undefined;

  saveSelectedModel(ctx, result);
  return result;
}

function effectiveDefaultModel(models: AnyModel[], sessionModel: AnyModel | undefined): AnyModel | undefined {
  const config = loadConfig();
  const configuredModel = config.model ? (resolveModel(models, config.model) as AnyModel | undefined) : undefined;
  return configuredModel ?? sessionModel;
}

function defaultModelIndex(
  modelEntries: ReturnType<typeof buildModelEntries>,
  effectiveDefault: AnyModel | undefined,
): number {
  let defaultIdx = 0;
  if (!effectiveDefault) return defaultIdx;
  const idx = modelEntries.findIndex(
    (e) => e.model.provider === effectiveDefault.provider && e.model.id === effectiveDefault.id,
  );
  if (idx >= 0) defaultIdx = idx;
  return defaultIdx;
}

function saveSelectedModel(ctx: ExtensionCommandContext, result: AnyModel): void {
  saveConfig({ model: `${result.provider}/${result.id}` });
  ctx.ui.notify(`Commit model: ${result.provider}/${result.id}`, "info");
}

export function resolveCommitModel(ctx: ExtensionContext): AnyModel | undefined {
  const selected = getConfiguredModel(ctx);
  return selected ?? (ctx.model as AnyModel | undefined);
}
