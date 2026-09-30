import type { ExtensionAPI, ModelRegistry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { COMPLEXITY_TIERS, type ComplexityTier, isComplexityTier, isExtensionDisabled } from "@htwang-contrib/common";
import { CONFIG_ID, loadConfig, registerSettings, resolvePhysicalModel } from "./config.ts";
import { judgeComplexity } from "./judge.ts";

export const VIRTUAL_PROVIDER = "virtual";
export const VIRTUAL_MODEL_ID = "auto";
export const TIER_ENTRY = "virtual-model:tier";

interface TierState {
  tier: ComplexityTier;
}

function highestTier(entries: readonly SessionEntry[], ...states: unknown[]): ComplexityTier {
  let highest: ComplexityTier = "flash";
  for (const data of [
    ...states,
    ...entries.flatMap((entry) => (entry.type === "custom" && entry.customType === TIER_ENTRY ? [entry.data] : [])),
  ]) {
    if (typeof data !== "object" || data === null || !("tier" in data) || !isComplexityTier(data.tier)) continue;
    if (COMPLEXITY_TIERS.indexOf(data.tier) > COMPLEXITY_TIERS.indexOf(highest)) highest = data.tier;
  }
  return highest;
}

export default function virtualModel(pi: ExtensionAPI): void {
  if (isExtensionDisabled(CONFIG_ID)) return;

  let registry: ModelRegistry | undefined;
  let lifetime = new AbortController();
  registerSettings(() => registry);

  pi.on("session_start", (_event, ctx) => {
    lifetime.abort();
    lifetime = new AbortController();
    registry = ctx.modelRegistry;
  });
  pi.on("session_shutdown", () => {
    lifetime.abort();
    registry = undefined;
  });

  pi.registerVirtualModel<TierState>({
    provider: VIRTUAL_PROVIDER,
    id: VIRTUAL_MODEL_ID,
    name: "Auto (Flash / Middle / Flagship)",
    thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    async route(request, ctx) {
      const config = loadConfig();
      const models = {
        flash: resolvePhysicalModel(ctx.modelRegistry, config.flashModel),
        middle: resolvePhysicalModel(ctx.modelRegistry, config.middleModel),
        flagship: resolvePhysicalModel(ctx.modelRegistry, config.flagshipModel),
      };
      const signals = [lifetime.signal, AbortSignal.timeout(config.judgeTimeoutMs)];
      if (request.signal) signals.push(request.signal);
      const signal = AbortSignal.any(signals);
      signal.throwIfAborted();
      let tier = highestTier(ctx.sessionManager.getEntries(), request.state);
      const retryHasTier =
        request.reason === "retry" &&
        request.failed !== undefined &&
        (isComplexityTier(request.state?.tier) || tier !== "flash");
      if (tier !== "flagship" && !retryHasTier && request.reason !== "direct") {
        const decision = await judgeComplexity(ctx.modelRegistry, config.judgeModel, request.messages, signal);
        signal.throwIfAborted();
        tier = highestTier(ctx.sessionManager.getEntries(), request.state, { tier: decision });
      }
      signal.throwIfAborted();
      if (COMPLEXITY_TIERS.indexOf(tier) > COMPLEXITY_TIERS.indexOf(highestTier(ctx.sessionManager.getEntries()))) {
        pi.appendEntry(TIER_ENTRY, { tier });
      }
      return {
        model: models[tier],
        thinkingLevel: request.thinkingLevel,
        state: request.state?.tier === tier ? request.state : { tier },
      };
    },
  });
}
