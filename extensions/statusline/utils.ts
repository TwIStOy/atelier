import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function formatTokens(n: number): string {
    if (n < 1000) return `${n}`;
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatCwd(cwd: string): string {
    const home = process.env.HOME;
    if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
    return cwd;
}

export function getSessionStats(ctx: ExtensionContext) {
    let input = 0;
    let output = 0;
    let cost = 0;
    let turns = 0;
    for (const e of ctx.sessionManager.getBranch()) {
        if (e.type === "message" && e.message.role === "assistant") {
            const m = e.message as AssistantMessage;
            input += m.usage.input;
            output += m.usage.output;
            cost += m.usage.cost.total;
            turns++;
        }
    }
    return { input, output, cost, turns };
}
