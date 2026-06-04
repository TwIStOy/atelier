import {
  type ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  type Component,
  type OverlayOptions,
  type TUI,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { spinnerGlyph } from "@htwang-contrib/tool-display";

const BTW_OVERLAY_OPTIONS: OverlayOptions = {
  anchor: "bottom-center",
  width: "100%",
  maxHeight: "85%",
  margin: { left: 0, right: 0, bottom: 0 },
};

const ANSWER_INDENT = 4;
const BANNER_PREFIX = " /btw ";
const ECHO_PREFIX = " /btw ";
const HISTORY_PREFIX = " /btw ";

export interface BtwTurn {
  userMessage: UserMessage;
  assistantMessage: AssistantMessage;
}

export interface BtwOverlayParams {
  ctx: ExtensionCommandContext;
  question: string;
  history: BtwTurn[];
  controller: AbortController;
  onClearHistory: () => void;
}

export interface BtwOverlayResult {
  overlayPromise: Promise<void>;
  controllerReady: Promise<BtwOverlayController>;
}

type AnswerState =
  | { kind: "pending" }
  | { kind: "answer"; text: string }
  | { kind: "error"; message: string };

export class BtwOverlayController implements Component {
  private answer: AnswerState = { kind: "pending" };
  private scrollOffset = 0;
  private historyCleared = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly question: string,
    private readonly history: BtwTurn[],
    private readonly controller: AbortController,
    private readonly onClearHistory: () => void,
    private readonly done: () => void,
  ) {}

  setAnswer(text: string): void {
    this.answer = { kind: "answer", text };
    this.scrollOffset = 0;
    this.invalidate();
  }

  setError(message: string): void {
    this.answer = { kind: "error", message };
    this.scrollOffset = 0;
    this.invalidate();
  }

  render(width: number): string[] {
    const natural = this.buildNaturalLines(width);
    const maxRows = Math.floor(this.tui.terminal.rows * 0.85);

    if (natural.length <= maxRows) return natural;

    const excess = natural.length - maxRows;
    const offset = Math.min(this.scrollOffset, excess);
    return natural.slice(excess - offset, excess - offset + maxRows);
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
      return;
    }
    if (data === "x" && this.history.length > 0 && !this.historyCleared) {
      this.historyCleared = true;
      this.history.length = 0;
      this.onClearHistory();
      this.invalidate();
    }
  }

  invalidate(): void {
    this.tui.requestRender();
  }

  private buildNaturalLines(width: number): string[] {
    const lines: string[] = [];

    const bannerText = BANNER_PREFIX + this.question;
    lines.push(
      this.theme.bg(
        "selectedBg",
        truncateToWidth(bannerText, width, "…", true),
      ),
    );

    lines.push("");

    if (this.history.length > 0 && !this.historyCleared) {
      for (const turn of this.history) {
        const qText = extractShort(turn.userMessage);
        lines.push(
          this.theme.fg("dim", truncateToWidth(HISTORY_PREFIX + qText, width)),
        );
      }
    }

    lines.push(
      this.theme.fg(
        "accent",
        ECHO_PREFIX + this.theme.fg("muted", this.question),
      ),
    );

    lines.push("");

    const indent = " ".repeat(ANSWER_INDENT);
    const answerWidth = Math.max(1, width - ANSWER_INDENT);

    switch (this.answer.kind) {
      case "pending":
        lines.push(indent + spinnerGlyph(this.theme) + " Working...");
        break;
      case "answer": {
        const wrapped = wrapTextWithAnsi(this.answer.text, answerWidth);
        for (const line of wrapped) {
          lines.push(indent + line);
        }
        break;
      }
      case "error":
        lines.push(indent + this.theme.fg("error", this.answer.message));
        break;
    }

    lines.push("");

    const footerParts: string[] = [];
    footerParts.push(this.theme.fg("dim", "Esc") + " dismiss");
    if (this.history.length > 0 && !this.historyCleared) {
      footerParts.push(this.theme.fg("dim", "x") + " clear history");
    }
    if (this.answer.kind !== "pending") {
      footerParts.push(this.theme.fg("dim", "↑↓") + " scroll");
    }
    lines.push(this.theme.fg("dim", footerParts.join("  ")));

    return lines;
  }
}

export function showBtwOverlay(params: BtwOverlayParams): BtwOverlayResult {
  let resolveController!: (c: BtwOverlayController) => void;
  const controllerReady = new Promise<BtwOverlayController>(
    (resolve) => (resolveController = resolve),
  );

  const overlayPromise = params.ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      const ctrl = new BtwOverlayController(
        tui,
        theme,
        params.question,
        params.history,
        params.controller,
        params.onClearHistory,
        done,
      );
      resolveController(ctrl);
      return ctrl;
    },
    { overlay: true, overlayOptions: BTW_OVERLAY_OPTIONS },
  );

  return { overlayPromise, controllerReady };
}

function extractShort(msg: UserMessage): string {
  const text =
    typeof msg.content === "string"
      ? msg.content
      : extractMessageText(msg.content);
  const firstLine = text.split("\n")[0] ?? "";
  return firstLine.length > 60 ? firstLine.slice(0, 57) + "…" : firstLine;
}

function extractMessageText(content: UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}
