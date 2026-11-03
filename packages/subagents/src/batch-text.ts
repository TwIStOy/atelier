import { formatTokenUsageSummaryLine } from "@htwang-contrib/common";
import type { SubagentBatchItemDetail } from "./run-agent.ts";

const MAX_ITEM_TEXT = 12_000;

function truncated(text: string): string {
  return text.length > MAX_ITEM_TEXT ? `${text.slice(0, MAX_ITEM_TEXT)}\n…` : text;
}

function itemText(it: SubagentBatchItemDetail): string {
  return (it.text ?? "").trim();
}

function numOrZero(v: number | undefined): number {
  return typeof v === "number" ? v : 0;
}

function hasUsageLine(it: SubagentBatchItemDetail): boolean {
  return numOrZero(it.usage_input) > 0 || numOrZero(it.usage_output) > 0 || it.context_percent != null;
}

function pushUsageLine(it: SubagentBatchItemDetail, out: string[]): void {
  if (!hasUsageLine(it)) return;
  out.push(formatTokenUsageSummaryLine(numOrZero(it.usage_input), numOrZero(it.usage_output), it.context_percent));
}

function formatOkOutcome(it: SubagentBatchItemDetail, out: string[]): void {
  out.push(truncated(itemText(it) || "(empty reply)"));
}

function formatErrorOutcome(it: SubagentBatchItemDetail, out: string[]): void {
  out.push(it.error ?? "unknown error");
  const partial = itemText(it);
  if (!partial) return;
  out.push("");
  out.push("Partial output before the failure:");
  out.push(truncated(partial));
}

function formatBatchItem(it: SubagentBatchItemDetail, out: string[]): void {
  out.push(`### Task ${it.index} — ${it.ok ? "ok" : "error"}`);
  if (it.ok) {
    formatOkOutcome(it, out);
  } else {
    formatErrorOutcome(it, out);
  }
  pushUsageLine(it, out);
  out.push("");
}

export function formatBatchToolText(items: SubagentBatchItemDetail[]): string {
  const ok = items.filter((x) => x.ok).length;
  const err = items.length - ok;
  const out: string[] = [`Subagent batch: ${items.length} task(s); ${ok} ok, ${err} error(s).`, ""];
  for (const it of items) {
    formatBatchItem(it, out);
  }
  return out.join("\n");
}
