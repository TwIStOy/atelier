import type { Theme } from "@earendil-works/pi-coding-agent";
import type { KeybindingsManager, KeyId, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { QueuedMessage } from "./queue.ts";

const MIN_VISIBLE = 3;

const MOVE_DELTAS: Array<[KeyId, number]> = [
  ["up", -1],
  ["k", -1],
  ["down", 1],
  ["j", 1],
  ["pageUp", -MIN_VISIBLE],
  ["-", -MIN_VISIBLE],
  ["pageDown", MIN_VISIBLE],
  ["=", MIN_VISIBLE],
];

interface QueuePanelState {
  selected: number;
  scroll: number;
}

function syncViewport(state: QueuePanelState, itemCount: number, listRows: number): void {
  state.selected = Math.max(0, Math.min(state.selected, Math.max(0, itemCount - 1)));
  if (state.selected < state.scroll) state.scroll = state.selected;
  else if (state.selected >= state.scroll + listRows) state.scroll = state.selected - listRows + 1;
  state.scroll = Math.max(0, Math.min(state.scroll, Math.max(0, itemCount - listRows)));
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
  const prefix = messageRowPrefix(index, isSelected, theme);
  const available = Math.max(1, contentWidth - visibleWidth(prefix));
  const indent = " ".repeat(visibleWidth(prefix));

  const rows: string[] = [];
  let first = true;
  for (const raw of msg.text.split("\n")) {
    for (const line of wrappedParagraph(theme, raw, isSelected, available)) {
      rows.push(messageRowLine(first, prefix, indent, line, contentWidth));
      first = false;
    }
  }
  return rows;
}

function messageRowPrefix(index: number, isSelected: boolean, theme: Theme): string {
  const bullet = isSelected ? theme.fg("accent", "▸") : " ";
  const num = theme.fg("dim", `#${index + 1}`);
  const sep = theme.fg("dim", " ");
  return `${bullet} ${num}${sep}`;
}

function wrappedParagraph(theme: Theme, raw: string, isSelected: boolean, available: number): string[] {
  const para = raw.length === 0 ? " " : raw;
  return wrapTextWithAnsi(theme.fg(isSelected ? "text" : "dim", para), available);
}

function messageRowLine(first: boolean, prefix: string, indent: string, line: string, contentWidth: number): string {
  const full = first ? `${prefix}${line}` : `${indent}${line}`;
  return `┃ ${padOrTruncate(full, contentWidth)}┃`;
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
    return isBindingConfirm(data) || isPlainConfirm(data);
  }

  function isBindingConfirm(data: string): boolean {
    return keybindings.matches(data, "tui.select.confirm") || keybindings.matches(data, "tui.input.submit");
  }

  function isPlainConfirm(data: string): boolean {
    return matchesKey(data, Key.enter) || matchesKey(data, "return") || isRawEnter(data);
  }

  function isRawEnter(data: string): boolean {
    return data === "\r" || data === "\n";
  }

  function handleInput(data: string): void {
    const msgs = getMessages();
    if (closeRequested(data, msgs.length)) {
      done({ kind: "close" });
      return;
    }
    if (moveSelection(data, msgs)) return;
    runSelectionAction(data, msgs);
  }

  function closeRequested(data: string, messageCount: number): boolean {
    if (messageCount === 0) return true;
    return matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c");
  }

  function runSelectionAction(data: string, msgs: readonly QueuedMessage[]): void {
    if (isConfirmKey(data)) {
      sendSelection(msgs);
      return;
    }
    if (matchesKey(data, "d") || matchesKey(data, "delete")) deleteSelection();
  }

  function moveSelection(data: string, msgs: readonly QueuedMessage[]): boolean {
    const delta = moveDelta(data);
    if (delta !== undefined) {
      state.selected += delta;
      return applySelectionMove();
    }
    const jump = jumpTarget(data, msgs.length);
    if (jump === undefined) return false;
    state.selected = jump;
    return applySelectionMove();
  }

  function moveDelta(data: string): number | undefined {
    for (const [key, delta] of MOVE_DELTAS) {
      if (matchesKey(data, key)) return delta;
    }
    return undefined;
  }

  function jumpTarget(data: string, messageCount: number): number | undefined {
    if (matchesKey(data, "g")) return 0;
    if (matchesKey(data, "shift+g")) return messageCount - 1;
    return undefined;
  }

  function applySelectionMove(): boolean {
    clamp();
    tui.requestRender();
    return true;
  }

  function sendSelection(msgs: readonly QueuedMessage[]): void {
    const idx = state.selected;
    if (idx >= 0 && idx < msgs.length) {
      done({ kind: "send", index: idx });
    }
  }

  function deleteSelection(): void {
    const idx = state.selected;
    const msgs = getMessages();
    if (idx < 0 || idx >= msgs.length) return;
    onDelete(idx);
    state.selected = Math.min(state.selected, getMessages().length - 1);
    clamp();
    tui.requestRender();
  }

  function render(width: number): string[] {
    const msgs = getMessages();
    if (msgs.length === 0) return [];

    const contentWidth = Math.max(0, width - 4);
    const hBorder = theme.fg("dim", "─".repeat(Math.max(0, width - 2)));

    const title = theme.fg("accent", theme.bold("Message Queue"));
    const count = theme.fg("muted", `${msgs.length} message${msgs.length === 1 ? "" : "s"}`);
    const footer = theme.fg("muted", "enter send · d delete · esc close");

    const lines: string[] = [];
    lines.push(`┌${hBorder}┐`);
    lines.push(borderedLine(`${title}  ${count}  ${footer}`, contentWidth));

    for (let i = 0; i < msgs.length; i++) {
      const rows = renderMessageRows(msgs[i]!, i, i === state.selected, contentWidth, theme);
      lines.push(...rows);
    }

    lines.push(`└${hBorder}┘`);

    return lines;
  }

  return { handleInput, invalidate() {}, render };
}
