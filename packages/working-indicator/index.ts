import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, registerWorkingIndicatorConfigItems } from "./config.ts";
import { pickPhrase } from "./phrase.ts";
import {
  DEFAULT_RUNCAT_SPEED_CONFIG,
  quantizeInterval,
  runcatSpeedIntervalMs,
  RUNCAT_SPINNER_KEY,
  shouldRefreshRuncatInterval,
  shouldUpdateInterval,
  type RuncatSpeedConfig,
} from "./runcat.ts";
import { SPINNER_STYLES } from "@htwang-contrib/common";
import { SpeedTracker } from "./speed-tracker.ts";
import { EstimatedFrame, FrameEstimator } from "./frame-estimator.ts";

export { FrameEstimator } from "./frame-estimator.ts";
export type { EstimatedFrame } from "./frame-estimator.ts";

const TICK_MS = 250;
const TOKS_LABEL = "tok/s";

const frameEstimator = new FrameEstimator();

export function currentEstimatedFrame(): EstimatedFrame | null {
  return frameEstimator.estimate();
}

function formatSpeed(speed: number | null): string {
  const value = speed === null || speed <= 0 ? "--" : speed.toFixed(1);
  return `${value} ${TOKS_LABEL}`;
}

export default function (pi: ExtensionAPI) {
  let thinking = false;
  let thinkingStartMs = 0;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let currentPhrase = pickPhrase();
  const tracker = new SpeedTracker();

  let currentSpinnerKey: string | undefined;
  let runcatSpeedConfig: RuncatSpeedConfig = DEFAULT_RUNCAT_SPEED_CONFIG;
  let runcatIntervalMs: number | undefined;

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

  function setIndicator(
    ctx: ExtensionContext,
    options: { frames: string[]; intervalMs: number } | undefined,
  ): void {
    if (!options) {
      frameEstimator.clear();
      ctx.ui.setWorkingIndicator();
      return;
    }
    const frames = frameEstimator.rotatedForReset(
      options.frames,
      options.intervalMs,
    );
    frameEstimator.reset(frames, options.intervalMs);
    ctx.ui.setWorkingIndicator({
      frames,
      intervalMs: options.intervalMs,
    });
  }

  function applySpinner(ctx: ExtensionContext): void {
    const key = loadConfig().spinner;
    const style = SPINNER_STYLES[key];
    currentSpinnerKey = key;

    if (!style) {
      runcatIntervalMs = undefined;
      setIndicator(ctx, undefined);
      return;
    }

    if (key === RUNCAT_SPINNER_KEY) {
      runcatIntervalMs = runcatSpeedConfig.defaultIntervalMs;
    } else {
      runcatIntervalMs = undefined;
    }

    const intervalMs =
      key === RUNCAT_SPINNER_KEY
        ? runcatSpeedConfig.defaultIntervalMs
        : style.intervalMs;

    setIndicator(ctx, { frames: style.frames, intervalMs });
  }

  function refreshRuncatInterval(ctx: ExtensionContext): void {
    if (currentSpinnerKey !== RUNCAT_SPINNER_KEY || !ctx.hasUI) return;
    if (!shouldRefreshRuncatInterval(thinking)) return;
    const style = SPINNER_STYLES[RUNCAT_SPINNER_KEY]!;
    const target = quantizeInterval(
      runcatSpeedIntervalMs(tracker.liveTokS(), runcatSpeedConfig),
      runcatSpeedConfig,
    );
    const current = runcatIntervalMs ?? runcatSpeedConfig.defaultIntervalMs;
    if (!shouldUpdateInterval(current, target, runcatSpeedConfig)) return;

    runcatIntervalMs = target;
    setIndicator(ctx, { frames: style.frames, intervalMs: target });
  }

  function resetRuncatInterval(ctx: ExtensionContext): void {
    if (currentSpinnerKey !== RUNCAT_SPINNER_KEY || !ctx.hasUI) return;
    const style = SPINNER_STYLES[RUNCAT_SPINNER_KEY]!;
    const target = runcatSpeedConfig.defaultIntervalMs;
    if (runcatIntervalMs === target) return;
    runcatIntervalMs = target;
    setIndicator(ctx, { frames: style.frames, intervalMs: target });
  }

  function startTicking(ctx: ExtensionContext): void {
    if (tickTimer !== undefined) return;
    tickTimer = setInterval(() => {
      pushMessage(ctx);
      refreshRuncatInterval(ctx);
    }, TICK_MS);
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
        resetRuncatInterval(ctx);
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
    resetRuncatInterval(ctx);
    stopTicking();
  });

  pi.on("session_shutdown", () => {
    stopTicking();
  });

  registerWorkingIndicatorConfigItems();
}
