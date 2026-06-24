import type { Theme } from "@earendil-works/pi-coding-agent";
import { formatTokenUsageArrows, truncateDisplay, usagePercentStressLevel } from "@htwang-contrib/common";
import { spinnerGlyph } from "../format.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, formatLineCount } from "./shared.ts";

interface SubagentTaskArg {
  task?: string;
  agent_type?: string;
  description?: string;
}

interface SubagentArgs {
  task?: string;
  tasks?: SubagentTaskArg[];
  agent_type?: string;
  description?: string;
}

type SubagentBatchRow = {
  index: number;
  tool_calls?: number;
  agent_type?: string;
  description?: string;
  ok?: boolean;
  error?: string;
  usage_input?: number;
  usage_output?: number;
  context_percent?: number | null;
};

type SubagentDetails = {
  tool_calls?: number;
  mode?: "single" | "batch";
  task_index?: number;
  task_total?: number;
  per_task_tool_calls?: number[];
  per_task_started?: boolean[];
  per_task_done?: boolean[];
  per_task_ok?: boolean[];
  per_task_usage_input?: number[];
  per_task_usage_output?: number[];
  per_task_context_percent?: (number | null)[];
  batch?: SubagentBatchRow[];
  agent_type?: string;
  description?: string;
  ok?: boolean;
  error?: string;
  usage_input?: number;
  usage_output?: number;
  context_percent?: number | null;
};

function normalizeAgentType(raw: string | undefined): string {
  const t = raw?.trim().toLowerCase();
  if (t && t.length > 0) return t;
  return "general-purpose";
}

