import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  formatTokens,
  formatProgressBar,
  usagePercentStressLevel,
} from "@htwang-contrib/common";
import type { StatusLineComponent } from "./base.ts";

export class ContextUsageComponent implements StatusLineComponent {
  constructor(private ctx: ExtensionContext) {}

  render(_width: number, theme: Theme): string[] {
    const usage = this.ctx.getContextUsage();
    if (!usage || usage.percent === null) return [];

    const pct = Math.round(usage.percent);
    const tokens = usage.tokens ?? 0;
    const contextWindow = usage.contextWindow ?? 0;

    const pctStr = `${pct}%`;
    const currentStr = formatTokens(tokens);
    const maxStr = formatTokens(contextWindow);

    const bar = formatProgressBar(pct, 10);

    const stress = usagePercentStressLevel(pct);
    const pctColor =
      stress === "high" ? "error" : stress === "medium" ? "warning" : "dim";
    return [
      theme.fg(pctColor, pctStr) +
        theme.fg("text", ` ${currentStr}${bar}${maxStr}`),
    ];
  }
}
