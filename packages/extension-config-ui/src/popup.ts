import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigItemPreviewHandle, ConfigItemSelectOption } from "@htwang-contrib/common/config";
import {
  buildSelectDisplayOptions,
  buildSettingRows,
  buildTabs,
  filterRows,
  getSelectOptions,
  moveReorderableItem,
  resetExtensionSettings,
  resetSetting,
  saveSetting,
  stringifyValue,
  toggleMultiSelectValue,
  toggleReorderableValue,
} from "./config-registry.ts";
import { renderFooter } from "./render/footer.ts";
import { divider, wrapLine } from "./render/frame.ts";
import { handleInlineEditInput, parseSettingInput } from "./render/inline-edit.ts";
import { renderSearchBar } from "./render/search-bar.ts";
import { renderSelectPage, renderSettingList } from "./render/setting-list.ts";
import { renderTabBar } from "./render/tab-bar.ts";
import type { PopupLayout, SelectingState, SettingRow, TabDef, UiState } from "./types.ts";
import { DEFAULT_MAX_HEIGHT_PCT, SELECT_PAGE_SIZE, TAB_ALL } from "./types.ts";

function makeInitialUiState(): UiState {
  return { tab: TAB_ALL, search: "", selected: 0, scroll: 0 };
}

const MAX_POPUP_BODY_ROWS = 26;
const MIN_POPUP_BODY_ROWS = 8;

export function computeLayout(terminalRows: number): PopupLayout {
  const maxHeight = Math.floor((terminalRows * DEFAULT_MAX_HEIGHT_PCT) / 100);
  const bodyRows = Math.max(MIN_POPUP_BODY_ROWS, Math.min(MAX_POPUP_BODY_ROWS, maxHeight));
  const listRows = Math.max(4, bodyRows - 7);
  return { bodyRows, innerRows: bodyRows, listRows };
}

function syncViewport(ui: UiState, itemCount: number): void {
  const maxIndex = Math.max(0, itemCount - 1);
  ui.selected = Math.max(0, Math.min(ui.selected, maxIndex));
  if (ui.selected < ui.scroll) ui.scroll = ui.selected;
  ui.scroll = Math.max(0, Math.min(ui.scroll, maxIndex));
}

function findRowById(rows: SettingRow[], id: string): SettingRow | undefined {
  return rows.find((r) => r.id === id);
}

function isPrintableChar(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\x7f";
}

