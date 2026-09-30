import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getGlobalState } from "./global-state.ts";
import type { ComplexityTier } from "./model-complexity.ts";

export const VIRTUAL_MODEL_STATUS_EVENT = "pi-extensions:virtual-model:status";

export interface VirtualModelStatus {
  provider: string;
  modelId: string;
  tier: ComplexityTier;
  physicalModel: Model<Api>;
  thinkingLevel: ModelThinkingLevel;
}

function statuses(): Map<string, VirtualModelStatus> {
  return getGlobalState("pi-extensions.virtual-model-status", () => new Map());
}

export function setVirtualModelStatus(sessionId: string, status: VirtualModelStatus | undefined): void {
  if (status) statuses().set(sessionId, status);
  else statuses().delete(sessionId);
}

export function getVirtualModelStatus(ctx: ExtensionContext): VirtualModelStatus | undefined {
  if (ctx.model?.api !== "pi-virtual") return undefined;
  const status = statuses().get(ctx.sessionManager.getSessionId());
  return status?.provider === ctx.model.provider && status.modelId === ctx.model.id ? status : undefined;
}

export function getEffectiveContextUsage(ctx: ExtensionContext): ReturnType<ExtensionContext["getContextUsage"]> {
  const usage = ctx.getContextUsage();
  if (!usage) return undefined;
  const route = getVirtualModelStatus(ctx);
  if (!route) return usage;
  const contextWindow = route.physicalModel.contextWindow;
  return {
    ...usage,
    contextWindow,
    percent: usage.tokens !== null && contextWindow > 0 ? (usage.tokens / contextWindow) * 100 : null,
  };
}

export function getEffectiveContextWindow(ctx: ExtensionContext): number {
  return (
    getVirtualModelStatus(ctx)?.physicalModel.contextWindow ??
    ctx.getContextUsage()?.contextWindow ??
    ctx.model?.contextWindow ??
    0
  );
}
