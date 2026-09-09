import { truncateDisplay } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, formatLineCount } from "./shared.ts";

interface SubagentStatusArgs {
  id?: string;
}

type SubagentStatusDetails = {
  job_id: string;
  known: boolean;
  status: string;
  mode?: string;
  label?: string;
  ok?: boolean;
  error?: string;
  tool_calls?: number;
  batch_counts?: { ok: number; err: number };
  message?: string;
};

function parseDetails(details: unknown): SubagentStatusDetails | undefined {
  if (!details || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>;
  if (typeof d.job_id !== "string" || typeof d.status !== "string") {
    return undefined;
  }
  const bcRaw = d.batch_counts;
  let batch_counts: { ok: number; err: number } | undefined;
  if (
    bcRaw &&
    typeof bcRaw === "object" &&
    !Array.isArray(bcRaw) &&
    typeof (bcRaw as { ok?: unknown }).ok === "number" &&
    typeof (bcRaw as { err?: unknown }).err === "number"
  ) {
    batch_counts = {
      ok: (bcRaw as { ok: number }).ok,
      err: (bcRaw as { err: number }).err,
    };
  }
  return {
    job_id: d.job_id,
    known: d.known === true,
    status: d.status,
    mode: typeof d.mode === "string" ? d.mode : undefined,
    label: typeof d.label === "string" ? d.label : undefined,
    ok: typeof d.ok === "boolean" ? d.ok : undefined,
    error: typeof d.error === "string" ? d.error : undefined,
    tool_calls: typeof d.tool_calls === "number" ? d.tool_calls : undefined,
    batch_counts,
    message: typeof d.message === "string" ? d.message : undefined,
  };
}

function shortJobId(id: string): string {
  const t = id.trim();
  if (t.length <= 13) return t;
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

function statusWord(d: SubagentStatusDetails): {
  text: string;
  role: "accent" | "success" | "error" | "warning" | "muted";
} {
  switch (d.status) {
    case "running":
      return { text: "running", role: "accent" };
    case "done":
      if (d.ok === false) return { text: "done (failed)", role: "error" };
      return { text: "done", role: "success" };
    case "error":
      return { text: "error", role: "error" };
    case "unknown":
      return { text: "unknown", role: "warning" };
    default:
      return { text: d.status, role: "muted" };
  }
}

export const subagentStatusAdapter: ToolDisplayAdapter<SubagentStatusArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded?: boolean) {
    const d = parseDetails(details);
    const rawId = typeof args.id === "string" ? args.id.trim() : "";
    const idShow = d ? shortJobId(d.job_id) : truncateDisplay(rawId, 36);
    const base = `${theme.fg("toolTitle", theme.bold("Subagent status"))} ${theme.fg("accent", idShow)}`;
    if (!d) {
      return base;
    }
    const sw = statusWord(d);
    let rest = theme.fg("muted", " · ") + theme.fg(sw.role, truncateDisplay(sw.text, 24));
    if (d.mode) {
      rest += theme.fg("muted", " · ") + theme.fg("syntaxType", truncateDisplay(d.mode, 12));
    }
    if (d.label && d.status === "running") {
      rest += theme.fg("muted", " · ") + theme.fg("muted", truncateDisplay(d.label, 48));
    }
    if (typeof d.tool_calls === "number" && d.status !== "running") {
      const w = d.tool_calls === 1 ? "tool" : "tools";
      rest +=
        theme.fg("muted", " · ") +
        theme.fg("muted", "calls ") +
        theme.fg("toolOutput", String(d.tool_calls)) +
        theme.fg("muted", ` ${w}`);
    }
    if (d.batch_counts && d.status === "done") {
      rest +=
        theme.fg("muted", " · ") +
        theme.fg("muted", truncateDisplay(`${d.batch_counts.ok} ok, ${d.batch_counts.err} err`, 28));
    }
    return base + rest;
  },

  formatCollapsedContent(_args, output, theme, _width, details, _isPartial, _spinAt) {
    const d = parseDetails(details);
    if (d) {
      const parts: string[] = [];
      if (d.status === "unknown" && d.message) {
        parts.push(theme.fg("warning", truncateDisplay(d.message, 120)));
      } else if (d.status === "error" && d.error) {
        parts.push(theme.fg("error", truncateDisplay(d.error, 120)));
      }
      if (parts.length > 0) {
        return [parts[0]];
      }
    }
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(_args, output, theme, width, _details) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
