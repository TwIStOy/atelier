import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";
import type { SubagentRunDetails } from "./run-agent.ts";

const SUBAGENT_TOOL_UI_TICK_MS = 100;

export function tryParentToolUpdate(
  onUpdate: AgentToolUpdateCallback<SubagentRunDetails> | undefined,
  payload: AgentToolResult<SubagentRunDetails>,
) {
  if (!onUpdate) return;
  try {
    const r = onUpdate(payload);
    if (r != null && typeof (r as Promise<void>).then === "function") {
      void (r as Promise<void>).catch(() => {});
    }
  } catch {}
}

export function withThrottledParentFlush(
  onUpdate: AgentToolUpdateCallback<SubagentRunDetails> | undefined,
  flush: () => void,
): { start(): void; stopAndFlush(): void } {
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  return {
    start() {
      if (!onUpdate) return;
      flushTimer = setInterval(flush, SUBAGENT_TOOL_UI_TICK_MS);
      (flushTimer as NodeJS.Timeout & { unref?: () => void }).unref?.();
      flush();
    },
    stopAndFlush() {
      if (flushTimer !== undefined) {
        clearInterval(flushTimer);
        flushTimer = undefined;
      }
      if (onUpdate) flush();
    },
  };
}
