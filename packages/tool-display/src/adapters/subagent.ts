import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
  const hasTok = hasTokenUsage(inp, out);
  const pctPart = contextPercentPart(theme, pct);
  if (!hasTok && pctPart === "") return "";
  const parts: string[] = [];
  if (hasTok) {
    parts.push(theme.fg("muted", formatTokenUsageArrows(inp ?? 0, out ?? 0)));
  }
  if (pctPart !== "") {
    parts.push(pctPart);
  }
  return theme.fg("muted", " · ") + parts.join(theme.fg("muted", " · "));
}

function hasTokenUsage(inp?: number, out?: number): boolean {
  return (typeof inp === "number" && inp > 0) || (typeof out === "number" && out > 0);
}

function contextPercentPart(theme: Theme, pct: number | null | undefined): string {
  if (pct == null) return "";
  const s = usagePercentStressLevel(pct);
  const c = s === "high" ? "error" : s === "medium" ? "warning" : "muted";
  return theme.fg(c, `${Math.round(pct)}%`);
}

const SUBAGENT_DESC_MAX = 56;

function fitRowWidth(line: string, width: number): string {
  return visibleWidth(line) <= width ? line : truncateToWidth(line, width, "…");
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
  usageExtra: string | undefined,
  maxWidth: number,
): string {
  const ct = capitalizeType(normalizeAgentType(rawType));
  const unit = count === 1 ? "tool" : "tools";
  const rawDesc = lineDescription.trim();
  const errorPart =
    ok === false && error && error.trim() ? theme.fg("error", ` — ${truncateDisplay(error.trim(), 200)}`) : "";

  const compose = (descStyled: string): string => {
    const between = descStyled === "" ? " " : ` ${descStyled} ${theme.fg("muted", "·")} `;
    return (
      statusGlyph(theme, ok, waiting, spinning, spinAt) +
      " " +
      theme.fg("syntaxType", ct) +
      between +
      theme.fg("muted", "calls ") +
      theme.fg("toolOutput", String(count)) +
      theme.fg("muted", ` ${unit}`) +
      (usageExtra ?? "") +
      errorPart
    );
  };

  if (rawDesc === "") return compose("");

  const wrapperOverhead = visibleWidth(compose(theme.fg("muted", "x"))) - 1;
  const descBudget = maxWidth - wrapperOverhead;
  if (descBudget <= 0) return compose("");
  const cap = Math.min(SUBAGENT_DESC_MAX, descBudget);
  return compose(theme.fg("muted", truncateToWidth(rawDesc, cap, "…")));
}

function formatCallSubtitle(args: SubagentArgs, theme: Theme): string {
  const desc = typeof args.description === "string" ? args.description.trim() : "";
  if (desc) return theme.fg("muted", truncateDisplay(desc, 72));
  const t = typeof args.task === "string" ? args.task.trim() : "";
  if (!t) return theme.fg("muted", "…");
  return theme.fg("muted", truncateDisplay(t, 72));
}

function validPerTaskArray<T>(arr: T[] | undefined, n: number): T[] | undefined {
  return Array.isArray(arr) && arr.length === n ? arr : undefined;
}

function countRunningFromStarted(startArr: boolean[] | undefined, n: number): number {
  const arr = validPerTaskArray(startArr, n);
  if (!arr) return 0;
  let running = 0;
  for (let i = 0; i < n; i++) {
    if (arr[i]) running++;
  }
  return running;
}

function taskRunCounts(d: SubagentDetails | undefined, n: number): { running: number; completed: number } {
  const doneArr = validPerTaskArray(d?.per_task_done, n);
  if (!doneArr) {
    return { running: countRunningFromStarted(d?.per_task_started, n), completed: 0 };
  }
  const startArr = validPerTaskArray(d?.per_task_started, n);
  let running = 0;
  let completed = 0;
  for (let i = 0; i < n; i++) {
    if (doneArr[i]) completed++;
    else if (startArr?.[i]) running++;
  }
  return { running, completed };
}

function sumNumericArray(arr: number[] | undefined): number {
  let sum = 0;
  for (const v of arr ?? []) {
    if (typeof v === "number") sum += v;
  }
  return sum;
}

function formatMultiSubagentSubtitle(args: SubagentArgs, d: SubagentDetails | undefined, theme: Theme): string {
  const n = args.tasks!.length;
  const counts = taskRunCounts(d, n);
  const base = theme.fg("accent", truncateDisplay(`${counts.running} running · ${counts.completed} done`, 72));
  const sumIn = sumNumericArray(d?.per_task_usage_input);
  const sumOut = sumNumericArray(d?.per_task_usage_output);
  const tok = sumIn > 0 || sumOut > 0 ? formatUsageSuffix(theme, sumIn, sumOut, null) : "";
  return base + tok;
}

function singleSubagentArgs(args: SubagentArgs): boolean {
  return !args.tasks || args.tasks.length <= 1;
}

type SingleSubagentStats = {
  rawType: string | undefined;
  tc: number;
  usageIn?: number;
  usageOut?: number;
  ctxPct?: number | null;
};

