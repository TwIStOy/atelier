import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { buildReadRows, renderReadTrackerTable, summarizeRows } from "./display.ts";
import { ReadTracker } from "./read-tracker.ts";

const WRITE_LIKE_TOOLS = new Set(["edit", "write"]);

function extractPath(input: Record<string, unknown>): string | null {
  const candidate = input.path ?? input.filePath;
  return typeof candidate === "string" ? candidate : null;
}

function recordReadEvent(tracker: ReadTracker, event: ToolCallEvent): boolean {
  if (!isToolCallEventType("read", event)) return false;
  tracker.record(event.input.path);
  return true;
}

function checkWriteLikeTool(tracker: ReadTracker, event: ToolCallEvent): ToolCallEventResult | undefined {
  if (!WRITE_LIKE_TOOLS.has(event.toolName)) return undefined;
  const p = extractPath(event.input);
  if (p === null) return undefined;
  const result = tracker.check(p);
  if (result) return { block: true, reason: result.reason };
  return undefined;
}

function normalizeCommandArgs(args: string | undefined): string {
  return (args ?? "").trim().toLowerCase();
}

function clearTrackedFiles(tracker: ReadTracker, ctx: ExtensionCommandContext): void {
  const n = tracker.paths().length;
  tracker.clear();
  ctx.ui.notify(`Cleared ${n} tracked file${n === 1 ? "" : "s"}.`, "info");
}

function showTrackedCount(tracker: ReadTracker, ctx: ExtensionCommandContext): void {
  const { total } = summarizeRows(buildReadRows(tracker.entries()));
  ctx.ui.notify(`${total} tracked file${total === 1 ? "" : "s"}.`, "info");
}

function showTrackedTable(tracker: ReadTracker, ctx: ExtensionCommandContext): void {
  const rows = buildReadRows(tracker.entries());
  const { total, stale } = summarizeRows(rows);
  const body = renderReadTrackerTable(rows);
  ctx.ui.notify(
    `${total} tracked file${total === 1 ? "" : "s"}${stale > 0 ? ` · ${stale} stale (⚠ > 1h old read)` : ""}`,
    "info",
  );
  ctx.ui.setWidget("read-tracker", body.split("\n"));
}

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("read-tracker")) return;
  const tracker = new ReadTracker();

  pi.on("tool_call", async (event) => {
    if (recordReadEvent(tracker, event)) return;
    return checkWriteLikeTool(tracker, event);
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
      const trimmed = normalizeCommandArgs(args);
      if (trimmed === "clear") {
        clearTrackedFiles(tracker, ctx);
        return;
      }
      if (trimmed === "count") {
        showTrackedCount(tracker, ctx);
        return;
      }
      if (trimmed !== "") {
        ctx.ui.notify(`Unknown argument: ${args}. Usage: /read-tracker [clear|count]`, "warning");
        return;
      }
      showTrackedTable(tracker, ctx);
    },
  });
}
