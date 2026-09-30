import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getVirtualModelStatus } from "@htwang-contrib/common";
import type { StatusLineComponent } from "./base.ts";

const HIDDEN_EFFORTS = new Set(["medium", "off", "minimal"]);

export class ModelInfoComponent implements StatusLineComponent {
  constructor(
    private ctx: ExtensionContext,
    private pi: ExtensionAPI,
  ) {}

  render(_width: number, theme: Theme): string[] {
    const route = getVirtualModelStatus(this.ctx);
    const model = route?.physicalModel ?? this.ctx.model;
    if (!model) return [];

    const level = route?.thinkingLevel ?? this.pi.getThinkingLevel();
    const reasoning = model.reasoning && level !== "off";

    const parts: string[] = [];

    parts.push(theme.fg("mdHeading", route ? `Auto · ${route.tier} → ${model.provider}/${model.id}` : model.name));

    if (reasoning) {
      parts.push("🧠");
      if (!HIDDEN_EFFORTS.has(level)) {
        parts.push(theme.fg("warning", level));
      }
    }

    if (!route) parts.push(theme.fg("dim", model.provider));

    return [parts.join(" ")];
  }
}
