import { Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Key,
  type Component,
  type OverlayOptions,
  type TUI,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  type SubagentRunSummary,
  loadSubagentMessages,
  refreshRunRunning,
} from "./index.ts";
import {
  buildSubagentConversation,
  type SubagentConversationRenderOptions,
} from "./render.ts";

export type SubagentViewerAction = "done" | "picker";

export type SubagentViewerParams = {
  tui: TUI;
  theme: Theme;
  runs: SubagentRunSummary[];
  initialIndex: number;
  parentSessionId: string;
  renderOptions: SubagentConversationRenderOptions;
  onAction: (action: SubagentViewerAction) => void;
};

const VIEWER_OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "center",
  width: "80%",
  maxHeight: "80%",
};

export function subagentViewerOverlayOptions(): OverlayOptions {
  return VIEWER_OVERLAY_OPTIONS;
}

export class SubagentViewerOverlay implements Component {
  private scrollOffset = 0;
  private currentIndex: number;
  private body: Container;
  private bodyCache: string[] | null = null;
  private bodyCacheWidth = -1;
  private bodyEntryCount = 0;
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private stickToBottom = true;
  private lastMaxScroll = 0;

  constructor(private readonly params: SubagentViewerParams) {
    this.currentIndex = Math.max(
      0,
      Math.min(params.initialIndex, params.runs.length - 1),
    );
    this.body = this.rebuildBody();
    this.bodyEntryCount = this.body.children.length;
    this.startLiveRefresh();
  }

  dispose(): void {
    this.disposed = true;
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
  }

  /** Manually drive one live-refresh pass (also called by the interval). Exposed
   * so tests / callers can force a sync re-read of the child session. */
  tickNow(): void {
    this.tickLive();
  }

  private startLiveRefresh(): void {
    if (this.liveTimer || this.disposed) return;
    this.liveTimer = setInterval(() => this.tickLive(), 200);
  }

