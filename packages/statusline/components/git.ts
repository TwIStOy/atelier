import { execSync } from "node:child_process";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { StatusLineComponent } from "./base.ts";

export class GitComponent implements StatusLineComponent {
    constructor(private ctx: ExtensionContext) {}

    private cached: { branch: string | null; dirty: boolean } | null = null;
    private lastRefresh = 0;

    private refresh() {
        const now = Date.now();
        if (this.cached && now - this.lastRefresh < 5000) return;
        this.lastRefresh = now;

        try {
            const branch = execSync("git rev-parse --abbrev-ref HEAD", {
                cwd: this.ctx.cwd,
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
            }).trim();
            const status = execSync("git status --porcelain", {
                cwd: this.ctx.cwd,
                encoding: "utf-8",
                stdio: ["pipe", "pipe", "pipe"],
            }).trim();
            this.cached = { branch, dirty: status.length > 0 };
        } catch {
            this.cached = { branch: null, dirty: false };
        }
    }

    render(_width: number, theme: Theme): string[] {
        this.refresh();
        if (!this.cached?.branch) return [];

        const marker = this.cached.dirty
            ? theme.fg("error", "✗")
            : theme.fg("success", "✓");
        return [theme.fg("muted", this.cached.branch) + " " + marker];
    }
}
