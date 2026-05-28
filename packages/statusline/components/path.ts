import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { StatusLineComponent } from "./base.ts";

export class PathComponent implements StatusLineComponent {
    constructor(private ctx: ExtensionContext) {}

    render(_width: number, theme: Theme): string[] {
        const cwd = this.ctx.cwd;
        const home = process.env.HOME;
        const display = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;

        const segments = display.split("/").filter(Boolean);
        const tail = segments.slice(-3);
        const prefix = segments.length > 3 ? "…/" : "";

        const parent = prefix + tail.slice(0, -1).join("/");
        const current = tail[tail.length - 1];

        return [theme.fg("dim", parent ? parent + "/" : "") + theme.fg("accent", current)];
    }
}