  private tickLive(): void {
    if (this.disposed) return;
    const run = this.params.runs[this.currentIndex];
    if (!run) return;

    const before = run.running;
    const fresh = refreshRunRunning(
      this.params.parentSessionId,
      run.subSessionFile,
    );
    if (fresh.running !== before) {
      run.running = fresh.running;
    }

    if (fresh.running) {
      const messages = loadSubagentMessages(run.subSessionFile);
      if (messages.length === 0) return;
      const conv = buildSubagentConversation(
        messages,
        this.params.renderOptions,
        this.params.tui,
        run.cwd,
      );
      if (conv.children.length !== this.bodyEntryCount) {
        this.body.clear();
        for (const child of conv.children) this.body.addChild(child);
        this.bodyEntryCount = conv.children.length;
        this.bodyCache = null;
        this.invalidate();
      } else {
        this.bodyCache = null;
        this.invalidate();
      }
    } else if (before) {
      this.rebuildAndInvalidate();
    }
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.finish("done");
      return;
    }
    if (matchesKey(data, Key.tab) || matchesKey(data, "shift+tab")) {
      this.finish("picker");
      return;
    }
    if (matchesKey(data, "t")) {
      this.params.renderOptions.hideThinkingBlock =
        !this.params.renderOptions.hideThinkingBlock;
      this.rebuildAndInvalidate();
      return;
    }
    if (matchesKey(data, "e")) {
      this.params.renderOptions.expanded = !this.params.renderOptions.expanded;
      this.rebuildAndInvalidate();
      return;
    }
    if (this.params.runs.length === 0) {
      if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
        this.invalidate();
      }
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.shift(-1);
      return;
    }
    if (matchesKey(data, Key.right)) {
      this.shift(1);
      return;
    }
    if (matchesKey(data, Key.up)) {
      this.stickToBottom = false;
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.scrollOffset += 1;
      this.syncStickFromOffset();
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.pageUp)) {
      this.stickToBottom = false;
      this.scrollOffset = Math.max(0, this.scrollOffset - 10);
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.pageDown)) {
      this.scrollOffset += 10;
      this.syncStickFromOffset();
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.home)) {
      this.stickToBottom = false;
      this.scrollOffset = 0;
      this.invalidate();
      return;
    }
    if (matchesKey(data, Key.end) || data === "g" || data === "G") {
      this.stickToBottom = true;
      this.invalidate();
      return;
    }
  }

  /** After a downward scroll, re-enable stick if we reached (or passed) the bottom. */
  private syncStickFromOffset(): void {
    if (this.scrollOffset >= this.lastMaxScroll) {
      this.stickToBottom = true;
      this.scrollOffset = this.lastMaxScroll;
    }
  }

  invalidate(): void {
    this.params.tui.requestRender();
  }

  render(width: number): string[] {
    const termCols = this.params.tui.terminal.columns;
    const termRows = this.params.tui.terminal.rows;
    const overlayWidth = Math.max(
      20,
      Math.min(width, Math.floor(termCols * 0.8)),
    );
    const overlayHeight = Math.max(8, Math.floor(termRows * 0.8));
    const innerWidth = Math.max(1, overlayWidth - 4);
    const contentHeight = Math.max(1, overlayHeight - 2);

    const headerLines = this.renderHeader(innerWidth);
    const bodyLines = this.renderBody(innerWidth);
    const footerLines = this.renderFooter(innerWidth);
    const natural = [...headerLines, ...bodyLines, ...footerLines];

    const headerLen = headerLines.length;
    const footerLen = footerLines.length;
    const maxScroll = Math.max(0, natural.length - contentHeight);
    this.lastMaxScroll = maxScroll;

    if (natural.length <= contentHeight) {
      this.scrollOffset = 0;
    } else if (this.stickToBottom) {
      this.scrollOffset = maxScroll;
    } else if (this.scrollOffset > maxScroll) {
      this.scrollOffset = maxScroll;
      this.stickToBottom = this.scrollOffset >= maxScroll;
    }
    if (this.scrollOffset < 0) this.scrollOffset = 0;

    const viewLen = Math.max(0, contentHeight - headerLen - footerLen);
    const start = headerLen + this.scrollOffset;
    const content: string[] = [
      ...headerLines,
      ...natural.slice(start, start + viewLen),
      ...footerLines,
    ];
    while (content.length < contentHeight) {
      content.splice(content.length - footerLen, 0, "");
    }

    return this.withBorder(content, innerWidth, overlayWidth);
  }

  /** Wrap content lines in a `│ … │` box with a top/bottom border. Each content
   * line is padded/truncated to innerWidth so the right border aligns. */
  private withBorder(
    content: string[],
    innerWidth: number,
    overlayWidth: number,
  ): string[] {
    const theme = this.params.theme;
    const border = theme.fg("dim", "│");
    const top =
      theme.fg("dim", "┌") +
      theme.fg("dim", "─".repeat(Math.max(0, overlayWidth - 2))) +
      theme.fg("dim", "┐");
    const bottom =
      theme.fg("dim", "└") +
      theme.fg("dim", "─".repeat(Math.max(0, overlayWidth - 2))) +
      theme.fg("dim", "┘");
    const lines = [top];
    for (const raw of content) {
      const padded = padToWidth(raw, innerWidth);
      lines.push(`${border} ${padded} ${border}`);
    }
    lines.push(bottom);
    return lines;
  }

  private renderHeader(width: number): string[] {
    const run = this.params.runs[this.currentIndex];
    const title = run ? run.label || "(untitled subagent)" : "Subagent Viewer";
    const statusTag = run?.running ? " ⏳ live" : "";
    const banner = ` Subagent output · ${title}${statusTag} `;
    const left = this.params.theme.bg(
      "selectedBg",
      truncateToWidth(banner, width, "…", true),
    );
    const lines = [left];
    if (run) {
      const meta = formatRunMeta(run, width);
      lines.push(this.params.theme.fg("dim", meta));
    } else if (this.params.runs.length === 0) {
      lines.push(
        this.params.theme.fg("muted", "No subagent runs for this session yet."),
      );
    }
    return lines;
  }

  private renderBody(width: number): string[] {
    const run = this.params.runs[this.currentIndex];
    if (!run) {
      this.bodyCache = null;
      this.bodyCacheWidth = -1;
      return [];
    }
    if (this.bodyCache == null || this.bodyCacheWidth !== width) {
      this.bodyCache = this.body.render(width);
      this.bodyCacheWidth = width;
    }
    return this.bodyCache;
  }

  private renderFooter(width: number): string[] {
    const theme = this.params.theme;
    const run = this.params.runs[this.currentIndex];
    const position = run
      ? `${this.currentIndex + 1}/${this.params.runs.length}`
      : "0/0";
    const hints: string[] = [
      theme.fg("dim", "↑↓") + theme.fg("muted", " scroll"),
      theme.fg("dim", "G") +
        theme.fg(
          "muted",
          this.stickToBottom ? " following (live)" : " jump to latest",
        ),
      theme.fg("dim", "←/→") + theme.fg("muted", " prev/next subagent"),
      theme.fg("dim", "Tab") + theme.fg("muted", " picker"),
      theme.fg("dim", "t") +
        theme.fg(
          "muted",
          this.params.renderOptions.hideThinkingBlock
            ? " show thinking"
            : " hide thinking",
        ),
      theme.fg("dim", "e") +
        theme.fg(
          "muted",
          this.params.renderOptions.expanded
            ? " collapse tools"
            : " expand tools",
        ),
      theme.fg("dim", "Esc") + theme.fg("muted", " dismiss"),
    ];
    const right = theme.fg("accent", position);
    const hintsLine = hints.join("   ");
    const combined = `${hintsLine}   ${right}`;
    return ["", theme.fg("dim", truncateToWidth(combined, width, "…", true))];
  }

  private shift(delta: number): void {
    if (this.params.runs.length <= 1) return;
    const n = this.params.runs.length;
    let next = (this.currentIndex + delta) % n;
    if (next < 0) next += n;
    if (next === this.currentIndex) return;
    this.currentIndex = next;
    this.scrollOffset = 0;
    this.stickToBottom = true;
    this.body = this.rebuildBody();
    this.bodyEntryCount = this.body.children.length;
    this.bodyCache = null;
    this.invalidate();
  }

  private rebuildBody(): Container {
    const run = this.params.runs[this.currentIndex];
    const container = new Container();
    if (!run) return container;
    const messages = loadSubagentMessages(run.subSessionFile);
    if (messages.length === 0) return container;
    const conv = buildSubagentConversation(
      messages,
      this.params.renderOptions,
      this.params.tui,
      run.cwd,
    );
    for (const child of conv.children) {
      container.addChild(child);
    }
    return container;
  }

  private rebuildAndInvalidate(): void {
    this.body = this.rebuildBody();
    this.bodyEntryCount = this.body.children.length;
    this.bodyCache = null;
    this.scrollOffset = 0;
    this.stickToBottom = true;
    this.invalidate();
  }

  private finish(action: SubagentViewerAction): void {
    this.dispose();
    this.params.onAction(action);
  }
}

function formatRunMeta(run: SubagentRunSummary, width: number): string {
  const parts: string[] = [];
  if (run.running) {
    parts.push("running…");
  } else {
    parts.push(`tools: ${run.toolCalls}`);
  }
  if (run.model) parts.push(run.model);
  if (run.thinking) parts.push(`think ${run.thinking}`);
  const when = formatRelativeTime(run.endedAt || run.startedAt);
  if (when) parts.push(when);
  const line = parts.join("   ");
  return wrapTextWithAnsi(line, Math.max(1, width)).join("\n");
}

function formatRelativeTime(iso: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  if (diffMs < 0) return "";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const d = new Date(t);
  return d.toISOString().slice(0, 10);
}

/** Pad a (possibly ANSI-styled) string with trailing spaces so its VISIBLE
 * width equals `target`, without disturbing the styling codes. Lines longer
 * than `target` visible-columns are left as-is (they were already truncated by
 * the header/footer/body renderers). */
function padToWidth(line: string, target: number): string {
  const w = visibleWidth(line);
  if (w >= target) return line;
  return line + " ".repeat(target - w);
}

export type { Component };
