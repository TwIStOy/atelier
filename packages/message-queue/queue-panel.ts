import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { QueuedMessage } from "./queue.ts";

const MIN_VISIBLE = 3;

interface QueuePanelState {
  selected: number;
  scroll: number;
}

function syncViewport(
  state: QueuePanelState,
  itemCount: number,
  listRows: number,
): void {
  state.selected = Math.max(
    0,
    Math.min(state.selected, Math.max(0, itemCount - 1)),
  );
  if (state.selected < state.scroll) state.scroll = state.selected;
  else if (state.selected >= state.scroll + listRows)
    state.scroll = state.selected - listRows + 1;
  state.scroll = Math.max(
    0,
    Math.min(state.scroll, Math.max(0, itemCount - listRows)),
  );
}

function padOrTruncate(text: string, width: number): string {
  const truncated = truncateToWidth(text, width, "");
  const vw = visibleWidth(truncated);
  return truncated + " ".repeat(Math.max(0, width - vw));
}

function borderedLine(content: string, contentWidth: number): string {
  return `┃ ${padOrTruncate(content, contentWidth)}┃`;
}

function renderMessageRows(
  msg: QueuedMessage,
  index: number,
  isSelected: boolean,
  contentWidth: number,
  theme: Theme,
): string[] {
  const bullet = isSelected ? theme.fg("accent", "▸") : " ";
  const num = theme.fg("dim", `#${index + 1}`);
  const sep = theme.fg("dim", " ");
  const prefix = `${bullet} ${num}${sep}`;
  const prefixW = visibleWidth(prefix);
  const available = Math.max(1, contentWidth - prefixW);
  const indent = " ".repeat(prefixW);

  const parts = msg.text.split("\n");
  const rows: string[] = [];
  let first = true;

  for (const raw of parts) {
    const para = raw.length === 0 ? " " : raw;
    const wrapped = wrapTextWithAnsi(
      theme.fg(isSelected ? "text" : "dim", para),
      available,
    );
    for (let wi = 0; wi < wrapped.length; wi++) {
      const line = wrapped[wi]!;
      const full = first && wi === 0 ? `${prefix}${line}` : `${indent}${line}`;
      rows.push(`┃ ${padOrTruncate(full, contentWidth)}┃`);
      first = false;
    }
  }
  return rows;
}

export type QueueAction = { kind: "send"; index: number } | { kind: "close" };

export function createQueuePanel(
  getMessages: () => readonly QueuedMessage[],
  onDelete: (index: number) => void,
  theme: Theme,
  tui: TUI,
  keybindings: KeybindingsManager,
  done: (result: QueueAction) => void,
) {
  const state: QueuePanelState = { selected: 0, scroll: 0 };

  function clamp(): void {
    const msgs = getMessages();
    if (msgs.length === 0) {
      done({ kind: "close" });
      return;
    }
    syncViewport(state, msgs.length, MIN_VISIBLE);
  }

  function isConfirmKey(data: string): boolean {
    return (
      keybindings.matches(data, "tui.select.confirm") ||
      keybindings.matches(data, "tui.input.submit") ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, "return") ||
      data === "\r" ||
      data === "\n"
    );
  }

  function handleInput(data: string): void {
    const msgs = getMessages();
    if (msgs.length === 0) {
      done({ kind: "close" });
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
      done({ kind: "close" });
      return;
    }

    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      state.selected -= 1;
      clamp();
      tui.requestRender();
      return;
    }

    if (matchesKey(data, "down") || matchesKey(data, "j")) {
      state.selected += 1;
      clamp();
      tui.requestRender();
      return;
    }

    if (matchesKey(data, "pageUp") || matchesKey(data, "-")) {
      state.selected -= MIN_VISIBLE;
      clamp();
      tui.requestRender();
      return;
    }

    if (matchesKey(data, "pageDown") || matchesKey(data, "=")) {
      state.selected += MIN_VISIBLE;
      clamp();
      tui.requestRender();
      return;
    }

    if (matchesKey(data, "g")) {
      state.selected = 0;
      clamp();
      tui.requestRender();
      return;
    }

    if (matchesKey(data, "shift+g")) {
      state.selected = msgs.length - 1;
      clamp();
      tui.requestRender();
      return;
    }

    if (isConfirmKey(data)) {
      const idx = state.selected;
      if (idx >= 0 && idx < msgs.length) {
        done({ kind: "send", index: idx });
      }
      return;
    }

    if (matchesKey(data, "d") || matchesKey(data, "delete")) {
      const idx = state.selected;
      if (idx >= 0 && idx < msgs.length) {
        onDelete(idx);
        state.selected = Math.min(state.selected, getMessages().length - 1);
        clamp();
        tui.requestRender();
      }
      return;
    }
  }

  function render(width: number): string[] {
    const msgs = getMessages();
    if (msgs.length === 0) return [];

    const contentWidth = Math.max(0, width - 4);
    const hBorder = theme.fg("dim", "─".repeat(Math.max(0, width - 2)));

    const title = theme.fg("accent", theme.bold("Message Queue"));
    const count = theme.fg(
      "muted",
      `${msgs.length} message${msgs.length === 1 ? "" : "s"}`,
    );
    const footer = theme.fg("muted", "enter send · d delete · esc close");

    const lines: string[] = [];
    lines.push(`┌${hBorder}┐`);
    lines.push(borderedLine(`${title}  ${count}  ${footer}`, contentWidth));

    for (let i = 0; i < msgs.length; i++) {
      const rows = renderMessageRows(
        msgs[i]!,
        i,
        i === state.selected,
        contentWidth,
        theme,
      );
      lines.push(...rows);
    }

    lines.push(`└${hBorder}┘`);

    return lines;
  }

  return { handleInput, invalidate() {}, render };
}
