import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, registerWorkingIndicatorConfigItems } from "./config.ts";
import { pickPhrase } from "./phrase.ts";
import { SpeedTracker } from "./speed-tracker.ts";
import { resolveSpinner, SPINNER_STYLES } from "@htwang-contrib/common";

const TICK_MS = 250;
const TOKS_LABEL = "tok/s";

function formatSpeed(speed: number | null): string {
  const value = speed === null || speed <= 0 ? "--" : speed.toFixed(1);
  return `${value} ${TOKS_LABEL}`;
}

function applySpinner(ctx: ExtensionContext): void {
  const spinner = resolveSpinner(loadConfig().spinner);
  if (SPINNER_STYLES[loadConfig().spinner]) {
    ctx.ui.setWorkingIndicator({
      frames: spinner.frames,
      intervalMs: spinner.intervalMs,
    });
  } else {
    ctx.ui.setWorkingIndicator();
  }
}

export default function (pi: ExtensionAPI) {
  let thinking = false;
  let thinkingStartMs = 0;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let currentPhrase = pickPhrase();
  const tracker = new SpeedTracker();

  function currentMessage(): string {
    const base = currentPhrase;
    if (thinking) {
      const seconds = Math.max(
        0,
        Math.floor((Date.now() - thinkingStartMs) / 1000),
      );
      return `${base}... [thinking ${seconds}s...]`;
    }
    if (tracker.isStreaming) {
      const speed = tracker.liveTokS();
      if (speed !== null && speed > 0) {
        return `${base}... ${formatSpeed(speed)}`;
      }
    }
    return `${base}...`;
  }

  function pushMessage(ctx: ExtensionContext): void {
    ctx.ui.setWorkingMessage(currentMessage());
  }

  function startTicking(ctx: ExtensionContext): void {
    if (tickTimer !== undefined) return;
    tickTimer = setInterval(() => pushMessage(ctx), TICK_MS);
  }

  function stopTicking(): void {
    if (tickTimer !== undefined) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    currentPhrase = pickPhrase();
    tracker.resetSession();
    applySpinner(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    currentPhrase = pickPhrase();
    if (ctx.hasUI) {
      ctx.ui.setWorkingMessage(currentMessage());
    }
  });

  pi.on("message_start", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "assistant") return;
    thinking = false;
    thinkingStartMs = 0;
    tracker.startMessage();
    startTicking(ctx);
  });

  pi.on("message_update", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "assistant") return;
    const delta = event.assistantMessageEvent;
    if (delta.type === "thinking_start" || delta.type === "thinking_delta") {
      if (!thinking) {
        thinking = true;
        thinkingStartMs = Date.now();
      }
    } else if (
      delta.type === "text_start" ||
      delta.type === "text_delta" ||
      delta.type === "toolcall_start"
    ) {
      if (thinking) {
        thinking = false;
      }
    }
    if (
      (delta.type === "text_delta" || delta.type === "thinking_delta") &&
      "partial" in delta
    ) {
      tracker.recordDelta(delta.delta, delta.partial?.usage?.output);
    }
    pushMessage(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "assistant") return;
    thinking = false;
    if (tracker.isStreaming) {
      tracker.finishMessage(
        event.message.usage?.output ?? 0,
        event.message.stopReason,
      );
    }
    stopTicking();
  });

  pi.on("session_shutdown", () => {
    stopTicking();
  });

  registerWorkingIndicatorConfigItems();
}
