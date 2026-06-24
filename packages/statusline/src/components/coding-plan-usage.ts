import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { CodingPlanUsage } from "@htwang-contrib/common";
import { formatProgressBar, usagePercentStressLevel, ZAI_CODING_PLAN_EVENTS } from "@htwang-contrib/common";
import type { StatusLineComponent } from "./base.ts";

const PROVIDER_ID = "zai-coding-plan";

export class CodingPlanUsageComponent implements StatusLineComponent {
  private usage: CodingPlanUsage | null = null;
  private requestRender: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private ctx: ExtensionContext,
    private pi: ExtensionAPI,
  ) {}

  bindRender(fn: () => void) {
    this.requestRender = fn;
    this.unsubscribe = this.pi.events.on(ZAI_CODING_PLAN_EVENTS.USAGE_UPDATE, (data: unknown) => {
      const d = data as { usage: CodingPlanUsage };
      this.usage = d.usage;
      this.requestRender?.();
    });
  }

  dispose() {
    this.unsubscribe?.();
  }

  render(width: number, theme: Theme): string[] {
    const model = this.ctx.model;
    if (!model || model.provider !== PROVIDER_ID) return [];
    if (!this.usage || this.usage.limits.length === 0) return [];

    const limit = this.usage.limits.find((l) => l.window === "5_hours");
    if (!limit) return [];

    const used = Math.round(limit.percentage);
    const bar = formatProgressBar(limit.percentage, 8);

    const stress = usagePercentStressLevel(used);
    const pctColor = stress === "high" ? "error" : stress === "medium" ? "warning" : "dim";

    return [
      truncateToWidth(theme.fg(pctColor, `${used}%`) + theme.fg("dim", ` ${bar} `) + theme.fg("dim", "5h"), width, ""),
    ];
  }
}
