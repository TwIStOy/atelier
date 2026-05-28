export function formatTokens(n: number): string {
    if (n < 1000) return `${n}`;
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatNumber(n: number): string {
    return n.toLocaleString("en-US");
}

export function formatCwd(cwd: string): string {
    const home = process.env.HOME;
    if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
    return cwd;
}

export function formatProgressBar(usagePct: number, width: number): string {
    const pct = Math.max(0, Math.min(100, usagePct));
    const filled = Math.round((pct / 100) * width);
    const empty = width - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}
