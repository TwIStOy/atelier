import { formatTokenUsageSummaryLine } from "@htwang-contrib/common";
import type { SubagentBatchItemDetail } from "./run-agent.ts";

export function formatBatchToolText(items: SubagentBatchItemDetail[]): string {
  const ok = items.filter((x) => x.ok).length;
  const err = items.length - ok;
  const out: string[] = [`Subagent batch: ${items.length} task(s); ${ok} ok, ${err} error(s).`, ""];
  for (const it of items) {
    out.push(`### Task ${it.index} — ${it.ok ? "ok" : "error"}`);
    if (it.ok) {
      const t = (it.text ?? "").trim() || "(empty reply)";
      out.push(t.length > 12_000 ? `${t.slice(0, 12_000)}\n…` : t);
    } else {
      out.push(it.error ?? "unknown error");
    }
    if (
      (typeof it.usage_input === "number" && it.usage_input > 0) ||
      (typeof it.usage_output === "number" && it.usage_output > 0) ||
      it.context_percent != null
    ) {
      const up = typeof it.usage_input === "number" ? it.usage_input : 0;
      const down = typeof it.usage_output === "number" ? it.usage_output : 0;
      out.push(formatTokenUsageSummaryLine(up, down, it.context_percent));
    }
    out.push("");
  }
  return out.join("\n");
}
