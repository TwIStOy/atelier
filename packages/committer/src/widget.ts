import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayOptions, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatElapsedSeconds } from "@htwang-contrib/common/format";
import { scrollKeyOffset } from "@htwang-contrib/common/scroll-keys";
import { SpinnerTimer, spinnerGlyph } from "@htwang-contrib/tool-display";

function padToVisible(line: string, width: number): string {
  const vw = visibleWidth(line);
  return vw >= width ? line : line + " ".repeat(width - vw);
}

function wrapLine(line: string, width: number): string[] {
  if (line.length === 0) return [""];
  const lines: string[] = [];
  let rest = line;
  while (visibleWidth(rest) > width) {
    lines.push(rest.slice(0, width));
    rest = rest.slice(width);
  }
  lines.push(rest);
  return lines;
}

const OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "bottom-center",
  width: "100%",
  maxHeight: "70%",
  margin: { left: 0, right: 0, bottom: 0 },
};

export type CommitPhase = "preparing" | "generating" | "committing" | "done" | "cancelled" | "error";

export interface CommitEntry {
  hash: string;
  message: string;
  success: boolean;
}

export interface CommitterProgress {
  phase: CommitPhase;
  statusMessage: string;
  model?: string;
  filesTotal: number;
  commitsCompleted: number;
  commitsTotal: number;
  commitLog: CommitEntry[];
  startTime: number;
  diffStat?: string;
  generatedMessage?: string;
  errorMessage?: string;
}

