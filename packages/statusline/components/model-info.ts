import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { StatusLineComponent } from "./base.ts";

const HIDDEN_EFFORTS = new Set(["medium", "off", "minimal"]);

export class ModelInfoComponent implements StatusLineComponent {
    constructor(
        private ctx: ExtensionContext,
        private pi: ExtensionAPI,
    ) {}

    render(_width: number, theme: Theme): string[] {
        const model = this.ctx.model;
        if (!model) return [];

        const level = this.pi.getThinkingLevel() as string;
        const reasoning = model.reasoning && level !== "off";

        const parts: string[] = [];

        parts.push(theme.fg("mdHeading", model.name));

        if (reasoning) {
            parts.push("🧠");
            if (!HIDDEN_EFFORTS.has(level)) {
                parts.push(theme.fg("warning", level));
            }
        }

        parts.push(theme.fg("dim", model.provider));

        return [parts.join(" ")];
    }
}
