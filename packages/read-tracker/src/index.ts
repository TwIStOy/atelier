import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { buildReadRows, renderReadTrackerTable, summarizeRows } from "./display.ts";
import { ReadTracker } from "./read-tracker.ts";

const WRITE_LIKE_TOOLS = new Set(["edit", "write"]);

function extractPath(input: Record<string, unknown>): string | null {
  const candidate = input.path ?? input.filePath;
  return typeof candidate === "string" ? candidate : null;
}

export default function (pi: ExtensionAPI) {
  const tracker = new ReadTracker();

  pi.on("tool_call", async (event) => {
    if (isToolCallEventType("read", event)) {
      tracker.record(event.input.path);
      return;
    }
    if (WRITE_LIKE_TOOLS.has(event.toolName)) {
      const p = extractPath(event.input);
      if (p === null) return;
      const result = tracker.check(p);
      if (result) {
        return { block: true, reason: result.reason };
      }
    }
    return;
  });

  pi.on("tool_result", async (event) => {
    if (event.isError) return;
    if (WRITE_LIKE_TOOLS.has(event.toolName)) {
      const p = extractPath(event.input);
      if (p === null) return;
      tracker.refresh(p);
    }
    return;
  });

  pi.on("session_shutdown", async () => {
    tracker.clear();
  });

  pi.registerCommand("read-tracker", {
    description: "List files tracked by read-tracker (read op time, size, mtime). Args: clear|count",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim().toLowerCase();
      if (trimmed === "clear") {
        const n = tracker.paths().length;
        tracker.clear();
        ctx.ui.notify(`Cleared ${n} tracked file${n === 1 ? "" : "s"}.`, "info");
        return;
      }
      if (trimmed === "count") {
        const { total } = summarizeRows(buildReadRows(tracker.entries()));
        ctx.ui.notify(`${total} tracked file${total === 1 ? "" : "s"}.`, "info");
        return;
      }
      if (trimmed !== "") {
        ctx.ui.notify(`Unknown argument: ${args}. Usage: /read-tracker [clear|count]`, "warning");
        return;
      }
      const rows = buildReadRows(tracker.entries());
      const { total, stale } = summarizeRows(rows);
      const body = renderReadTrackerTable(rows);
      ctx.ui.notify(
        `${total} tracked file${total === 1 ? "" : "s"}${stale > 0 ? ` · ${stale} stale (⚠ > 1h old read)` : ""}`,
        "info",
      );
      ctx.ui.setWidget("read-tracker", body.split("\n"));
    },
  });
}
