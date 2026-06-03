import {
  CustomEditor,
  type ExtensionAPI,
  type ExtensionContext,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  EditorComponent,
  EditorTheme,
  KeybindingsConfig,
  KeyId,
  TUI,
} from "@earendil-works/pi-tui";
import { getKeybindings, Key } from "@earendil-works/pi-tui";
import {
  loadHistoryTextsNewestFirst,
  MAX_ENTRIES,
  persistHistoryMergedWithDisk,
} from "./history-store.ts";
import { InteractiveHistorySearch } from "./interactive-search.ts";

type EditorFactory = (
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager,
) => EditorComponent;

const PRIOR_KEY = "__userInputHistoryPriorFactory" as const;
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
    return value.filter(
      (v): v is string => typeof v === "string" && !isCtrlRKey(v),
    );
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
 * Does not write `keybindings.json`.
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

type PriorMarked = EditorFactory & { [PRIOR_KEY]?: EditorFactory };

function unwrapBaseFactory(
  factory: EditorFactory | undefined,
): EditorFactory | undefined {
  const seen = new Set<EditorFactory>();
  let cur: EditorFactory | undefined = factory;
  while (cur) {
    const next = (cur as PriorMarked)[PRIOR_KEY];
    if (!next || seen.has(cur)) break;
    seen.add(cur);
    cur = next;
  }
  return cur;
}

type EditorWithHistory = EditorComponent & {
  history?: string[];
  addToHistory?: (text: string) => void;
};

function asHistoryEditor(ed: EditorComponent): EditorWithHistory {
  return ed as unknown as EditorWithHistory;
}

function applyDiskHistory(ed: EditorWithHistory): void {
  const diskTexts = loadHistoryTextsNewestFirst();
  if (!Array.isArray(ed.history)) return;
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const row of diskTexts) {
    if (seen.has(row)) continue;
    seen.add(row);
    merged.push(row);
  }
  for (const row of ed.history) {
    if (seen.has(row)) continue;
    seen.add(row);
    merged.push(row);
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
    if (h.length > 0 && h[0] === trimmed) {
      persistHistoryMergedWithDisk(h);
      return;
    }
    h.unshift(trimmed);
    while (h.length > MAX_ENTRIES) h.pop();
    persistHistoryMergedWithDisk(h);
  };
}

async function openReverseSearch(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<void> {
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
  detachBuiltinSessionRenameCtrlR();

  // Every user text that enters `session.prompt()` (after slash-command precheck),
  // including CLI `-m` / `initialMessage` which never touch the editor `addToHistory`.
  // Merging `[text]` with disk keeps prior entries and bumps duplicates by time.
  pi.on("input", (event) => {
    const trimmed = event.text.trim();
    if (!trimmed) return;
    persistHistoryMergedWithDisk([trimmed]);
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    const prior = unwrapBaseFactory(ctx.ui.getEditorComponent());
    const wrapped: PriorMarked = Object.assign(
      (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
        const inner = prior
          ? prior(tui, theme, keybindings)
          : new CustomEditor(tui, theme, keybindings);
        const ed = asHistoryEditor(inner);
        applyDiskHistory(ed);
        patchAddToHistory(ed);
        return inner;
      },
      { [PRIOR_KEY]: prior },
    );
    ctx.ui.setEditorComponent(wrapped);
  });

  pi.registerShortcut(Key.ctrl("r"), {
    description:
      "Interactive prompt history search (replaces editor; skim fuzzy rank)",
    handler: (ctx) => openReverseSearch(pi, ctx),
  });
}
