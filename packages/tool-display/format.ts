import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export { wrapTextWithAnsi };

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function spinnerGlyph(theme: Theme, nowMs = Date.now()): string {
  const i = Math.floor(nowMs / 80) % SPINNER_FRAMES.length;
  return theme.fg("accent", SPINNER_FRAMES[i] ?? "");
}

export function prefixLine(
  line: string,
  prefix: string,
  width: number,
): string {
  const prefixWidth = visibleWidth(prefix);
  const innerWidth = Math.max(1, width - prefixWidth);
  return prefix + truncateToWidth(line, innerWidth, "");
}
