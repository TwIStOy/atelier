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
