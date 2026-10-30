import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import {
  type ExtensionConfigSchema,
  isExtensionDisabled,
  readConfig,
  registerConfigItems,
} from "@htwang-contrib/common";
import { computeIdleGapMs, normalizeIdleCompactMinutes, shouldIdleCompact } from "./idle.ts";

type CompactionStrategy = "keep-recent" | "keep-bookends" | "summarize-all";

const STRATEGY_OPTIONS: {
  label: string;
  value: CompactionStrategy;
}[] = [
  { label: "Keep recent only (default)", value: "keep-recent" },
  { label: "Keep oldest + newest, compact middle", value: "keep-bookends" },
  { label: "Summarize everything", value: "summarize-all" },
];

interface AutoCompactConfig {
  autoCompactPercent: number;
  autoCompactTokenLimit: number;
  keepRecentPercent: number;
  strategy: CompactionStrategy;
  idleCompactMinutes: number;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<AutoCompactConfig> = {
  defaults: {
    autoCompactPercent: 90,
    autoCompactTokenLimit: 0,
    keepRecentPercent: 15,
    strategy: "keep-recent",
    idleCompactMinutes: 0,
  },
};

function loadConfig(): AutoCompactConfig {
  const raw = readConfig("auto-compact", CONFIG_SCHEMA);
  return {
    autoCompactPercent: Number(raw.autoCompactPercent),
    autoCompactTokenLimit: Number(raw.autoCompactTokenLimit),
    keepRecentPercent: Number(raw.keepRecentPercent),
    strategy: raw.strategy as CompactionStrategy,
    idleCompactMinutes: normalizeIdleCompactMinutes(raw.idleCompactMinutes),
  };
}

const estimateMessageTokens = estimateTokens;

function estimateTotalTokens(messages: AgentMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

function snapToUserBoundary(messages: AgentMessage[], rawIndex: number): number {
  let idx = rawIndex;
  while (idx < messages.length) {
    if (messages[idx].role === "user") break;
    idx++;
  }
  return Math.min(idx, messages.length);
}

function findCutPointRecent(messages: AgentMessage[], keepTokens: number): number {
  let accumulated = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(messages[i]);
    if (accumulated + tokens > keepTokens) {
      return snapToUserBoundary(messages, i + 1);
    }
    accumulated += tokens;
  }
  return 0;
}

function findBookendCutRange(messages: AgentMessage[], keepTokens: number): [number, number] {
  const halfBudget = Math.floor(keepTokens / 2);
  let headEnd = 0;
  let headTokens = 0;
  for (let i = 0; i < messages.length; i++) {
    const t = estimateMessageTokens(messages[i]);
    if (headTokens + t > halfBudget) break;
    headTokens += t;
    headEnd = i + 1;
  }
  headEnd = snapToUserBoundary(messages, headEnd);

  let tailStart = messages.length;
  let tailTokens = 0;
  for (let i = messages.length - 1; i >= headEnd; i--) {
    const t = estimateMessageTokens(messages[i]);
    if (tailTokens + t > halfBudget) break;
    tailTokens += t;
    tailStart = i;
  }
  while (tailStart > headEnd && messages[tailStart]?.role !== "user") {
    tailStart--;
  }
  tailStart = Math.max(tailStart, headEnd);
  if (tailStart <= headEnd) return [0, 0];
  return [headEnd, tailStart];
}

function createTruncationNotice(removedCount: number, removedTokens: number): AgentMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `[Context compacted: ${removedCount} earlier messages (~${Math.round(removedTokens / 1000)}K tokens) were summarized. Full context is preserved in session history. Continue with the current task.]`,
      },
    ],
    timestamp: Date.now(),
  };
}

function applyTruncationStrategy(
  messages: AgentMessage[],
  keepTokens: number,
  strategy: CompactionStrategy,
): AgentMessage[] | null {
  switch (strategy) {
    case "keep-recent": {
      const cutIndex = findCutPointRecent(messages, keepTokens);
      if (cutIndex <= 0) return null;
      const removed = messages.slice(0, cutIndex);
      const kept = messages.slice(cutIndex);
      const notice = createTruncationNotice(removed.length, estimateTotalTokens(removed));
      return [notice, ...kept];
    }
    case "keep-bookends": {
      const [removeStart, removeEnd] = findBookendCutRange(messages, keepTokens);
      if (removeStart >= removeEnd) return null;
      const removed = messages.slice(removeStart, removeEnd);
      const head = messages.slice(0, removeStart);
      const tail = messages.slice(removeEnd);
      const notice = createTruncationNotice(removed.length, estimateTotalTokens(removed));
      return [...head, notice, ...tail];
    }
    case "summarize-all": {
      if (messages.length <= 1) return null;
      const lastUserIdx = messages.length - 1;
      const removed = messages.slice(0, lastUserIdx);
      const notice = createTruncationNotice(removed.length, estimateTotalTokens(removed));
      return [notice, messages[lastUserIdx]];
    }
    default:
      return null;
  }
}

type AutoCompactPhase = "pre-turn" | "mid-turn" | "emergency" | "session-resume" | "idle";

