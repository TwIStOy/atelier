import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common/config";
import { resolveModel } from "@htwang-contrib/common/model-resolve";

export interface GoalConfig {
  verifierModel: string;
  verifierMaxTurns: number;
  verifierMaxRetries: number;
  maxConsecutiveErrors: number;
}

const CONFIG_ID = "goal";

const DEFAULT_VERIFIER_MAX_TURNS = 15;
const DEFAULT_VERIFIER_MAX_RETRIES = 2;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 3;

const CONFIG_SCHEMA: ExtensionConfigSchema<GoalConfig> = {
  defaults: {
    verifierModel: "",
    verifierMaxTurns: DEFAULT_VERIFIER_MAX_TURNS,
    verifierMaxRetries: DEFAULT_VERIFIER_MAX_RETRIES,
    maxConsecutiveErrors: DEFAULT_MAX_CONSECUTIVE_ERRORS,
  },
};

export function loadGoalConfig(): GoalConfig {
  const raw = readConfig(CONFIG_ID, CONFIG_SCHEMA);
  return {
    verifierModel: raw.verifierModel,
    verifierMaxTurns: Number(raw.verifierMaxTurns),
    verifierMaxRetries: Math.max(0, Number(raw.verifierMaxRetries)),
    maxConsecutiveErrors: Math.max(1, Number(raw.maxConsecutiveErrors)),
  };
}

type AnyModel = Model<any>;

let cachedModelOptions: Array<{ label: string; value: string }> = [];

export function setCachedModelOptions(models: Array<{ label: string; value: string }>): void {
  cachedModelOptions = models;
}

export function registerGoalConfigItems(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "verifierModel",
      type: "select",
      label: "Goal Verifier Model",
      value: () => loadGoalConfig().verifierModel,
      description:
        "Model used by the independent verification agent when update_goal(complete) is called. Empty = use the session's current model.",
      extensionLabel: "Goal",
      order: 0,
      options: () => [{ label: "(use session model)", value: "" }, ...cachedModelOptions],
    },
    {
      key: "verifierMaxTurns",
      type: "number",
      label: "Goal Verifier Max Turns",
      value: () => loadGoalConfig().verifierMaxTurns,
      description:
        "Max agent turns for the goal verification session. Set to 0 for unlimited (only bounded by the session abort).",
      extensionLabel: "Goal",
      order: 1,
      min: 0,
    },
    {
      key: "verifierMaxRetries",
      type: "number",
      label: "Goal Verifier Max Retries",
      value: () => loadGoalConfig().verifierMaxRetries,
      description:
        "Max retries when the verifier output does not contain a valid VERDICT line. The first attempt plus these retries. 0 = single attempt, no retry.",
      extensionLabel: "Goal",
      order: 2,
      min: 0,
    },
    {
      key: "maxConsecutiveErrors",
      type: "number",
      label: "Goal Max Consecutive Errors",
      value: () => loadGoalConfig().maxConsecutiveErrors,
      description:
        "Number of consecutive provider errors at agent_end before an active goal is auto-paused (use /goal resume to retry). Absorbs the host's own retries.",
      extensionLabel: "Goal",
      order: 3,
      min: 1,
    },
  ]);
}

export function resolveVerifierModel(ctx: ExtensionContext): AnyModel {
  const config = loadGoalConfig();
  if (!config.verifierModel) {
    return ctx.model as AnyModel;
  }
  const models = ctx.modelRegistry.getAvailable();
  const resolved = resolveModel(models, config.verifierModel) as AnyModel | undefined;
  return resolved ?? (ctx.model as AnyModel);
}
