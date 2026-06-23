import { truncateToWidth } from "@earendil-works/pi-tui";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { formatTokens, formatTokenUsageArrows } from "@htwang-contrib/common";
import type { StatusLineComponent } from "./base.ts";

export class TokensComponent implements StatusLineComponent {
  constructor(private ctx: ExtensionContext) {}

  render(width: number, theme: Theme): string[] {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;

    for (const e of this.ctx.sessionManager.getBranch()) {
      if (e.type === "message" && e.message.role === "assistant") {
        const m = e.message as AssistantMessage;
        input += m.usage.input;
        output += m.usage.output;
        cacheRead += m.usage.cacheRead;
        cacheWrite += m.usage.cacheWrite;
      }
    }

    const parts = [
      formatTokenUsageArrows(input, output),
      `R${formatTokens(cacheRead)}`,
      `W${formatTokens(cacheWrite)}`,
    ];

    return [truncateToWidth(theme.fg("dim", parts.join(" ")), width, "")];
  }
}
