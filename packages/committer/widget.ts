import type {
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { TUI, OverlayOptions, Component } from "@earendil-works/pi-tui";
import { spinnerGlyph } from "@htwang-contrib/tool-display";
import { formatElapsedSeconds } from "@htwang-contrib/common";

const OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "bottom-center",
  width: "100%",
  maxHeight: "70%",
  margin: { left: 0, right: 0, bottom: 0 },
};

export type CommitPhase =
  | "preparing"
  | "generating"
  | "committing"
  | "done"
  | "cancelled"
  | "error";

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

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly progress: CommitterProgress,
    private readonly controller: AbortController,
    private readonly done: () => void,
  ) {}

  render(width: number): string[] {
    return this.buildLines(width);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.controller.abort();
      this.done();
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.scrollOffset += 1;
      this.invalidate();
    }
  }

  invalidate(): void {
    this.tui.requestRender();
  }

  private buildLines(width: number): string[] {
    const lines: string[] = [];
    const elapsed = formatElapsedSeconds(
      (Date.now() - this.progress.startTime) / 1000,
    );

    const banner = ` /commit  ${this.phaseLabel()}  ${elapsed}`;
    lines.push(
      this.theme.bg("selectedBg", truncateToWidth(banner, width, "…", true)),
    );
    lines.push("");

    if (this.progress.model) {
      lines.push(this.theme.fg("dim", `Model: ${this.progress.model}`));
    }

    if (this.progress.filesTotal > 0) {
      lines.push(
        this.theme.fg("dim", `Files: ${this.progress.filesTotal} changed`),
      );
    }

    if (this.progress.diffStat) {
      const statLines = this.progress.diffStat.split("\n").slice(0, 5);
      for (const sl of statLines) {
        lines.push(this.theme.fg("dim", truncateToWidth(`  ${sl}`, width)));
      }
    }

    lines.push("");

    switch (this.progress.phase) {
      case "preparing":
        lines.push("  " + spinnerGlyph(this.theme) + " Staging changes...");
        break;

      case "generating":
        lines.push(
          "  " +
            spinnerGlyph(this.theme) +
            " " +
            (this.progress.statusMessage || "Generating commit message..."),
        );
        break;

      case "committing": {
        const { commitsCompleted, commitsTotal } = this.progress;
        const prog =
          commitsTotal > 1 ? ` (${commitsCompleted}/${commitsTotal})` : "";
        lines.push(
          "  " + spinnerGlyph(this.theme) + ` Creating commit${prog}...`,
        );
        break;
      }

      case "done": {
        lines.push(this.theme.fg("accent", "  ✓ Commits created:"));
        for (const entry of this.progress.commitLog) {
          const icon = entry.success ? "✓" : "✗";
          const color = entry.success ? "accent" : "error";
          const firstLine = entry.message.split("\n")[0] ?? "";
          lines.push(
            this.theme.fg(
              color,
              `  ${icon} ${entry.hash} ${truncateToWidth(firstLine, width - 8)}`,
            ),
          );
        }
        break;
      }

      case "cancelled":
        lines.push(this.theme.fg("warning", "  ○ Cancelled"));
        break;

      case "error":
        lines.push(
          this.theme.fg(
            "error",
            `  ✗ ${this.progress.errorMessage ?? "Unknown error"}`,
          ),
        );
        break;
    }

    lines.push("");

    const footer: string[] = [this.theme.fg("dim", "Esc") + " dismiss"];
    if (this.progress.phase === "done" || this.progress.phase === "error") {
      footer.push(this.theme.fg("dim", "↑↓") + " scroll");
    }
    lines.push(this.theme.fg("dim", footer.join("  ")));

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
  const ctrlReady = new Promise<CommitterOverlayController>(
    (resolve) => (resolveCtrl = resolve),
  );

  const overlayPromise = ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      const ctrl = new CommitterOverlayController(
        tui,
        theme,
        progress,
        controller,
        done,
      );
      resolveCtrl(ctrl);
      return ctrl;
    },
    { overlay: true, overlayOptions: OVERLAY_OPTIONS },
  );

  return ctrlReady.then((ctrl) => ({ overlayPromise, ctrl }));
}
