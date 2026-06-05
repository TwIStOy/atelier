import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { glyphs } from "./glyphs.ts";

export function divider(width: number, theme: Theme): string {
  return theme.fg("dim", glyphs().line.repeat(Math.max(1, width)));
}

export function pad(text: string, width: number): string {
  const truncated = truncateToWidth(text, width, "");
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

export function wrapLine(line: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const normalized = String(line ?? "").replace(/\t/g, "  ");
  const wrapped = normalized.split(/\r?\n/).flatMap((part) => {
    const rows = wrapTextWithAnsi(part, safeWidth);
    return rows.length > 0 ? rows : [""];
  });
  return wrapped.map((part) => truncateToWidth(part, safeWidth, ""));
}