function formatSingleSubagentInlineStats(args: SubagentArgs, d: SubagentDetails | undefined, theme: Theme): string {
  const stats = singleSubagentStats(args, d);
  const ct = capitalizeType(normalizeAgentType(stats.rawType));
  const w = stats.tc === 1 ? "tool" : "tools";
  return (
    theme.fg("muted", " · ") +
    theme.fg("syntaxType", ct) +
    theme.fg("muted", " calls ") +
    theme.fg("toolOutput", String(stats.tc)) +
    theme.fg("muted", ` ${w}`) +
    formatUsageSuffix(theme, stats.usageIn, stats.usageOut, stats.ctxPct ?? null)
  );
}

function singleSubagentStats(args: SubagentArgs, d: SubagentDetails | undefined): SingleSubagentStats {
  if (d?.mode === "batch" && d.batch?.length === 1) return singleBatchStats(args, d.batch[0]!);
  return singlePlainStats(args, d);
}

function singleBatchStats(args: SubagentArgs, row: SubagentBatchRow): SingleSubagentStats {
  return {
    rawType: row.agent_type ?? args.tasks?.[0]?.agent_type ?? args.agent_type,
    tc: typeof row.tool_calls === "number" ? row.tool_calls : 0,
    usageIn: row.usage_input,
    usageOut: row.usage_output,
    ctxPct: row.context_percent,
  };
}

function singlePlainStats(args: SubagentArgs, d: SubagentDetails | undefined): SingleSubagentStats {
  const rawType = singleTaskAgentType(args, d);
  const tc = plainToolCallCount(args, d);
  if (!singleSubagentArgs(args)) return { rawType, tc };
  return { rawType, tc, ...plainUsageStats(d) };
}

function singleTaskAgentType(args: SubagentArgs, d: SubagentDetails | undefined): string | undefined {
  if (args.tasks?.length !== 1) return d?.agent_type ?? args.agent_type;
  return args.tasks[0]?.agent_type ?? d?.agent_type ?? args.agent_type;
}

function plainUsageStats(d: SubagentDetails | undefined): Pick<SingleSubagentStats, "usageIn" | "usageOut" | "ctxPct"> {
  return { usageIn: d?.usage_input, usageOut: d?.usage_output, ctxPct: d?.context_percent };
}

function plainToolCallCount(args: SubagentArgs, d: SubagentDetails | undefined): number {
  if (typeof d?.tool_calls === "number") return d.tool_calls;
  if (args.tasks?.length === 1 && d && Array.isArray(d.per_task_tool_calls) && d.per_task_tool_calls.length >= 1) {
    const v = d.per_task_tool_calls[0];
    return typeof v === "number" ? v : 0;
  }
  return 0;
}

function taskStartedAt(
  d: SubagentDetails | undefined,
  n: number,
  i: number,
  havePerTask: boolean,
  per: number[] | undefined,
  legacyOk: boolean,
): boolean {
  const ps = validPerTaskArray(d?.per_task_started, n);
  if (ps?.[i]) return true;
  if (startedViaToolCalls(i, havePerTask, per)) return true;
  return legacyOk && legacyTaskActive(d, i);
}

function startedViaToolCalls(i: number, havePerTask: boolean, per: number[] | undefined): boolean {
  return havePerTask && per !== undefined && (per[i] ?? 0) > 0;
}

function legacyTaskActive(d: SubagentDetails | undefined, i: number): boolean {
  return d?.task_index === i && typeof d?.tool_calls === "number";
}

function arrAt<T>(arr: T[] | undefined, i: number): T | undefined {
  return Array.isArray(arr) ? arr[i] : undefined;
}

function perTaskFlag(arr: boolean[] | undefined, n: number, i: number): boolean {
  const valid = validPerTaskArray(arr, n);
  return valid?.[i] === true;
}

function perTaskValueAt<T>(arr: T[] | undefined, n: number, i: number): T | undefined {
  const valid = validPerTaskArray(arr, n);
  return valid ? valid[i] : undefined;
}

function taskCallCount(
  d: SubagentDetails | undefined,
  i: number,
  havePerTask: boolean,
  per: number[] | undefined,
  legacyOk: boolean,
): number {
  if (havePerTask) return typeof per![i] === "number" ? per![i] : 0;
  if (legacyOk && d!.task_index === i) return d!.tool_calls!;
  return 0;
}

function formatCollapsedSubagentSummary(
  args: SubagentArgs,
  details: unknown,
  theme: Theme,
  isPartial: boolean,
  spinAt: number,
  width: number,
): string[] | null {
  const d = asSubagentDetails(details);

  const batch = batchRows(d);
  if (batch) {
    return batch.length === 1 ? null : formatBatchSummaryRows(batch, d!, args, theme, isPartial, spinAt, width);
  }

  const tasks = args.tasks;
  if (Array.isArray(tasks) && tasks.length > 1 && isPartial && !d?.batch?.length) {
    return formatPartialTasksSummary(tasks, args, d, theme, spinAt, width);
  }

  return null;
}