const AUTO_COMPACT_FOLLOW_UP: Record<AutoCompactPhase, string> = {
  "pre-turn": "Auto-compact ran before this turn. Continue with the current task.",
  "mid-turn": "Auto-compact ran mid-turn. Continue executing the remaining work.",
  emergency: "Emergency auto-compact ran. Resume where we left off.",
  "session-resume": "Auto-compact ran on session resume. Continue with the active task.",
  idle: "Idle auto-compact ran after a long idle period. Continue with the current task.",
};

function registerAutoCompactConfigItems(): void {
  registerConfigItems("auto-compact", [
    {
      key: "autoCompactPercent",
      type: "select",
      label: "Auto-compact Threshold",
      value: () => String(loadConfig().autoCompactPercent),
      description: "Percentage of context window at which compaction triggers",
      extensionLabel: "Auto-Compact",
      order: 0,
      options: [
        { label: "80%", value: "80" },
        { label: "85%", value: "85" },
        { label: "90%", value: "90" },
        { label: "95%", value: "95" },
      ],
    },
    {
      key: "keepRecentPercent",
      type: "select",
      label: "Keep Recent Budget",
      value: () => String(loadConfig().keepRecentPercent),
      description: "Percentage of context window to preserve as recent context",
      extensionLabel: "Auto-Compact",
      order: 1,
      options: [
        { label: "5%", value: "5" },
        { label: "10%", value: "10" },
        { label: "15%", value: "15" },
        { label: "20%", value: "20" },
      ],
    },
    {
      key: "strategy",
      type: "select",
      label: "Compaction Strategy",
      value: () => loadConfig().strategy,
      description: "How messages are selected for removal during emergency truncation",
      extensionLabel: "Auto-Compact",
      order: 2,
      options: STRATEGY_OPTIONS,
    },
    {
      key: "idleCompactMinutes",
      type: "number",
      label: "Idle Compact Threshold",
      value: () => loadConfig().idleCompactMinutes,
      description: "Minutes of inactivity after which compaction runs before the next turn (0 disables)",
      extensionLabel: "Auto-Compact",
      order: 3,
      min: 0,
    },
  ]);
}

