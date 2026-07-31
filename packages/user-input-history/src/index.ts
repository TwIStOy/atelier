import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EditorComponent, KeybindingsConfig, KeyId } from "@earendil-works/pi-tui";
import { getKeybindings, Key } from "@earendil-works/pi-tui";
import { chainEditorFactory, createLogger, isExtensionDisabled } from "@htwang-contrib/common";
import { loadHistoryTextsNewestFirst, MAX_ENTRIES, persistHistoryMergedWithDisk } from "./history-store.ts";
import { InteractiveHistorySearch } from "./interactive-search.ts";

const logger = createLogger("user-input-history");

const SESSION_RENAME_KEY = "app.session.rename";

function isCtrlRKey(key: string): boolean {
  return key.trim().toLowerCase() === "ctrl+r";
}

function stripSessionRenameBinding(value: unknown): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") {
    return isCtrlRKey(value) ? [] : [value];
  }
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && !isCtrlRKey(v));
  }
  return [];
}

function renameKeysToBindingValue(keys: string[]): KeyId | KeyId[] {
  if (keys.length === 0) return [];
  if (keys.length === 1) return keys[0] as KeyId;
  return keys as KeyId[];
}

/**
 * Free `ctrl+r` for this process only: strip it from `app.session.rename` in the
 * in-memory user layer. Pi merges user bindings over defaults; setting `[]` removes
 * the built-in shortcut when the user had no override (undefined → defaults).
 * Does not write `keybindings.json`. Call from `session_start` so `getKeybindings()`
 * is the interactive agent KeybindingsManager (see extension `session_start` hook).
 */
function detachBuiltinSessionRenameCtrlR(): void {
  const kb = getKeybindings();
  const prev = kb.getUserBindings()[SESSION_RENAME_KEY];
  const keys = stripSessionRenameBinding(prev);
  const next = renameKeysToBindingValue(keys);
  kb.setUserBindings({
    ...kb.getUserBindings(),
    [SESSION_RENAME_KEY]: next,
  } as KeybindingsConfig);
}

type EditorWithHistory = EditorComponent & {
  history?: string[];
  addToHistory?: (text: string) => void;
};

function asHistoryEditor(ed: EditorComponent): EditorWithHistory {
  return ed as unknown as EditorWithHistory;
}

export function flattenToSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function applyDiskHistory(ed: EditorWithHistory): void {
  const diskTexts = loadHistoryTextsNewestFirst();
  if (!Array.isArray(ed.history)) return;
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const row of diskTexts) {
    const flat = flattenToSingleLine(row);
    if (!flat || seen.has(flat)) continue;
    seen.add(flat);
    merged.push(flat);
  }
  for (const row of ed.history) {
    const flat = flattenToSingleLine(row);
    if (!flat || seen.has(flat)) continue;
    seen.add(flat);
    merged.push(flat);
    if (merged.length >= MAX_ENTRIES) break;
  }
  ed.history = merged.slice(0, MAX_ENTRIES);
}

function patchAddToHistory(ed: EditorWithHistory): void {
  ed.addToHistory = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const h = ed.history;
    if (!Array.isArray(h)) return;
    const flat = flattenToSingleLine(trimmed);
    if (h.length > 0 && h[0] === flat) {
      persistHistoryMergedWithDisk([trimmed]);
      return;
    }
    h.unshift(flat);
    while (h.length > MAX_ENTRIES) h.pop();
    persistHistoryMergedWithDisk([trimmed]);
  };
}

async function openReverseSearch(ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI) return;
  const all = loadHistoryTextsNewestFirst();
  if (all.length === 0) {
    ctx.ui.notify("No saved prompts yet.", "info");
    return;
  }
  const picked = await ctx.ui.custom<string | undefined>((tui, th, kb, done) =>
    Promise.resolve(
      new InteractiveHistorySearch({
        tui,
        theme: th,
        keybindings: kb,
        ctx,
        history: all,
        done,
      }),
    ),
  );
  if (picked) ctx.ui.setEditorText(picked);
}

export default function userInputHistoryExtension(pi: ExtensionAPI): void {
  if (isExtensionDisabled("user-input-history")) return;
  logger.info("extension loaded");
  // Every user text that enters `session.prompt()` (after slash-command precheck),
  // including CLI `-m` / `initialMessage` which never touch the editor `addToHistory`.
  // Merging `[text]` with disk keeps prior entries and bumps duplicates by time.
  pi.on("input", (event) => {
    const trimmed = event.text.trim();
    if (!trimmed) return;
    persistHistoryMergedWithDisk([trimmed]);
  });

  pi.on("session_start", (_event, ctx) => {
    // After InteractiveMode has called setKeybindings(); clearing ctrl+r here avoids
    // built-in vs extension shortcut diagnostics (load-time detach can hit a stale KB).
    detachBuiltinSessionRenameCtrlR();
    if (!ctx.hasUI) return;
    ctx.ui.setEditorComponent(
      chainEditorFactory(ctx.ui.getEditorComponent(), (prior) => (tui, theme, keybindings) => {
        const inner = prior ? prior(tui, theme, keybindings) : new CustomEditor(tui, theme, keybindings);
        const ed = asHistoryEditor(inner);
        applyDiskHistory(ed);
        patchAddToHistory(ed);
        return inner;
      }),
    );
  });

  pi.registerShortcut(Key.ctrl("r"), {
    description: "Interactive prompt history search (replaces editor; skim fuzzy rank)",
    handler: (ctx) => openReverseSearch(ctx),
  });
}