function capitalizeType(type: string): string {
  const t = type.trim();
  if (!t) return "Default";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

function typeForBatchRow(item: SubagentBatchRow, fallback: string | undefined, args: SubagentArgs): string {
  if (item.agent_type) return normalizeAgentType(item.agent_type);
  if (fallback) return normalizeAgentType(fallback);
  const fromArgs = args.tasks?.[item.index]?.agent_type ?? args.agent_type;
  return normalizeAgentType(fromArgs);
}

function descriptionForBatchRow(item: SubagentBatchRow, args: SubagentArgs): string {
  const fromItem = item.description?.trim();
  if (fromItem) return fromItem;
  return args.tasks?.[item.index]?.description?.trim() ?? "";
}

const NF_MD_TIMER_SAND = String.fromCodePoint(0xf051f);

function statusGlyph(
  theme: Theme,
  ok: boolean | undefined,
  waiting: boolean,
  spinning: boolean,
  spinAt?: number,
): string {
  if (ok === false) return theme.fg("error", "✗");
  if (ok === true) return theme.fg("success", "✓");
  if (waiting) return theme.fg("muted", NF_MD_TIMER_SAND);
  if (spinning) return spinnerGlyph(theme, spinAt ?? Date.now());
  return theme.fg("muted", "○");
}

function formatUsageSuffix(theme: Theme, inp?: number, out?: number, pct?: number | null): string {
  const hasTok = (typeof inp === "number" && inp > 0) || (typeof out === "number" && out > 0);
  if (!hasTok && (pct === undefined || pct === null)) return "";
  const parts: string[] = [];
  if (hasTok) {
    parts.push(theme.fg("muted", formatTokenUsageArrows(inp ?? 0, out ?? 0)));
  }
  if (pct != null) {
    const s = usagePercentStressLevel(pct);
    const c = s === "high" ? "error" : s === "medium" ? "warning" : "muted";
    parts.push(theme.fg(c, `${Math.round(pct)}%`));
  }
  return theme.fg("muted", " · ") + parts.join(theme.fg("muted", " · "));
}

function callsLineStyled(
  theme: Theme,
  rawType: string | undefined,
  lineDescription: string,
  count: number,
  ok: boolean | undefined,
  error: string | undefined,
  waiting: boolean,
  spinning: boolean,
  spinAt: number | undefined,
  usageExtra?: string,
): string {
  const ct = capitalizeType(normalizeAgentType(rawType));
  const w = count === 1 ? "tool" : "tools";
  const desc = lineDescription.trim();
  const betweenTypeAndCalls =
    desc === "" ? " " : ` ${theme.fg("muted", truncateDisplay(desc, 56))} ${theme.fg("muted", "·")} `;
  let line =
    statusGlyph(theme, ok, waiting, spinning, spinAt) +
    " " +
    theme.fg("syntaxType", ct) +
    betweenTypeAndCalls +
    theme.fg("muted", "calls ") +
    theme.fg("toolOutput", String(count)) +
    theme.fg("muted", ` ${w}`);
  if (usageExtra) line += usageExtra;
  if (ok === false && error && error.trim()) {
    line += theme.fg("error", ` — ${truncateDisplay(error.trim(), 200)}`);
  }
  return line;
}

function formatCallSubtitle(args: SubagentArgs, theme: Theme): string {
  const desc = typeof args.description === "string" ? args.description.trim() : "";
  if (desc) return theme.fg("muted", truncateDisplay(desc, 72));
  const t = typeof args.task === "string" ? args.task.trim() : "";
  if (!t) return theme.fg("muted", "…");
  return theme.fg("muted", truncateDisplay(t, 72));
}

function formatMultiSubagentSubtitle(args: SubagentArgs, d: SubagentDetails | undefined, theme: Theme): string {
  const n = args.tasks!.length;
  const doneArr = d?.per_task_done;
  const startArr = d?.per_task_started;
  let running = 0;
  let completed = 0;
  if (Array.isArray(doneArr) && doneArr.length === n) {
    for (let i = 0; i < n; i++) {
      if (doneArr[i]) completed++;
      else if (Array.isArray(startArr) && startArr.length === n && startArr[i]) running++;
    }
  } else if (Array.isArray(startArr) && startArr.length === n) {
    for (let i = 0; i < n; i++) {
      if (startArr[i]) running++;
    }
  }
  const base = theme.fg("accent", truncateDisplay(`${running} running · ${completed} done`, 72));
  let sumIn = 0;
  let sumOut = 0;
  for (const v of d?.per_task_usage_input ?? []) {
    if (typeof v === "number") sumIn += v;
  }
  for (const v of d?.per_task_usage_output ?? []) {
    if (typeof v === "number") sumOut += v;
  }
  const tok = sumIn > 0 || sumOut > 0 ? formatUsageSuffix(theme, sumIn, sumOut, null) : "";
  return base + tok;
}

function singleSubagentArgs(args: SubagentArgs): boolean {
  return !args.tasks || args.tasks.length <= 1;
}

function formatSingleSubagentInlineStats(args: SubagentArgs, d: SubagentDetails | undefined, theme: Theme): string {
  let rawType: string | undefined;
  let tc = 0;
  let usageIn: number | undefined;
  let usageOut: number | undefined;
  let ctxPct: number | null | undefined;
  if (d?.mode === "batch" && d.batch?.length === 1) {
    const row = d.batch[0]!;
    rawType = row.agent_type ?? args.tasks?.[0]?.agent_type ?? args.agent_type;
    tc = typeof row.tool_calls === "number" ? row.tool_calls : 0;
    usageIn = row.usage_input;
    usageOut = row.usage_output;
    ctxPct = row.context_percent;
  } else {
    rawType =
      args.tasks?.length === 1
        ? (args.tasks[0]?.agent_type ?? d?.agent_type ?? args.agent_type)
        : (d?.agent_type ?? args.agent_type);
    if (typeof d?.tool_calls === "number") tc = d.tool_calls;
    else if (
      args.tasks?.length === 1 &&
      d &&
      Array.isArray(d.per_task_tool_calls) &&
      d.per_task_tool_calls.length >= 1
    ) {
      const v = d.per_task_tool_calls[0];
      tc = typeof v === "number" ? v : 0;
    }
    if (!args.tasks || args.tasks.length <= 1) {
      usageIn = d?.usage_input;
      usageOut = d?.usage_output;
      ctxPct = d?.context_percent;
    }
  }
  const ct = capitalizeType(normalizeAgentType(rawType));
  const w = tc === 1 ? "tool" : "tools";
  return (
    theme.fg("muted", " · ") +
    theme.fg("syntaxType", ct) +
    theme.fg("muted", " calls ") +
    theme.fg("toolOutput", String(tc)) +
    theme.fg("muted", ` ${w}`) +
    formatUsageSuffix(theme, usageIn, usageOut, ctxPct ?? null)
  );
}

function taskStartedAt(
  d: SubagentDetails | undefined,
  n: number,
  i: number,
  havePerTask: boolean,
  per: number[] | undefined,
  legacyOk: boolean,
): boolean {
  const ps = d?.per_task_started;
  if (Array.isArray(ps) && ps.length === n && ps[i]) return true;
  if (havePerTask && per && (per[i] ?? 0) > 0) return true;
  if (legacyOk && d && typeof d.task_index === "number" && d.task_index === i && typeof d.tool_calls === "number") {
    return true;
  }
  return false;
}

function formatCollapsedSubagentSummary(
  args: SubagentArgs,
  details: unknown,
  theme: Theme,
  isPartial: boolean,
  spinAt: number,
): string[] | null {
  const d = details && typeof details === "object" ? (details as SubagentDetails) : undefined;

  if (d?.mode === "batch" && Array.isArray(d.batch) && d.batch.length > 0) {
    if (d.batch.length === 1) return null;
    const sorted = [...d.batch].sort((a, b) => a.index - b.index);
    const n = sorted.length;
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      const item = sorted[i];
      const last = i === n - 1;
      const branch = last ? "└" : "├";
      const tc = typeof item.tool_calls === "number" ? item.tool_calls : 0;
      const typ = typeForBatchRow(item, d.agent_type, args);
      const rowDesc = descriptionForBatchRow(item, args);
      const waiting = false;
      const spinning = isPartial && item.ok === undefined;
      const uExtra = formatUsageSuffix(theme, item.usage_input, item.usage_output, item.context_percent);
      lines.push(
        theme.fg("muted", `${branch} `) +
          callsLineStyled(theme, typ, rowDesc, tc, item.ok, item.error, waiting, spinning, spinAt, uExtra),
      );
    }
    return lines;
  }

  const tasks = args.tasks;
  if (Array.isArray(tasks) && tasks.length > 1 && isPartial && (!d || !d.batch?.length)) {
    const n = tasks.length;
    if (d?.task_total !== undefined && d.task_total !== n) return null;
    const per = d?.per_task_tool_calls;
    const havePerTask = Array.isArray(per) && per.length === n;
    const legacyOk =
      Boolean(d) && !havePerTask && typeof d!.task_index === "number" && typeof d!.tool_calls === "number";
    const pin = d?.per_task_usage_input;
    const pout = d?.per_task_usage_output;
    const ppct = d?.per_task_context_percent;
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      const branch = last ? "└" : "├";
      const typ = tasks[i]?.agent_type ?? args.agent_type;
      const rowDesc = tasks[i]?.description?.trim() ?? "";
      const started = taskStartedAt(d, n, i, havePerTask, per, legacyOk);
      const pDone = d?.per_task_done;
      const done = Array.isArray(pDone) && pDone.length === n && pDone[i] === true;
      let rowOk: boolean | undefined;
      const pOk = d?.per_task_ok;
      if (done && Array.isArray(pOk) && pOk.length === n) {
        rowOk = pOk[i];
      }
      const waiting = isPartial && !started && !done;
      const spinning = isPartial && started && !done;
      const tc = havePerTask
        ? typeof per![i] === "number"
          ? per![i]
          : 0
        : legacyOk && d!.task_index === i
          ? d!.tool_calls!
          : 0;
      const uExtra = formatUsageSuffix(
        theme,
        Array.isArray(pin) ? pin[i] : undefined,
        Array.isArray(pout) ? pout[i] : undefined,
        Array.isArray(ppct) ? ppct[i] : undefined,
      );
      lines.push(
        theme.fg("muted", `${branch} `) +
          callsLineStyled(theme, typ, rowDesc, tc, rowOk, undefined, waiting, spinning, spinAt, uExtra),
      );
    }
    return lines;
  }

  if (singleSubagentArgs(args)) return null;

  return null;
}

export const subagentAdapter: ToolDisplayAdapter<SubagentArgs> = {
  formatCallHeader(args, theme, details, _isPartial?: boolean, _expanded?: boolean) {
    const base = theme.fg("toolTitle", theme.bold("Subagent")) + " ";
    const d = details && typeof details === "object" ? (details as SubagentDetails) : undefined;
    if (!singleSubagentArgs(args)) {
      return base + formatMultiSubagentSubtitle(args, d, theme);
    }
    return base + formatCallSubtitle(args, theme) + formatSingleSubagentInlineStats(args, d, theme);
  },

  formatCollapsedContent(args, output, theme, _width, details, isPartial, spinAt = Date.now()) {
    const fromDetails = formatCollapsedSubagentSummary(args, details, theme, isPartial === true, spinAt);
    if (fromDetails !== null) return fromDetails;
    if (singleSubagentArgs(args)) return [];
    if (isPartial) return [];
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