export default function autoCompact(pi: ExtensionAPI): void {
  if (isExtensionDisabled("auto-compact")) return;
  const guard = pi as unknown as Record<symbol, boolean>;
  const INSTALL_GUARD = Symbol.for("pi-extensions.auto-compact.installed");
  if (guard[INSTALL_GUARD]) return;
  guard[INSTALL_GUARD] = true;

  registerAutoCompactConfigItems();

  let pendingCompaction = false;
  let lastEstimatedTokens = 0;
  let truncationAppliedThisTurn = false;

  let cachedContextWindow = 0;
  let cachedAutoCompactLimit = 0;
  let cachedKeepRecentTokens = 0;

  const computeAutoCompactLimit = (config: AutoCompactConfig, contextWindow: number): number => {
    if (config.autoCompactPercent > 0) {
      return Math.floor((contextWindow * config.autoCompactPercent) / 100);
    }
    return config.autoCompactTokenLimit;
  };

  const computeKeepRecentTokens = (config: AutoCompactConfig, contextWindow: number): number => {
    return Math.floor((contextWindow * config.keepRecentPercent) / 100);
  };

  const updateCachedLimits = (config: AutoCompactConfig, contextWindow: number) => {
    if (contextWindow !== cachedContextWindow) {
      cachedContextWindow = contextWindow;
      cachedAutoCompactLimit = computeAutoCompactLimit(config, contextWindow);
      cachedKeepRecentTokens = computeKeepRecentTokens(config, contextWindow);
    }
  };

  const getTokenUsage = (ctx: ExtensionContext): number => {
    const config = loadConfig();
    const usage = ctx.getContextUsage();
    updateCachedLimits(config, usage?.contextWindow ?? ctx.model?.contextWindow ?? 0);
    if (usage && usage.tokens !== null) {
      return usage.tokens;
    }
    return lastEstimatedTokens;
  };

  const triggerAutoCompact = (
    ctx: ExtensionContext,
    phase: AutoCompactPhase,
    customInstructions?: string,
    options?: { followUp?: boolean },
  ): void => {
    const followUp = options?.followUp ?? true;
    pendingCompaction = true;
    ctx.compact({
      customInstructions,
      onComplete: () => {
        pendingCompaction = false;
        if (!followUp) return;
        setImmediate(() => {
          if (ctx.isIdle()) {
            pi.sendUserMessage(AUTO_COMPACT_FOLLOW_UP[phase]);
          }
        });
      },
      onError: () => {
        pendingCompaction = false;
      },
    });
  };

  const currentIdleGapMs = (ctx: ExtensionContext, now: number): number | null => {
    return computeIdleGapMs(ctx.sessionManager.getBranch(), now);
  };

  const maybeIdleCompact = (
    ctx: ExtensionContext,
    tokens: number,
    now: number,
    options?: { followUp?: boolean },
  ): boolean => {
    if (pendingCompaction) return false;
    const config = loadConfig();
    const gapMs = currentIdleGapMs(ctx, now);
    if (
      !shouldIdleCompact({
        gapMs,
        tokens,
        contextWindow: cachedContextWindow,
        thresholdMinutes: config.idleCompactMinutes,
      })
    ) {
      return false;
    }
    triggerAutoCompact(
      ctx,
      "idle",
      "The session was idle long enough for the prompt cache to expire. Focus on preserving task context and open decisions.",
      options,
    );
    return true;
  };

  pi.on("turn_start", async (event, ctx) => {
    truncationAppliedThisTurn = false;
    const tokens = getTokenUsage(ctx);
    if (cachedAutoCompactLimit > 0 && tokens >= cachedAutoCompactLimit) {
      triggerAutoCompact(ctx, "pre-turn", "Focus on preserving task context and recent work.");
      return;
    }
    maybeIdleCompact(ctx, tokens, event.timestamp);
  });

  pi.on("context", async (event, ctx) => {
    const config = loadConfig();
    const messages = event.messages;
    const estimatedTokens = estimateTotalTokens(messages);
    lastEstimatedTokens = estimatedTokens;
    const cw = ctx.getContextUsage()?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    updateCachedLimits(config, cw);

    if (cachedAutoCompactLimit > 0 && estimatedTokens > cachedAutoCompactLimit && !pendingCompaction) {
      const newMessages = applyTruncationStrategy(messages, cachedKeepRecentTokens, config.strategy);
      if (newMessages) {
        truncationAppliedThisTurn = true;
        setImmediate(() => {
          triggerAutoCompact(
            ctx,
            "emergency",
            "Emergency context truncation was applied. Generate a comprehensive summary.",
          );
        });
        return { messages: newMessages };
      }
    }
    return;
  });

  pi.on("turn_end", async (event, ctx) => {
    const { message } = event;
    let hasToolCalls = false;
    if (message.role === "assistant" && "content" in message && Array.isArray(message.content)) {
      hasToolCalls = message.content.some((block: { type: string }) => block.type === "tool_use");
    }
    if (!hasToolCalls) return;

    const tokens = getTokenUsage(ctx);
    if (cachedAutoCompactLimit > 0 && tokens >= cachedAutoCompactLimit && !pendingCompaction) {
      triggerAutoCompact(ctx, "mid-turn", "Mid-turn compaction: preserve current task context and tool call results.");
    }
  });

  pi.on("session_start", async (event, ctx) => {
    pendingCompaction = false;
    truncationAppliedThisTurn = false;
    lastEstimatedTokens = 0;
    cachedContextWindow = 0;
    cachedAutoCompactLimit = 0;
    cachedKeepRecentTokens = 0;

    if (event.reason === "resume" || event.reason === "fork") {
      const config = loadConfig();
      const usage = ctx.getContextUsage();
      if (usage && usage.tokens !== null) {
        lastEstimatedTokens = usage.tokens;
        const cw = usage.contextWindow;
        updateCachedLimits(config, cw);
        if (cachedAutoCompactLimit > 0 && usage.tokens >= cachedAutoCompactLimit) {
          triggerAutoCompact(ctx, "session-resume");
        } else {
          maybeIdleCompact(ctx, usage.tokens, Date.now(), { followUp: false });
        }
      }
    }
  });

  pi.on("model_select", async (_event, ctx) => {
    const config = loadConfig();
    const cw = ctx.getContextUsage()?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    updateCachedLimits(config, cw);
  });

  pi.registerCommand("auto-compact", {
    description: "Show auto-compaction status",
    handler: async (_args, ctx) => {
      const config = loadConfig();
      const usage = ctx.getContextUsage();
      const cw = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
      updateCachedLimits(config, cw);

      const tokens = usage?.tokens ?? lastEstimatedTokens;
      const percent = usage?.percent ?? (cachedAutoCompactLimit > 0 ? (tokens / cachedAutoCompactLimit) * 100 : 0);
      const strategyLabel = STRATEGY_OPTIONS.find((o) => o.value === config.strategy)?.label ?? config.strategy;
      const idleGapMs = currentIdleGapMs(ctx, Date.now());
      const idleGapLabel = idleGapMs !== null ? `${(idleGapMs / 60000).toFixed(1)} min` : "unknown";
      ctx.ui.notify(
        `Auto-Compact Status:\n` +
          `  Current tokens: ~${Math.round(tokens / 1000)}K\n` +
          `  Limit: ${Math.round(cachedAutoCompactLimit / 1000)}K (${config.autoCompactPercent}% of ${Math.round(cachedContextWindow / 1000)}K)\n` +
          `  Usage: ${percent.toFixed(1)}%\n` +
          `  Strategy: ${strategyLabel}\n` +
          `  Idle threshold: ${config.idleCompactMinutes > 0 ? `${config.idleCompactMinutes} min` : "disabled"}\n` +
          `  Idle gap: ${idleGapLabel}\n` +
          `  Pending compaction: ${pendingCompaction}\n` +
          `  Truncation this turn: ${truncationAppliedThisTurn}`,
        "info",
      );
    },
  });
}
