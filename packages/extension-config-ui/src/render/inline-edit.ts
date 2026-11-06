import { type KeyId, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigItem, SelectConfigItem } from "@htwang-contrib/common/config";
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

function skipCharsLeftWhile(chars: InlineEditChar[], index: number, matches: (ch: string) => boolean): number {
  let i = index;
  while (i > 0 && matches(chars[i - 1]!.ch)) i -= 1;
  return i;
}

function skipCharsRightWhile(chars: InlineEditChar[], index: number, matches: (ch: string) => boolean): number {
  let i = index;
  while (i < chars.length && matches(chars[i]!.ch)) i += 1;
  return i;
}

function moveWordLeft(editing: InlineEditState): void {
  const chars = inlineEditChars(editing.buffer);
  let index = skipCharsLeftWhile(chars, codeUnitToCharIndex(chars, editing.cursor), (ch) => charKind(ch) === "space");
  if (index <= 0) {
    editing.cursor = 0;
    return;
  }
  const kind = charKind(chars[index - 1]!.ch);
  index = skipCharsLeftWhile(chars, index, (ch) => charKind(ch) === kind);
  editing.cursor = charIndexToCodeUnit(chars, index, editing.buffer.length);
}

function moveWordRight(editing: InlineEditState): void {
  const chars = inlineEditChars(editing.buffer);
  let index = skipCharsRightWhile(chars, codeUnitToCharIndex(chars, editing.cursor), (ch) => charKind(ch) === "space");
  if (index >= chars.length) {
    editing.cursor = editing.buffer.length;
    return;
  }
  const kind = charKind(chars[index]!.ch);
  index = skipCharsRightWhile(chars, index, (ch) => charKind(ch) === kind);
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

function deleteBackward(editing: InlineEditState): void {
  const before = editing.cursor;
  moveByChars(editing, -1);
  deleteRange(editing, editing.cursor, before);
}

function deleteForward(editing: InlineEditState): void {
  const start = editing.cursor;
  moveByChars(editing, 1);
  deleteRange(editing, start, editing.cursor);
}

function clearEditBuffer(editing: InlineEditState): void {
  editing.buffer = "";
  editing.cursor = 0;
}

interface EditKeyHandler {
  keys: KeyId[];
  apply: (editing: InlineEditState) => void;
}

const EDIT_KEY_HANDLERS: EditKeyHandler[] = [
  { keys: ["left", "ctrl+b"], apply: (e) => moveByChars(e, -1) },
  { keys: ["right", "ctrl+f"], apply: (e) => moveByChars(e, 1) },
  { keys: ["alt+left", "ctrl+left", "alt+b"], apply: moveWordLeft },
  { keys: ["alt+right", "ctrl+right", "alt+f"], apply: moveWordRight },
  {
    keys: ["home", "ctrl+a"],
    apply: (e) => {
      e.cursor = 0;
    },
  },
  {
    keys: ["end", "ctrl+e"],
    apply: (e) => {
      e.cursor = e.buffer.length;
    },
  },
  { keys: ["backspace"], apply: deleteBackward },
  { keys: ["delete", "ctrl+d"], apply: deleteForward },
  { keys: ["ctrl+u"], apply: clearEditBuffer },
];

export function handleInlineEditInput(editing: InlineEditState, data: string): boolean {
  clampCursor(editing);
  for (const handler of EDIT_KEY_HANDLERS) {
    if (handler.keys.some((key) => matchesKey(data, key))) {
      handler.apply(editing);
      return true;
    }
  }
  if (isPlainInput(data)) {
    insertText(editing, data);
    return true;
  }
  return false;
}

function parseBooleanInput(_item: ConfigItem, input: string): unknown {
  const lower = input.trim().toLowerCase();
  if (["true", "yes", "on", "1", "enabled"].includes(lower)) return true;
  if (["false", "no", "off", "0", "disabled"].includes(lower)) return false;
  throw new Error("Expected boolean: true/false, on/off, yes/no");
}

function parseNumberInput(_item: ConfigItem, input: string): unknown {
  const parsed = Number(input.trim());
  if (!Number.isFinite(parsed)) throw new Error("Expected a number");
  return parsed;
}

function parseSelectInput(item: ConfigItem, input: string): unknown {
  const value = input.trim();
  const rawOpts = (item as SelectConfigItem).options;
  const opts = typeof rawOpts === "function" ? rawOpts() : rawOpts;
  const matched = opts.find((o) => o.label.toLowerCase() === value.toLowerCase());
  if (matched) return matched.value;
  const byValue = opts.find((o) => String(o.value).toLowerCase() === value.toLowerCase());
  if (byValue) return byValue.value;
  throw new Error(`Expected one of: ${opts.map((o) => o.label).join(", ")}`);
}

function rejectPickerInput(): never {
  throw new Error("Use the option picker for this setting");
}

const COLOR_INPUT_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function parseColorInput(_item: ConfigItem, input: string): unknown {
  const trimmed = input.trim();
  if (trimmed && !COLOR_INPUT_RE.test(trimmed)) {
    throw new Error("Expected a hex color (e.g. #ff6600 or #f60)");
  }
  return trimmed;
}

type SettingInputParser = (item: ConfigItem, input: string) => unknown;

const SETTING_INPUT_PARSERS: Record<string, SettingInputParser> = {
  boolean: parseBooleanInput,
  number: parseNumberInput,
  select: parseSelectInput,
  multiselect: rejectPickerInput,
  reorderable: rejectPickerInput,
  color: parseColorInput,
  string: (_item, input) => input,
};

export function parseSettingInput(item: ConfigItem, input: string): unknown {
  const parser = SETTING_INPUT_PARSERS[item.type];
  return parser?.(item, input);
}
