import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SummaryEntryData } from "./types.ts";

export const SUMMARY_ENTRY_TYPE = "compact-thinking-summary";

export function extractThinkingRun(message: AssistantMessage, endIndex: number): string {
  const blocks: string[] = [];
  for (let i = Math.min(endIndex, message.content.length - 1); i >= 0; i--) {
    const content = message.content[i];
    if (content.type !== "thinking") break;
    const thinking = content.thinking.trim();
    if (thinking) blocks.unshift(thinking);
  }
  return blocks.join("\n\n");
}

export function getRunSummary(
  summaries: Map<number, Map<number, string>>,
  messageTimestamp: number,
  startIndex: number,
  endIndex: number,
): string | undefined {
  const forMessage = summaries.get(messageTimestamp);
  if (!forMessage) return undefined;
  for (let index = endIndex; index >= startIndex; index--) {
    const summary = forMessage.get(index);
    if (summary !== undefined) return summary;
  }
  return undefined;
}

export function storeRunSummary(
  summaries: Map<number, Map<number, string>>,
  messageTimestamp: number,
  contentIndex: number,
  summary: string,
): void {
  let forMessage = summaries.get(messageTimestamp);
  if (!forMessage) {
    forMessage = new Map();
    summaries.set(messageTimestamp, forMessage);
  }
  forMessage.set(contentIndex, summary);
}

export function restoreSummaryEntries(
  entries: Array<{
    type: string;
    customType?: string;
    data?: unknown;
  }>,
  summaries: Map<number, Map<number, string>>,
): void {
  summaries.clear();
  for (const entry of entries) {
    if (
      entry.type !== "custom" ||
      entry.customType !== SUMMARY_ENTRY_TYPE ||
      !entry.data ||
      typeof entry.data !== "object"
    ) {
      continue;
    }

    const data = entry.data as Partial<SummaryEntryData>;
    if (
      typeof data.messageTimestamp !== "number" ||
      !Number.isFinite(data.messageTimestamp) ||
      typeof data.contentIndex !== "number" ||
      !Number.isInteger(data.contentIndex) ||
      typeof data.summary !== "string" ||
      !data.summary.trim()
    ) {
      continue;
    }

    storeRunSummary(summaries, data.messageTimestamp, data.contentIndex, data.summary);
  }
}