function asSubagentDetails(details: unknown): SubagentDetails | undefined {
  return details && typeof details === "object" ? (details as SubagentDetails) : undefined;
}

function batchRows(d: SubagentDetails | undefined): SubagentBatchRow[] | undefined {
  if (d?.mode !== "batch" || !Array.isArray(d.batch) || d.batch.length === 0) return undefined;
  return d.batch;
}

function formatBatchSummaryRows(
  batch: SubagentBatchRow[],
  d: SubagentDetails,
  args: SubagentArgs,
  theme: Theme,
  isPartial: boolean,
  spinAt: number,
  width: number,
): string[] {
  const sorted = [...batch].sort((a, b) => a.index - b.index);
  const lines: string[] = [];
  for (const item of sorted) {
    const tc = typeof item.tool_calls === "number" ? item.tool_calls : 0;
    const typ = typeForBatchRow(item, d.agent_type, args);
    const rowDesc = descriptionForBatchRow(item, args);
    const spinning = isPartial && item.ok === undefined;
    const uExtra = formatUsageSuffix(theme, item.usage_input, item.usage_output, item.context_percent);
    const row = callsLineStyled(
      theme,
      typ,
      rowDesc,
      tc,
      item.ok,
      item.error,
      false,
      spinning,
      spinAt,
      uExtra,
      Math.max(1, width),
    );
    lines.push(fitRowWidth(row, width));
  }
  return lines;
}

function formatPartialTasksSummary(
  tasks: SubagentTaskArg[],
  args: SubagentArgs,
  d: SubagentDetails | undefined,
  theme: Theme,
  spinAt: number,
  width: number,
): string[] | null {
  const n = tasks.length;
  if (d?.task_total !== undefined && d.task_total !== n) return null;
  const per = d?.per_task_tool_calls;
  const havePerTask = Array.isArray(per) && per.length === n;
  const legacyOk = legacyPerTaskDetails(d, havePerTask);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    lines.push(formatPartialTaskRow(tasks, args, d, theme, spinAt, width, { n, i, havePerTask, per, legacyOk }));
  }
  return lines;
}

function legacyPerTaskDetails(d: SubagentDetails | undefined, havePerTask: boolean): boolean {
  if (!d || havePerTask) return false;
  return typeof d.task_index === "number" && typeof d.tool_calls === "number";
}

function formatPartialTaskRow(
  tasks: SubagentTaskArg[],
  args: SubagentArgs,
  d: SubagentDetails | undefined,
  theme: Theme,
  spinAt: number,
  width: number,
  ctx: { n: number; i: number; havePerTask: boolean; per: number[] | undefined; legacyOk: boolean },
): string {
  const { n, i, havePerTask, per, legacyOk } = ctx;
  const typ = tasks[i]?.agent_type ?? args.agent_type;
  const rowDesc = tasks[i]?.description?.trim() ?? "";
  const state = taskRowState(d, n, i, havePerTask, per, legacyOk);
  const waiting = !state.started && !state.done;
  const spinning = state.started && !state.done;
  const uExtra = formatUsageSuffix(
    theme,
    arrAt(d?.per_task_usage_input, i),
    arrAt(d?.per_task_usage_output, i),
    arrAt(d?.per_task_context_percent, i),
  );
  const row = callsLineStyled(
    theme,
    typ,
    rowDesc,
    state.tc,
    state.rowOk,
    undefined,
    waiting,
    spinning,
    spinAt,
    uExtra,
    Math.max(1, width),
  );
  return fitRowWidth(row, width);
}

function taskRowState(
  d: SubagentDetails | undefined,
  n: number,
  i: number,
  havePerTask: boolean,
  per: number[] | undefined,
  legacyOk: boolean,
): { started: boolean; done: boolean; rowOk: boolean | undefined; tc: number } {
  const started = taskStartedAt(d, n, i, havePerTask, per, legacyOk);
  const done = perTaskFlag(d?.per_task_done, n, i);
  const rowOk = done ? perTaskValueAt(d?.per_task_ok, n, i) : undefined;
  const tc = taskCallCount(d, i, havePerTask, per, legacyOk);
  return { started, done, rowOk, tc };
}

export const subagentAdapter: ToolDisplayAdapter<SubagentArgs> = {
  formatCallHeader(args, theme, details, _isPartial?: boolean, _expanded?: boolean) {
    const base = `${theme.fg("toolTitle", theme.bold("Subagent"))} `;
    const d = details && typeof details === "object" ? (details as SubagentDetails) : undefined;
    if (!singleSubagentArgs(args)) {
      return base + formatMultiSubagentSubtitle(args, d, theme);
    }
    return base + formatCallSubtitle(args, theme) + formatSingleSubagentInlineStats(args, d, theme);
  },

  formatCollapsedContent(args, output, theme, width, details, isPartial, spinAt = Date.now()) {
    const fromDetails = formatCollapsedSubagentSummary(args, details, theme, isPartial === true, spinAt, width);
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
