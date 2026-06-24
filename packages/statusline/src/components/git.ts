import { exec } from "node:child_process";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { StatusLineComponent } from "./base.ts";

export class GitComponent implements StatusLineComponent {
  private branch: string | null = null;
  private dirty = false;
  private refreshing = false;
  private requestRender: (() => void) | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private cwd: string) {}

  bindRender(fn: () => void) {
    this.requestRender = fn;
    this.scheduleRefresh(0);
  }

  dispose() {
    this.disposed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private scheduleRefresh(delayMs: number) {
    if (this.disposed) return;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refresh().catch(() => {});
    }, delayMs);
  }

  private async refresh() {
    if (this.disposed) return;
    if (this.refreshing) return;
    this.refreshing = true;

    const cwd = this.cwd;
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
    if (this.disposed) return;
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

  render(width: number, theme: Theme): string[] {
    if (!this.branch) return [];

    const marker = this.dirty ? theme.fg("error", "✗") : theme.fg("success", "✓");
    const branchBudget = Math.max(0, width - visibleWidth(marker) - 1);
    const branch = truncateToWidth(this.branch, branchBudget, "…");
    return [truncateToWidth(`${theme.fg("muted", branch)} ${marker}`, width, "")];
  }
}
