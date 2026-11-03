import { DEFAULT_SPEED_CONFIG, type SpeedConfig, TokenSpeedEngine } from "./speed-engine.ts";

export type CompletedMessageSpeed = {
  outputTokens: number;
  durationMs: number;
  tokS: number | null;
};

function isSuccessfulStop(stopReason: string | undefined): boolean {
  return stopReason !== "error" && stopReason !== "aborted";
}

export class SpeedTracker {
  private readonly engine: TokenSpeedEngine;
  private lastStableTokS: number | null = null;
  private sessionOutputTokens = 0;
  private sessionDurationMs = 0;

  constructor(config: SpeedConfig = DEFAULT_SPEED_CONFIG) {
    this.engine = new TokenSpeedEngine(config);
  }

  get isStreaming(): boolean {
    return this.engine.isStreaming;
  }

  get lastTokS(): number | null {
    return this.lastStableTokS;
  }

  resetSession(): void {
    this.sessionOutputTokens = 0;
    this.sessionDurationMs = 0;
  }

  startMessage(): void {
    this.engine.start();
  }

  recordDelta(delta: string, usageOutput?: number): void {
    this.engine.recordDelta(delta, usageOutput);
  }

  stopMessage(): void {
    if (this.engine.isStreaming) this.engine.stop();
  }

  liveTokS(): number | null {
    const speed = this.engine.tokS;
    return speed > 0 ? speed : this.lastStableTokS;
  }

  sessionAvgTokS(): number | null {
    return this.sessionDurationMs > 0 ? this.sessionOutputTokens / (this.sessionDurationMs / 1000) : null;
  }

  finishMessage(outputTokens: number, stopReason: string | undefined): CompletedMessageSpeed | null {
    if (!this.engine.isStreaming) return null;

    this.engine.reconcileTotal(outputTokens);
    const durationMs = this.engine.elapsedMs;
    const tokens = this.engine.tokenCount;
    const rawAvgTokS = durationMs > 0 ? tokens / (durationMs / 1000) : null;
    const tokS = this.engine.sanitizeTokS(rawAvgTokS, durationMs);
    this.lastStableTokS = tokS;
    this.engine.stop();

    if (tokS !== null && isSuccessfulStop(stopReason)) {
      this.sessionOutputTokens += tokens;
      this.sessionDurationMs += durationMs;
    }

    return {
      outputTokens: tokens,
      durationMs,
      tokS,
    };
  }
}
