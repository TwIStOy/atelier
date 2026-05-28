import { exec } from "node:child_process";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { StatusLineComponent } from "./base.ts";

export class GitComponent implements StatusLineComponent {
  private branch: string | null = null;
  private dirty = false;
  private refreshing = false;
  private requestRender: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private ctx: ExtensionContext) {}

  bindRender(fn: () => void) {
    this.requestRender = fn;
    this.scheduleRefresh(0);
  }

  dispose() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  private scheduleRefresh(delayMs: number) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), delayMs);
  }

  private async refresh() {
    if (this.refreshing) return;
    this.refreshing = true;

    const cwd = this.ctx.cwd;
    try {
      const [branchOut, statusOut] = await Promise.all([
        this.exec("git rev-parse --abbrev-ref HEAD", cwd),
        this.exec("git status --porcelain", cwd),
      ]);
      this.branch = branchOut?.trim() || null;
      this.dirty = (statusOut?.trim().length ?? 0) > 0;
    } catch {
      this.branch = null;
      this.dirty = false;
    }

    this.refreshing = false;
    this.requestRender?.();
    this.scheduleRefresh(5000);
  }

  private exec(cmd: string, cwd: string): Promise<string | null> {
    return new Promise((resolve) => {
      exec(cmd, { cwd, encoding: "utf-8" }, (_err, stdout) => {
        resolve(_err ? null : stdout);
      });
    });
  }

  render(_width: number, theme: Theme): string[] {
    if (!this.branch) return [];

    const marker = this.dirty
      ? theme.fg("error", "✗")
      : theme.fg("success", "✓");
    return [theme.fg("muted", this.branch) + " " + marker];
  }
}
