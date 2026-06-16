import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, registerWorkingIndicatorConfigItems } from "./config.ts";
import { pickPhrase } from "./phrase.ts";
import { resolveSpinner, SPINNER_STYLES } from "./spinner.ts";

type ThinkingEvent =
  | { type: "thinking_start" }
  | { type: "thinking_delta" }
  | { type: "thinking_end" }
  | { type: "text_start" }
  | { type: "text_delta" }
  | { type: "text_end" }
  | { type: "toolcall_start" }
  | { type: "done" }
  | { type: "error" }
  | { type: string };

const TICK_MS = 1000;

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

  function currentMessage(): string {
    const base = currentPhrase;
    if (!thinking) return base;
    const seconds = Math.max(
      0,
      Math.floor((Date.now() - thinkingStartMs) / 1000),
    );
    return `${base} [thinking ${seconds}s...]`;
  }

  function pushMessage(ctx: ExtensionContext): void {
    ctx.ui.setWorkingMessage(currentMessage());
  }

  function startTicking(ctx: ExtensionContext): void {
    stopTicking();
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
    applySpinner(ctx);
  });

  pi.on("agent_start", () => {
    currentPhrase = pickPhrase();
  });

  pi.on("message_update", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "assistant") return;
    const delta = event.assistantMessageEvent as ThinkingEvent;
    if (delta.type === "thinking_start" || delta.type === "thinking_delta") {
      if (!thinking) {
        thinking = true;
        thinkingStartMs = Date.now();
        startTicking(ctx);
      }
    } else if (
      delta.type === "text_start" ||
      delta.type === "text_delta" ||
      delta.type === "toolcall_start"
    ) {
      if (thinking) {
        thinking = false;
        stopTicking();
      }
    }
    pushMessage(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "assistant") return;
    thinking = false;
    stopTicking();
    ctx.ui.setWorkingMessage();
  });

  pi.on("session_shutdown", () => {
    stopTicking();
  });

  registerWorkingIndicatorConfigItems();
}
