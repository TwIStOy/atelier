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
  const prefix = queueMessagePrefix(index, theme);
  const available = Math.max(1, width - visibleWidth(prefix));
  const indent = " ".repeat(visibleWidth(prefix));

  const out: string[] = [];
  let isFirstParagraph = true;
  for (const raw of msg.text.split("\n")) {
    isFirstParagraph = pushWrappedParagraph(out, raw, prefix, indent, available, theme, isFirstParagraph);
  }

  return out;
}

function queueMessagePrefix(index: number, theme: Theme): string {
  const badge = theme.fg("accent", `💬 #${index + 1}`);
  return `${badge}${theme.fg("muted", " ")}`;
}

function pushWrappedParagraph(
  out: string[],
  raw: string,
  prefix: string,
  indent: string,
  available: number,
  theme: Theme,
  isFirstParagraph: boolean,
): boolean {
  const para = raw.length === 0 ? " " : raw;
  const wrapped = wrapTextWithAnsi(theme.fg("dim", para), available);
  for (let wi = 0; wi < wrapped.length; wi++) {
    out.push(queueMessageLine(isFirstParagraph, wi, prefix, indent, wrapped[wi]!));
  }
  return false;
}

function queueMessageLine(
  isFirstParagraph: boolean,
  lineIndex: number,
  prefix: string,
  indent: string,
  line: string,
): string {
  return isFirstParagraph && lineIndex === 0 ? `${prefix}${line}` : `${indent}${line}`;
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