function createConfigComponent(
  _pi: ExtensionAPI,
  ctx: ExtensionCommandContext | ExtensionContext,
  rows: SettingRow[],
  tabs: TabDef[],
  ui: UiState,
  theme: Theme,
  requestRender: () => void,
  getLayout: () => PopupLayout,
  done: () => void,
) {
  const filtered = () => filterRows(rows, ui.search, ui.tab);

  const clamp = (): void => {
    if (!tabs.some((t) => t.id === ui.tab)) ui.tab = TAB_ALL;
    const count = filtered().length;
    syncViewport(ui, count);
  };

  const selectedRow = (): SettingRow | undefined => {
    clamp();
    return filtered()[ui.selected];
  };

  let previewHandle: ConfigItemPreviewHandle | undefined;

  const disposePreview = (): void => {
    previewHandle?.dispose?.();
    previewHandle = undefined;
  };

  const ensurePreview = (): void => {
    const row = selectedRow();
    const preview = row?.item.preview;
    if (!preview) {
      disposePreview();
      return;
    }
    if (previewHandle) return;
    previewHandle = preview({
      getValue: () => {
        if (ui.selecting && row) {
          const { options } = buildSelectDisplayOptions(row, ui.selecting.filter);
          const opt = options[ui.selecting.selectedOptionIndex];
          if (opt) return opt.value;
        }
        return row?.currentValue;
      },
      requestRender,
    });
  };

  const cycle = <T extends string>(values: T[], current: string, delta: number): T => {
    const idx = Math.max(0, values.indexOf(current as T));
    return values[(idx + delta + values.length) % values.length]!;
  };

  const switchTab = (delta: number): void => {
    const tabIds = tabs.map((t) => t.id);
    ui.tab = cycle(tabIds, ui.tab, delta);
    ui.selected = 0;
    ui.scroll = 0;
    clamp();
    requestRender();
  };

  const syncSelectScroll = (sel: SelectingState, total: number): void => {
    const half = Math.floor(SELECT_PAGE_SIZE / 2);
    if (sel.selectedOptionIndex < sel.scroll + half) {
      sel.scroll = Math.max(0, sel.selectedOptionIndex - half);
    } else if (sel.selectedOptionIndex >= sel.scroll + SELECT_PAGE_SIZE - half) {
      sel.scroll = Math.max(0, sel.selectedOptionIndex - SELECT_PAGE_SIZE + half + 1);
    }
    sel.scroll = Math.max(0, Math.min(sel.scroll, Math.max(0, total - SELECT_PAGE_SIZE)));
  };

  const enterSelectPage = (): void => {
    const row = selectedRow();
    if (!row) return;
    if (row.item.type === "select" || row.item.type === "multiselect" || row.item.type === "reorderable") {
      const opts = getSelectOptions(row);
      let initialIndex = 0;
      if (row.item.type === "select") {
        initialIndex = opts.findIndex((o) => JSON.stringify(o.value) === JSON.stringify(row.currentValue));
        if (initialIndex < 0) initialIndex = 0;
      }
      const scroll = Math.max(0, initialIndex - Math.floor(SELECT_PAGE_SIZE / 2));
      ui.selecting = {
        rowId: row.id,
        selectedOptionIndex: initialIndex,
        scroll,
        filter: "",
      };
      requestRender();
      return;
    }
    if (row.item.type === "boolean") {
      const next = !(row.currentValue === true);
      saveSetting(row, next);
      row.currentValue = next;
      row.isExplicit = true;
      requestRender();
      return;
    }
    const buffer = stringifyValue(row.currentValue ?? "");
    ui.editing = { buffer, cursor: buffer.length, rowId: row.id };
    requestRender();
  };

  const saveInlineEdit = (): void => {
    const editing = ui.editing;
    if (!editing) return;
    const row = findRowById(rows, editing.rowId);
    if (!row) {
      ui.editing = undefined;
      requestRender();
      return;
    }
    try {
      const value = parseSettingInput(row.item, editing.buffer);
      const changed = JSON.stringify(value) !== JSON.stringify(row.currentValue);
      if (changed) {
        saveSetting(row, value);
        row.currentValue = value;
        row.isExplicit = true;
      }
      ui.editing = undefined;
      requestRender();
    } catch (err) {
      ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
    }
  };

  function handleInput(data: string): void {
    if (ui.editing) {
      handleEditingInput(data);
      return;
    }
    if (ui.selecting) {
      handleSelectingInput(data);
      return;
    }
    handleBrowseInput(data);
  }

  function handleEditingInput(data: string): void {
    const editing = ui.editing;
    if (!editing) return;
    if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
      ui.editing = undefined;
      requestRender();
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, "return")) {
      saveInlineEdit();
      return;
    }
    if (handleInlineEditInput(editing, data)) {
      requestRender();
    }
  }

  function handleSelectingInput(data: string): void {
    const sel = ui.selecting;
    if (!sel) return;
    const row = findRowById(rows, sel.rowId);
    const built = row ? buildSelectDisplayOptions(row, sel.filter) : { options: [], canFilter: false };

    if (matchesKey(data, Key.escape)) {
      exitOrClearSelectFilter(sel);
      return;
    }
    if (built.canFilter && editSelectFilter(sel, built.options, data)) return;
    if (moveSelectIndex(sel, built.options, data)) return;
    if (confirmSelectChoice(sel, built.options, row, data)) return;
    if (tryMoveReorderable(sel, built.options, row, sel.filter.length > 0, data)) requestRender();
  }

  function exitOrClearSelectFilter(sel: SelectingState): void {
    if (sel.filter.length > 0) {
      sel.filter = "";
      sel.selectedOptionIndex = 0;
      sel.scroll = 0;
    } else {
      ui.selecting = undefined;
    }
    requestRender();
  }

  function confirmSelectChoice(
    sel: SelectingState,
    opts: ConfigItemSelectOption[],
    row: SettingRow | undefined,
    data: string,
  ): boolean {
    if (!(matchesKey(data, Key.enter) || matchesKey(data, "return")) || !row) return false;
    const opt = opts[sel.selectedOptionIndex];
    if (opt) applySelectChoice(row, opt);
    return true;
  }

  function editSelectFilter(sel: SelectingState, opts: ConfigItemSelectOption[], data: string): boolean {
    if (matchesKey(data, "backspace") || matchesKey(data, "ctrl+u")) {
      sel.filter = matchesKey(data, "ctrl+u") ? "" : sel.filter.slice(0, -1);
      sel.selectedOptionIndex = 0;
      syncSelectScroll(sel, opts.length);
      requestRender();
      return true;
    }
    if (isPrintableChar(data)) {
      sel.filter += data;
      sel.selectedOptionIndex = 0;
      syncSelectScroll(sel, opts.length);
      requestRender();
      return true;
    }
    return false;
  }

  function moveSelectIndex(sel: SelectingState, opts: ConfigItemSelectOption[], data: string): boolean {
    const last = opts.length - 1;
    if (matchesKey(data, "up")) sel.selectedOptionIndex = Math.max(0, sel.selectedOptionIndex - 1);
    else if (matchesKey(data, "down")) sel.selectedOptionIndex = Math.min(last, sel.selectedOptionIndex + 1);
    else if (matchesKey(data, "-") || matchesKey(data, "pageUp"))
      sel.selectedOptionIndex = Math.max(0, sel.selectedOptionIndex - SELECT_PAGE_SIZE);
    else if (matchesKey(data, "=") || matchesKey(data, "pageDown"))
      sel.selectedOptionIndex = Math.min(last, sel.selectedOptionIndex + SELECT_PAGE_SIZE);
    else return false;
    syncSelectScroll(sel, opts.length);
    requestRender();
    return true;
  }

  function applySelectChoice(row: SettingRow, opt: ConfigItemSelectOption): void {
    if (row.item.type === "select") {
      saveSetting(row, opt.value);
      row.currentValue = opt.value;
      row.isExplicit = true;
      ui.selecting = undefined;
    } else if (row.item.type === "multiselect") {
      const newVals = toggleMultiSelectValue(row, opt.value);
      saveSetting(row, newVals);
      row.currentValue = newVals;
      row.isExplicit = true;
    } else if (row.item.type === "reorderable") {
      const newVals = toggleReorderableValue(row, opt.value);
      saveSetting(row, newVals);
      row.currentValue = newVals;
      row.isExplicit = true;
    }
    requestRender();
  }

  function tryMoveReorderable(
    sel: SelectingState,
    opts: ConfigItemSelectOption[],
    row: SettingRow | undefined,
    filterActive: boolean,
    data: string,
  ): boolean {
    if (row?.item.type !== "reorderable" || filterActive) return false;
    const delta = reorderMoveDelta(data);
    if (delta === 0) return false;

    const vals = Array.isArray(row.currentValue) ? [...row.currentValue] : [];
    const optVal = opts[sel.selectedOptionIndex]?.value;
    const fromIdx = vals.findIndex((v) => JSON.stringify(v) === JSON.stringify(optVal));
    if (fromIdx < 0 || fromIdx + delta < 0 || fromIdx + delta >= vals.length) return false;
    const newVals = moveReorderableItem(row, fromIdx, delta);
    saveSetting(row, newVals);
    row.currentValue = newVals;
    row.isExplicit = true;
    sel.selectedOptionIndex = Math.max(0, Math.min(opts.length - 1, sel.selectedOptionIndex + delta));
    return true;
  }

  function reorderMoveDelta(data: string): -1 | 1 | 0 {
    if (matchesKey(data, "alt+up") || matchesKey(data, "ctrl+p")) return -1;
    if (matchesKey(data, "alt+down") || matchesKey(data, "ctrl+n")) return 1;
    return 0;
  }

  function handleBrowseInput(data: string): void {
    if (handleBrowseNavigation(data)) return;
    handleBrowseAction(data);
  }

  function handleBrowseNavigation(data: string): boolean {
    if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
      done();
      return true;
    }
    if (matchesKey(data, "tab") || matchesKey(data, "right")) {
      switchTab(1);
      return true;
    }
    if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
      switchTab(-1);
      return true;
    }
    return moveBrowseSelection(data);
  }

  function moveBrowseSelection(data: string): boolean {
    const listRows = getLayout().listRows;
    if (matchesKey(data, "up")) ui.selected -= 1;
    else if (matchesKey(data, "down")) ui.selected += 1;
    else if (matchesKey(data, "-") || matchesKey(data, "pageUp")) ui.selected -= listRows;
    else if (matchesKey(data, "=") || matchesKey(data, "pageDown")) ui.selected += listRows;
    else return false;
    clamp();
    requestRender();
    return true;
  }

  function handleBrowseAction(data: string): void {
    if (editBrowseSearch(data)) return;
    if (matchesKey(data, "delete")) {
      resetSelectedRow();
      return;
    }
    if (matchesKey(data, "alt+x") || matchesKey(data, "ctrl+x")) {
      resetSelectedExtension();
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, "return")) {
      enterSelectPage();
      return;
    }
    if (isPrintableChar(data)) {
      ui.search += data;
      ui.selected = 0;
      clamp();
      requestRender();
    }
  }

  function editBrowseSearch(data: string): boolean {
    if (matchesKey(data, "backspace")) ui.search = ui.search.slice(0, -1);
    else if (matchesKey(data, "ctrl+u")) ui.search = "";
    else return false;
    ui.selected = 0;
    clamp();
    requestRender();
    return true;
  }

  function resetSelectedRow(): void {
    const row = selectedRow();
    if (row) {
      resetSetting(row);
      row.currentValue = typeof row.item.value === "function" ? (row.item.value as () => unknown)() : row.item.value;
      row.isExplicit = false;
    }
    requestRender();
  }

  function resetSelectedExtension(): void {
    const row = selectedRow();
    if (row) {
      resetExtensionSettings(rows, row.extensionId);
      for (const r of rows) {
        if (r.extensionId === row.extensionId) {
          r.currentValue = typeof r.item.value === "function" ? (r.item.value as () => unknown)() : r.item.value;
          r.isExplicit = false;
        }
      }
    }
    requestRender();
  }

  function render(width: number): string[] {
    clamp();
    const safeWidth = Math.max(1, width);
    const lines: string[] = [];

    if (ui.selecting) {
      const row = findRowById(rows, ui.selecting.rowId);
      if (row) {
        ensurePreview();
        lines.push(theme.fg("accent", theme.bold(" Extension Settings")));
        lines.push("");
        lines.push(...renderSelectPage(row, ui.selecting, safeWidth, theme, previewHandle));
        lines.push("");
        lines.push(divider(safeWidth, theme));
        lines.push(
          ...wrapLine(
            renderFooter(
              theme,
              "selecting",
              row.item.type === "reorderable",
              !!ui.selecting && ui.selecting.filter.length > 0,
            ),
            safeWidth,
          ),
        );
      }
      return lines;
    }

    disposePreview();

    lines.push(theme.fg("accent", theme.bold(" Extension Settings")));
    lines.push("");
    lines.push(renderTabBar(tabs, ui.tab, safeWidth, theme));
    lines.push("");
    lines.push(renderSearchBar(ui.search, safeWidth, theme, !!ui.editing));
    lines.push("");
    lines.push(divider(safeWidth, theme));

    const footer = renderFooter(theme, ui.editing ? "editing" : "browse");
    const footerLines = [divider(safeWidth, theme), ...wrapLine(footer, safeWidth)];

    const layout = getLayout();
    const availableRows = Math.max(1, layout.bodyRows - lines.length - footerLines.length);

    const currentFiltered = filtered();
    syncViewport(ui, currentFiltered.length);

    let listResult = renderSettingList(
      currentFiltered,
      ui.selected,
      ui.scroll,
      availableRows,
      safeWidth,
      theme,
      ui.editing,
    );
    if (currentFiltered.length > 0 && !listResult.selectedVisible) {
      let bestScroll = Math.max(0, ui.selected);
      for (let s = Math.max(0, ui.selected - 1); s >= 0; s -= 1) {
        const trial = renderSettingList(currentFiltered, ui.selected, s, availableRows, safeWidth, theme, ui.editing);
        if (trial.selectedVisible) {
          bestScroll = s;
        } else {
          break;
        }
      }
      ui.scroll = bestScroll;
      listResult = renderSettingList(
        currentFiltered,
        ui.selected,
        ui.scroll,
        availableRows,
        safeWidth,
        theme,
        ui.editing,
      );
    }
    lines.push(...listResult.lines);
    lines.push(...footerLines);

    return lines;
  }

  return { handleInput, invalidate() {}, render, dispose: disposePreview };
}

export async function openConfigPopup(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext | ExtensionContext,
): Promise<void> {
  const rows = buildSettingRows();
  if (rows.length === 0) {
    ctx.ui.notify("No extension settings registered.", "info");
    return;
  }

  const tabs = buildTabs(rows);
  const ui = makeInitialUiState();

  await ctx.ui.custom<void>((tui: TUI, theme: Theme, _kb, done) =>
    createConfigComponent(
      pi,
      ctx,
      rows,
      tabs,
      ui,
      theme,
      () => tui.requestRender(),
      () => computeLayout(tui.terminal.rows),
      done,
    ),
  );
}
