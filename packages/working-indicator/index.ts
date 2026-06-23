import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, registerWorkingIndicatorConfigItems } from "./config.ts";
import {
  resolveEffectiveSpinnerKey,
  type NarrowWidthOptions,
} from "./narrow-screen.ts";
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
import {
  RuncatIndicatorEngine,
  type RuncatIndicatorSink,
} from "./runcat-engine.ts";

export { RuncatIndicatorEngine } from "./runcat-engine.ts";
export type {
  RuncatIndicatorSink,
  RuncatIndicatorOptions,
  RuncatIndicatorSnapshot,
} from "./runcat-engine.ts";

const TICK_MS = 250;
const TOKS_LABEL = "tok/s";

export default function (pi: ExtensionAPI) {
  let thinking = false;
  let thinkingStartMs = 0;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let currentPhrase = pickPhrase();
  const tracker = new SpeedTracker();

  let currentSpinnerKey: string | undefined;
  let runcatSpeedConfig: RuncatSpeedConfig = DEFAULT_RUNCAT_SPEED_CONFIG;
  let runcatIntervalMs: number | undefined;
  let runcatEngine: RuncatIndicatorEngine | undefined;
  let sessionCtx: ExtensionContext | undefined;
  let resizeListener: (() => void) | undefined;

  function formatSpeed(speed: number | null): string {
    const value = speed === null || speed <= 0 ? "--" : speed.toFixed(1);
    return `${value} ${TOKS_LABEL}`;
  }

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

  function makeRuncatSink(ctx: ExtensionContext): RuncatIndicatorSink {
    return {
      pushFrame(frame: string): void {
        ctx.ui.setWorkingIndicator({ frames: [frame] });
      },
    };
  }

  function setPlainIndicator(
    ctx: ExtensionContext,
    options: { frames: string[]; intervalMs: number } | undefined,
  ): void {
    ctx.ui.setWorkingIndicator(options);
  }

  function terminalWidth(): number {
    const cols = process.stdout.columns;
    return Number.isFinite(cols) && (cols ?? 0) > 0 ? (cols as number) : 80;
  }

  function narrowWidthOptions(): NarrowWidthOptions {
    const cfg = loadConfig();
    return {
      enabled: cfg.narrowWidthEnabled,
      threshold: cfg.narrowWidthThreshold,
      spinner: cfg.narrowWidthSpinner,
    };
  }

  function applySpinner(ctx: ExtensionContext): void {
    const width = terminalWidth();
    const key = resolveEffectiveSpinnerKey(
      loadConfig().spinner,
      width,
      narrowWidthOptions(),
    );
    const style = SPINNER_STYLES[key];
    currentSpinnerKey = key;

    if (!style) {
      stopRuncatEngine();
      runcatIntervalMs = undefined;
      setPlainIndicator(ctx, undefined);
      return;
    }

    if (key === RUNCAT_SPINNER_KEY) {
      runcatIntervalMs = runcatSpeedConfig.defaultIntervalMs;
      if (!runcatEngine) {
        runcatEngine = new RuncatIndicatorEngine(makeRuncatSink(ctx), {
          frames: style.frames,
          intervalMs: runcatSpeedConfig.defaultIntervalMs,
        });
      } else {
        runcatEngine.setFrames(style.frames);
        runcatEngine.setTargetInterval(runcatSpeedConfig.defaultIntervalMs);
      }
      setPlainIndicator(ctx, {
        frames: [style.frames[0] ?? ""],
        intervalMs: runcatSpeedConfig.defaultIntervalMs,
      });
      return;
    }

    stopRuncatEngine();
    runcatIntervalMs = undefined;
    setPlainIndicator(ctx, {
      frames: style.frames,
      intervalMs: style.intervalMs,
    });
  }

  function stopRuncatEngine(): void {
    if (runcatEngine) {
      runcatEngine.stop();
      runcatEngine = undefined;
    }
  }

  function refreshRuncatInterval(): void {
    if (currentSpinnerKey !== RUNCAT_SPINNER_KEY) return;
    const engine = runcatEngine;
    if (!engine) return;
    if (!shouldRefreshRuncatInterval(thinking)) return;
    const target = quantizeInterval(
      runcatSpeedIntervalMs(tracker.liveTokS(), runcatSpeedConfig),
      runcatSpeedConfig,
    );
    const current = runcatIntervalMs ?? runcatSpeedConfig.defaultIntervalMs;
    if (!shouldUpdateInterval(current, target, runcatSpeedConfig)) return;
    runcatIntervalMs = target;
    engine.setTargetInterval(target);
  }

  function resetRuncatInterval(): void {
    if (currentSpinnerKey !== RUNCAT_SPINNER_KEY) return;
    const engine = runcatEngine;
    if (!engine) return;
    const target = runcatSpeedConfig.defaultIntervalMs;
    if (runcatIntervalMs === target) return;
    runcatIntervalMs = target;
    engine.setTargetInterval(target);
  }

  function startTicking(ctx: ExtensionContext): void {
    if (tickTimer !== undefined) return;
    tickTimer = setInterval(() => {
      pushMessage(ctx);
      refreshRuncatInterval();
    }, TICK_MS);
  }

  function stopTicking(): void {
    if (tickTimer !== undefined) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  }

  function handleResize(): void {
    const ctx = sessionCtx;
    if (!ctx?.hasUI) return;
    const width = terminalWidth();
    // Only re-apply when the effective key actually flips (narrow ⇄ wide),
    // so a routine resize that keeps us in the same band never tears the
    // animation.
    const effectiveKey = resolveEffectiveSpinnerKey(
      loadConfig().spinner,
      width,
      narrowWidthOptions(),
    );
    if (effectiveKey === currentSpinnerKey) return;
    applySpinner(ctx);
  }

  function enableResizeListener(): void {
    if (resizeListener) return;
    resizeListener = () => handleResize();
    process.stdout.on("resize", resizeListener);
  }

  function disableResizeListener(): void {
    if (resizeListener) {
      process.stdout.off("resize", resizeListener);
      resizeListener = undefined;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    sessionCtx = ctx;
    currentPhrase = pickPhrase();
    tracker.resetSession();
    applySpinner(ctx);
    enableResizeListener();
  });

  pi.on("agent_start", (_event, ctx) => {
    currentPhrase = pickPhrase();
    if (ctx.hasUI) {
      ctx.ui.setWorkingMessage(currentMessage());
      // The engine spans the whole agent run (wait → thinking → text →
      // tool calls), so the spinner keeps moving between messages too.
      if (runcatEngine && !runcatEngine.isRunning()) runcatEngine.start();
      startTicking(ctx);
    }
  });

  pi.on("message_start", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "assistant") return;
    thinking = false;
    thinkingStartMs = 0;
    tracker.startMessage();
  });

  pi.on("message_update", (event, ctx) => {
    if (!ctx.hasUI) return;
    if (event.message.role !== "assistant") return;
    const delta = event.assistantMessageEvent;
    if (delta.type === "thinking_start" || delta.type === "thinking_delta") {
      if (!thinking) {
        thinking = true;
        thinkingStartMs = Date.now();
        resetRuncatInterval();
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
    resetRuncatInterval();
  });

  pi.on("agent_end", (_event, ctx) => {
    stopTicking();
    // Agent run finished — park the engine until the next agent_start.
    runcatEngine?.stop();
    if (ctx.hasUI && currentSpinnerKey === RUNCAT_SPINNER_KEY) {
      const style = SPINNER_STYLES[RUNCAT_SPINNER_KEY];
      if (style) {
        setPlainIndicator(ctx, {
          frames: [style.frames[0] ?? ""],
          intervalMs: runcatSpeedConfig.defaultIntervalMs,
        });
      }
    }
  });

  pi.on("session_shutdown", () => {
    stopTicking();
    stopRuncatEngine();
    disableResizeListener();
    sessionCtx = undefined;
  });

  registerWorkingIndicatorConfigItems();
}
