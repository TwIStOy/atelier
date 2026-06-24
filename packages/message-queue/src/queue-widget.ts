import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { QueuedMessage } from "./queue.ts";

const WIDGET_KEY = "htwang-contrib-message-queue";
const WIDGET_OPTIONS = { placement: "belowEditor" as const };

const MAX_QUEUE_WIDGET_LINES = 8;

export { WIDGET_KEY, WIDGET_OPTIONS };

function padLineToWidth(line: string, width: number): string {
  const truncated = truncateToWidth(line, width, "");
  const vw = visibleWidth(truncated);
  return truncated + " ".repeat(Math.max(0, width - vw));
}

function linesForQueuedMessage(msg: QueuedMessage, index: number, theme: Theme, width: number): string[] {
  const badge = theme.fg("accent", `💬 #${index + 1}`);
  const sep = theme.fg("muted", " ");
  const prefix = `${badge}${sep}`;
  const prefixW = visibleWidth(prefix);
  const available = Math.max(1, width - prefixW);
  const indent = " ".repeat(prefixW);

  const parts = msg.text.split("\n");
  const out: string[] = [];
  let firstLineOfMessage = true;

  for (let pi = 0; pi < parts.length; pi++) {
    const raw = parts[pi]!;
    const para = raw.length === 0 ? " " : raw;
    const wrapped = wrapTextWithAnsi(theme.fg("dim", para), available);
    for (let wi = 0; wi < wrapped.length; wi++) {
      const piece = wrapped[wi]!;
      out.push(firstLineOfMessage && wi === 0 ? `${prefix}${piece}` : `${indent}${piece}`);
    }
    firstLineOfMessage = false;
  }

  return out;
}

export function renderQueueWidget(messages: readonly QueuedMessage[], theme: Theme, width: number): string[] {
  if (messages.length === 0) return [];

  const lines: string[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    lines.push(...linesForQueuedMessage(msg, i, theme, width));
  }

  if (lines.length > MAX_QUEUE_WIDGET_LINES) {
    const head = lines.slice(0, MAX_QUEUE_WIDGET_LINES - 1);
    head.push(theme.fg("muted", padLineToWidth("…", width)));
    return head;
  }

  return lines;
}
