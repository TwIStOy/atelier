import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  formatTurnTelemetry,
  isExtensionDisabled,
  type TelemetryModelRef,
  type TelemetryUsage,
  TurnTelemetryTracker,
} from "@htwang-contrib/common";
import { loadConfig, registerStatuslineConfigItems } from "./config.ts";
import { makeFooter } from "./footer.ts";

function modelRefOf(message: { role: string; provider?: string; model?: string }): TelemetryModelRef | null {
  if (message.role !== "assistant") return null;
  if (!message.provider || !message.model) return null;
  return { provider: message.provider, model: message.model };
}

function usageOf(message: {
  role: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: { total: number };
  };
}): TelemetryUsage | null {
  if (message.role !== "assistant" || !message.usage) return null;
  const u = message.usage;
  return {
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    cost: u.cost.total,
  };
}

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("statusline")) return;
  const telemetry = new TurnTelemetryTracker();

  registerStatuslineConfigItems();

  pi.on("agent_start", () => telemetry.onAgentStart());
  pi.on("turn_start", () => telemetry.onTurnStart());
  pi.on("message_start", (event) => telemetry.onMessageStart(modelRefOf(event.message)));
  pi.on("message_update", (event) => {
    const ev = event.assistantMessageEvent;
    if (ev.type === "text_delta" || ev.type === "thinking_delta" || ev.type === "toolcall_delta") {
      telemetry.onMessageDelta(ev.type, ev.delta);
    }
  });
  pi.on("message_end", (event) => telemetry.onMessageEnd(usageOf(event.message)));
  pi.on("tool_execution_start", () => telemetry.onToolExecutionStart());
  pi.on("turn_end", () => telemetry.onTurnEnd());
  pi.on("agent_settled", (_event, ctx) => {
    if (!loadConfig().telemetry) return;
    const result = telemetry.endAgent();
    if (!result) return;
    const line = formatTurnTelemetry(result);
    if (line) ctx.ui.notify(line, "info");
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setFooter(makeFooter(ctx));
  });
}
