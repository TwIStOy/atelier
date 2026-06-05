import type {
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { resolveModel, readConfig, updateConfig } from "@htwang-contrib/common";
import type { ExtensionConfigSchema } from "@htwang-contrib/common";
import { ModelSelectController, buildModelEntries } from "./model-selector.ts";

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

  const sessionModel = ctx.model as AnyModel | undefined;
  const config = loadConfig();
  const configuredModel = config.model
    ? (resolveModel(models, config.model) as AnyModel | undefined)
    : undefined;
  const effectiveDefault = configuredModel ?? sessionModel;

  const modelEntries = buildModelEntries(models as AnyModel[]);

  let defaultIdx = 0;
  if (effectiveDefault) {
    const idx = modelEntries.findIndex(
      (e) =>
        e.model.provider === effectiveDefault.provider &&
        e.model.id === effectiveDefault.id,
    );
    if (idx >= 0) defaultIdx = idx;
  }

  const result = await ModelSelectController.show(
    ctx,
    modelEntries,
    sessionModel,
    defaultIdx,
  );

  if (result === undefined) return undefined;

  if (result) {
    saveConfig({ model: `${result.provider}/${result.id}` });
    ctx.ui.notify(`Commit model: ${result.provider}/${result.id}`, "info");
  }
  return result;
}

export function resolveCommitModel(
  ctx: ExtensionContext,
): AnyModel | undefined {
  const selected = getConfiguredModel(ctx);
  return selected ?? (ctx.model as AnyModel | undefined);
}
