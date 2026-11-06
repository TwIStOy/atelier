import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateDisplay } from "@htwang-contrib/common/format";
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

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return isObject(v) && !Array.isArray(v);
}

function optString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function optNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function optBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function parseBatchCounts(v: unknown): { ok: number; err: number } | undefined {
  if (!isPlainRecord(v)) return undefined;
  const ok = optNumber(v.ok);
  const err = optNumber(v.err);
  if (ok === undefined || err === undefined) return undefined;
  return { ok, err };
}

function parseDetails(details: unknown): SubagentStatusDetails | undefined {
  if (!isObject(details)) return undefined;
  if (typeof details.job_id !== "string" || typeof details.status !== "string") {
    return undefined;
  }
  return {
    job_id: details.job_id,
    known: details.known === true,
    status: details.status,
    mode: optString(details.mode),
    label: optString(details.label),
    ok: optBoolean(details.ok),
    error: optString(details.error),
    tool_calls: optNumber(details.tool_calls),
    batch_counts: parseBatchCounts(details.batch_counts),
    message: optString(details.message),
  };
}

function shortJobId(id: string): string {
  const t = id.trim();
  if (t.length <= 13) return t;
  return `${t.slice(0, 8)}…${t.slice(-4)}`;
}

const STATUS_WORDS: Record<string, { text: string; role: "accent" | "success" | "error" | "warning" }> = {
  running: { text: "running", role: "accent" },
  error: { text: "error", role: "error" },
  unknown: { text: "unknown", role: "warning" },
};

function statusWord(d: SubagentStatusDetails): {
  text: string;
  role: "accent" | "success" | "error" | "warning" | "muted";
} {
  if (d.status === "done") {
    return d.ok === false ? { text: "done (failed)", role: "error" } : { text: "done", role: "success" };
  }
  return STATUS_WORDS[d.status] ?? { text: d.status, role: "muted" };
}

function headerId(args: SubagentStatusArgs, d: SubagentStatusDetails | undefined): string {
  const rawId = typeof args.id === "string" ? args.id.trim() : "";
  return d ? shortJobId(d.job_id) : truncateDisplay(rawId, 36);
}

function modeSuffix(theme: Theme, d: SubagentStatusDetails): string {
  if (!d.mode) return "";
  return theme.fg("muted", " · ") + theme.fg("syntaxType", truncateDisplay(d.mode, 12));
}

function labelSuffix(theme: Theme, d: SubagentStatusDetails): string {
  if (!d.label || d.status !== "running") return "";
  return theme.fg("muted", " · ") + theme.fg("muted", truncateDisplay(d.label, 48));
}

function toolCallsSuffix(theme: Theme, d: SubagentStatusDetails): string {
  if (typeof d.tool_calls !== "number" || d.status === "running") return "";
  const w = d.tool_calls === 1 ? "tool" : "tools";
  return (
    theme.fg("muted", " · ") +
    theme.fg("muted", "calls ") +
    theme.fg("toolOutput", String(d.tool_calls)) +
    theme.fg("muted", ` ${w}`)
  );
}

function batchCountsSuffix(theme: Theme, d: SubagentStatusDetails): string {
  if (!d.batch_counts || d.status !== "done") return "";
  return (
    theme.fg("muted", " · ") +
    theme.fg("muted", truncateDisplay(`${d.batch_counts.ok} ok, ${d.batch_counts.err} err`, 28))
  );
}

const COLLAPSED_MESSAGE_ROLES: Record<string, "warning" | "error"> = {
  unknown: "warning",
  error: "error",
};

function collapsedMessage(d: SubagentStatusDetails): { text: string; role: "warning" | "error" } | undefined {
  const role = COLLAPSED_MESSAGE_ROLES[d.status];
  if (!role) return undefined;
  const text = d.status === "unknown" ? d.message : d.error;
  return text ? { text, role } : undefined;
}

export const subagentStatusAdapter: ToolDisplayAdapter<SubagentStatusArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded?: boolean) {
    const d = parseDetails(details);
    const base = `${theme.fg("toolTitle", theme.bold("Subagent status"))} ${theme.fg("accent", headerId(args, d))}`;
    if (!d) {
      return base;
    }
    const sw = statusWord(d);
    let rest = theme.fg("muted", " · ") + theme.fg(sw.role, truncateDisplay(sw.text, 24));
    rest += modeSuffix(theme, d);
    rest += labelSuffix(theme, d);
    rest += toolCallsSuffix(theme, d);
    rest += batchCountsSuffix(theme, d);
    return base + rest;
  },

  formatCollapsedContent(_args, output, theme, _width, details, _isPartial, _spinAt) {
    const d = parseDetails(details);
    const message = d ? collapsedMessage(d) : undefined;
    if (message) {
      return [theme.fg(message.role, truncateDisplay(message.text, 120))];
    }
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(_args, output, theme, width, _details) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
