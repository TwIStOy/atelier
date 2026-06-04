export function truncateDisplay(
  text: string,
  maxLen: number,
  ellipsis = "…",
): string {
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

export function formatTokenUsageSummaryLine(
  input: number,
  output: number,
  contextPercent?: number | null,
): string {
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
