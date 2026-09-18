import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

export { wrapTextWithAnsi };

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinnerGlyph(theme: Theme, nowMs = Date.now()): string {
  const i = Math.floor(nowMs / 80) % SPINNER_FRAMES.length;
  return theme.fg("accent", SPINNER_FRAMES[i] ?? "");
}

const MS_THRESHOLD = 3000;
const SECONDS_THRESHOLD = 90;

export const TIMER_MIN_ELAPSED_MS = 60_000;

export function formatDuration(elapsedMs: number): string {
  if (elapsedMs < MS_THRESHOLD) return `${Math.max(0, Math.round(elapsedMs))} ms`;
  const totalSeconds = elapsedMs / 1000;
  if (totalSeconds < SECONDS_THRESHOLD) return `${totalSeconds.toFixed(2)}s`;
  const totalSec = Math.round(totalSeconds);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const SPINNER_INTERVAL_MS = 80;

export class SpinnerTimer {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly invalidate: () => void) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(this.invalidate, SPINNER_INTERVAL_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