export class CommitterOverlayController implements Component {
  private scrollOffset = 0;
  private spinner: SpinnerTimer;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly progress: CommitterProgress,
    private readonly controller: AbortController,
    private readonly done: () => void,
  ) {
    this.spinner = new SpinnerTimer(() => this.tui.requestRender());
    this.spinner.start();
  }

  dispose(): void {
    this.spinner.stop();
  }

  render(width: number): string[] {
    return this.buildLines(width);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.controller.abort();
      this.done();
      return;
    }
    if (this.isTerminal && matchesKey(data, Key.enter)) {
      this.done();
      return;
    }
    const nextOffset = scrollKeyOffset(data, this.scrollOffset);
    if (nextOffset !== undefined) {
      this.scrollOffset = nextOffset;
      this.invalidate();
    }
  }

  invalidate(): void {
    this.tui.requestRender();
  }

  private get isTerminal(): boolean {
    const p = this.progress.phase;
    return p === "done" || p === "error" || p === "cancelled";
  }

  private readonly phaseBuilders: Record<CommitPhase, (innerW: number) => string[]> = {
    preparing: () => this.preparingLines(),
    generating: () => this.generatingLines(),
    committing: () => this.committingLines(),
    done: (innerW) => this.doneLines(innerW),
    cancelled: () => this.cancelledLines(),
    error: (innerW) => this.errorLines(innerW),
  };

  private buildLines(width: number): string[] {
    const innerW = Math.max(1, width - 4);
    const elapsed = formatElapsedSeconds((Date.now() - this.progress.startTime) / 1000);

    const content: string[] = [];
    content.push(this.bannerLine(innerW, elapsed));
    content.push("");
    content.push(...this.summaryLines());
    content.push(...this.diffStatLines(innerW));
    content.push("");
    content.push(...this.phaseBuilders[this.progress.phase](innerW));
    content.push("");
    content.push(this.footerLine(innerW));

    return this.frameLines(content, width, innerW);
  }

  private bannerLine(innerW: number, elapsed: string): string {
    const banner = ` /commit  ${this.phaseLabel()}  ${elapsed}`;
    return this.theme.bg("selectedBg", truncateToWidth(banner, innerW, "…", true));
  }

  private summaryLines(): string[] {
    const lines: string[] = [];
    if (this.progress.model) {
      lines.push(this.theme.fg("dim", `Model: ${this.progress.model}`));
    }

    if (this.progress.filesTotal > 0) {
      lines.push(this.theme.fg("dim", `Files: ${this.progress.filesTotal} changed`));
    }
    return lines;
  }

  private diffStatLines(innerW: number): string[] {
    if (!this.progress.diffStat) return [];
    const lines: string[] = [];
    for (const sl of this.progress.diffStat.split("\n").slice(0, 5)) {
      lines.push(this.theme.fg("dim", truncateToWidth(`  ${sl}`, innerW)));
    }
    return lines;
  }

  private preparingLines(): string[] {
    return [`  ${spinnerGlyph(this.theme)} Staging changes...`];
  }

  private generatingLines(): string[] {
    return [`  ${spinnerGlyph(this.theme)} ${this.progress.statusMessage || "Generating commit message..."}`];
  }

  private committingLines(): string[] {
    const { commitsCompleted, commitsTotal } = this.progress;
    const prog = commitsTotal > 1 ? ` (${commitsCompleted}/${commitsTotal})` : "";
    return [`  ${spinnerGlyph(this.theme)} Creating commit${prog}...`];
  }

  private doneLines(innerW: number): string[] {
    const lines: string[] = [this.theme.fg("accent", "  ✓ Commits created:")];
    for (const entry of this.progress.commitLog) {
      lines.push(this.commitEntryLine(entry, innerW));
    }
    return lines;
  }

  private commitEntryLine(entry: CommitEntry, innerW: number): string {
    const icon = entry.success ? "✓" : "✗";
    const color = entry.success ? "accent" : "error";
    const firstLine = entry.message.split("\n")[0] ?? "";
    return this.theme.fg(color, `  ${icon} ${entry.hash} ${truncateToWidth(firstLine, innerW - 8)}`);
  }

  private cancelledLines(): string[] {
    return [this.theme.fg("warning", "  ○ Cancelled")];
  }

  private errorLines(innerW: number): string[] {
    const msg = this.progress.errorMessage ?? "Unknown error";
    const errLines = msg.split("\n").flatMap((l) => wrapLine(l, innerW - 4));
    const lines: string[] = [];
    for (const [i, l] of errLines.entries()) {
      lines.push(this.theme.fg("error", i === 0 ? `  ✗ ${l}` : `    ${l}`));
    }
    return lines;
  }

  private footerLine(innerW: number): string {
    const footer: string[] = [`${this.theme.fg("dim", "Esc")} dismiss`];
    if (this.isTerminal) {
      footer.push(`${this.theme.fg("dim", "Enter")} close`);
      footer.push(`${this.theme.fg("dim", "↑↓")} scroll`);
    }
    return this.theme.fg("dim", truncateToWidth(footer.join("  "), innerW));
  }

  private frameLines(content: string[], width: number, innerW: number): string[] {
    const dim = (s: string) => this.theme.fg("dim", s);
    const hBorder = dim("─".repeat(Math.max(0, width - 2)));
    const vBar = dim("│");
    const lines: string[] = [`${dim("┌")}${hBorder}${dim("┐")}`];
    for (const c of content) {
      lines.push(`${vBar} ${padToVisible(c, innerW)} ${vBar}`);
    }
    lines.push(`${dim("└")}${hBorder}${dim("┘")}`);
    return lines;
  }

  private phaseLabel(): string {
    switch (this.progress.phase) {
      case "preparing":
        return "Preparing";
      case "generating":
        return "Generating";
      case "committing":
        return "Committing";
      case "done":
        return "Done";
      case "cancelled":
        return "Cancelled";
      case "error":
        return "Error";
    }
  }
}

export function showCommitterOverlay(
  ctx: ExtensionCommandContext,
  progress: CommitterProgress,
  controller: AbortController,
): Promise<{
  overlayPromise: Promise<void>;
  ctrl: CommitterOverlayController;
}> {
  let resolveCtrl!: (c: CommitterOverlayController) => void;
  const ctrlReady = new Promise<CommitterOverlayController>((resolve) => {
    resolveCtrl = resolve;
  });

  const overlayPromise = ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      const ctrl = new CommitterOverlayController(tui, theme, progress, controller, done);
      resolveCtrl(ctrl);
      return ctrl;
    },
    { overlay: true, overlayOptions: OVERLAY_OPTIONS },
  );

  return ctrlReady.then((ctrl) => ({ overlayPromise, ctrl }));
}
