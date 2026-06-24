import { matchesKey } from "@earendil-works/pi-tui";
import type { InlineEditChar, InlineEditState } from "../types.ts";

function inlineEditChars(text: string): InlineEditChar[] {
  const out: InlineEditChar[] = [];
  let offset = 0;
  for (const ch of text) {
    const start = offset;
    offset += ch.length;
    out.push({ ch, start, end: offset });
  }
  return out;
}

function clampCursor(editing: InlineEditState): void {
  editing.cursor = Math.max(0, Math.min(editing.cursor, editing.buffer.length));
}

function codeUnitToCharIndex(chars: InlineEditChar[], cursor: number): number {
  let index = 0;
  while (index < chars.length && chars[index]!.end <= cursor) index += 1;
  return index;
}

function charIndexToCodeUnit(chars: InlineEditChar[], index: number, textLength: number): number {
  if (index <= 0) return 0;
  if (index >= chars.length) return textLength;
  return chars[index]!.start;
}

function charKind(ch: string): "space" | "word" | "punct" {
  if (/\s/u.test(ch)) return "space";
  if (/[A-Za-z0-9_]/.test(ch)) return "word";
  return "punct";
}

function moveByChars(editing: InlineEditState, delta: number): void {
  const chars = inlineEditChars(editing.buffer);
  const index = codeUnitToCharIndex(chars, editing.cursor);
  editing.cursor = charIndexToCodeUnit(chars, index + delta, editing.buffer.length);
}

function moveWordLeft(editing: InlineEditState): void {
  const chars = inlineEditChars(editing.buffer);
  let index = codeUnitToCharIndex(chars, editing.cursor);
  while (index > 0 && charKind(chars[index - 1]!.ch) === "space") index -= 1;
  if (index <= 0) {
    editing.cursor = 0;
    return;
  }
  const kind = charKind(chars[index - 1]!.ch);
  while (index > 0 && charKind(chars[index - 1]!.ch) === kind) index -= 1;
  editing.cursor = charIndexToCodeUnit(chars, index, editing.buffer.length);
}

function moveWordRight(editing: InlineEditState): void {
  const chars = inlineEditChars(editing.buffer);
  let index = codeUnitToCharIndex(chars, editing.cursor);
  while (index < chars.length && charKind(chars[index]!.ch) === "space") index += 1;
  if (index >= chars.length) {
    editing.cursor = editing.buffer.length;
    return;
  }
  const kind = charKind(chars[index]!.ch);
  while (index < chars.length && charKind(chars[index]!.ch) === kind) index += 1;
  editing.cursor = charIndexToCodeUnit(chars, index, editing.buffer.length);
}

function insertText(editing: InlineEditState, text: string): void {
  clampCursor(editing);
  editing.buffer = `${editing.buffer.slice(0, editing.cursor)}${text}${editing.buffer.slice(editing.cursor)}`;
  editing.cursor += text.length;
}

function deleteRange(editing: InlineEditState, start: number, end: number): void {
  const safeStart = Math.max(0, Math.min(start, editing.buffer.length));
  const safeEnd = Math.max(safeStart, Math.min(end, editing.buffer.length));
  editing.buffer = `${editing.buffer.slice(0, safeStart)}${editing.buffer.slice(safeEnd)}`;
  editing.cursor = safeStart;
}

function isPlainInput(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\x7f";
}

export function handleInlineEditInput(editing: InlineEditState, data: string): boolean {
  clampCursor(editing);
  if (matchesKey(data, "left") || matchesKey(data, "ctrl+b")) {
    moveByChars(editing, -1);
    return true;
  }
  if (matchesKey(data, "right") || matchesKey(data, "ctrl+f")) {
    moveByChars(editing, 1);
    return true;
  }
  if (matchesKey(data, "alt+left") || matchesKey(data, "ctrl+left") || matchesKey(data, "alt+b")) {
    moveWordLeft(editing);
    return true;
  }
  if (matchesKey(data, "alt+right") || matchesKey(data, "ctrl+right") || matchesKey(data, "alt+f")) {
    moveWordRight(editing);
    return true;
  }
  if (matchesKey(data, "home") || matchesKey(data, "ctrl+a")) {
    editing.cursor = 0;
    return true;
  }
  if (matchesKey(data, "end") || matchesKey(data, "ctrl+e")) {
    editing.cursor = editing.buffer.length;
    return true;
  }
  if (matchesKey(data, "backspace")) {
    const before = editing.cursor;
    moveByChars(editing, -1);
    deleteRange(editing, editing.cursor, before);
    return true;
  }
  if (matchesKey(data, "delete") || matchesKey(data, "ctrl+d")) {
    const start = editing.cursor;
    moveByChars(editing, 1);
    deleteRange(editing, start, editing.cursor);
    return true;
  }
  if (matchesKey(data, "ctrl+u")) {
    editing.buffer = "";
    editing.cursor = 0;
    return true;
  }
  if (isPlainInput(data)) {
    insertText(editing, data);
    return true;
  }
  return false;
}

export function parseSettingInput(item: import("@htwang-contrib/common").ConfigItem, input: string): unknown {
  switch (item.type) {
    case "boolean": {
      const lower = input.trim().toLowerCase();
      if (["true", "yes", "on", "1", "enabled"].includes(lower)) return true;
      if (["false", "no", "off", "0", "disabled"].includes(lower)) return false;
      throw new Error("Expected boolean: true/false, on/off, yes/no");
    }
    case "number": {
      const parsed = Number(input.trim());
      if (!Number.isFinite(parsed)) throw new Error("Expected a number");
      return parsed;
    }
    case "select": {
      const value = input.trim();
      const rawOpts = (item as import("@htwang-contrib/common").SelectConfigItem).options;
      const opts = typeof rawOpts === "function" ? rawOpts() : rawOpts;
      const matched = opts.find((o) => o.label.toLowerCase() === value.toLowerCase());
      if (matched) return matched.value;
      const byValue = opts.find((o) => String(o.value).toLowerCase() === value.toLowerCase());
      if (byValue) return byValue.value;
      throw new Error(`Expected one of: ${opts.map((o) => o.label).join(", ")}`);
    }
    case "multiselect":
    case "reorderable":
      throw new Error("Use the option picker for this setting");
    case "color": {
      const trimmed = input.trim();
      if (trimmed && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(trimmed))
        throw new Error("Expected a hex color (e.g. #ff6600 or #f60)");
      return trimmed;
    }
    case "string":
      return input;
  }
}
