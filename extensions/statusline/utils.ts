import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export { formatTokens, formatCwd } from "../utils/format.ts";

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
