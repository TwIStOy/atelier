export function truncateDisplay(text: string, maxLen: number, ellipsis = "…"): string {
  if (typeof text !== "string") return "";
  if (text.length <= maxLen) return text;
  const e = ellipsis.length;
  const take = Math.max(0, maxLen - e);
  return text.slice(0, take) + ellipsis;
}

export function shortenPath(path: string): string {
  if (typeof path !== "string") return "";
  const home = process.env.HOME;
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}

export function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatTokenUsageArrows(input: number, output: number): string {
  return `↑${formatTokens(input)} ↓${formatTokens(output)}`;
}

export type UsageStressLevel = "high" | "medium" | "low";

export function usagePercentStressLevel(percent: number): UsageStressLevel {
  if (percent > 80) return "high";
  if (percent > 50) return "medium";
  return "low";
}

export function formatTokenUsageSummaryLine(input: number, output: number, contextPercent?: number | null): string {
  let line = `Tokens: ${formatTokenUsageArrows(input, output)}`;
  if (contextPercent != null) {
    line += ` · context ${Math.round(contextPercent)}%`;
  }
  return line;
}

export function formatElapsedSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatCwd(cwd: string): string {
  return shortenPath(cwd);
}

export function formatProgressBar(usagePct: number, width: number): string {
  const pct = Math.max(0, Math.min(100, usagePct));
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

export function trimTrailingEmpty(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  return lines.slice(0, end);
}

export interface PrioritizedSegment {
  text: string;
  /** Higher values survive longer when the line must shrink. */
  priority: number;
}

export interface SegmentFitOptions {
  separator?: string;
  ellipsis?: string;
  /** Measure a segment's visible width. Defaults to character length. */
  measure?: (text: string) => number;
  /** Truncate a segment to a width. Defaults to {@link truncateDisplay}. */
  truncate?: (text: string, maxWidth: number, ellipsis: string) => string;
}

/**
 * Join prioritized segments into a single line that fits `maxWidth`, dropping
 * the lowest-priority segments first and truncating the highest-priority
 * survivor only as a last resort. Display order follows the input order.
 *
 * Provide `measure`/`truncate` when segments carry ANSI colors or wide (CJK)
 * characters — the defaults operate on raw character length.
 */
export function fitSegmentsByPriority(
  segments: readonly PrioritizedSegment[],
  maxWidth: number,
  options?: SegmentFitOptions,
): string {
  if (segments.length === 0 || maxWidth <= 0) return "";
  const separator = options?.separator ?? " | ";
  const ellipsis = options?.ellipsis ?? "…";
  const measure = options?.measure ?? ((text: string) => text.length);
  const truncate = options?.truncate ?? truncateDisplay;
  const sepWidth = measure(separator);

  const widthOf = (arr: readonly PrioritizedSegment[]) =>
    arr.reduce((sum, seg, i) => sum + measure(seg.text) + (i > 0 ? sepWidth : 0), 0);

  const included = [...segments];
  while (included.length > 1 && widthOf(included) > maxWidth) {
    let dropAt = 0;
    for (let i = 1; i < included.length; i++) {
      if (included[i].priority < included[dropAt].priority) dropAt = i;
    }
    included.splice(dropAt, 1);
  }

  if (widthOf(included) <= maxWidth) {
    return included.map((seg) => seg.text).join(separator);
  }

  return truncate(included[0].text, maxWidth, ellipsis);
}
