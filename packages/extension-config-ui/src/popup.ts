import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigItemPreviewHandle } from "@htwang-contrib/common";
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

const MAX_POPUP_BODY_ROWS = 40;
const MIN_POPUP_BODY_ROWS = 8;

export function computeLayout(terminalRows: number): PopupLayout {
  const maxHeight = Math.floor((terminalRows * DEFAULT_MAX_HEIGHT_PCT) / 100);
  const bodyRows = Math.max(MIN_POPUP_BODY_ROWS, Math.min(MAX_POPUP_BODY_ROWS, maxHeight));
  const listRows = Math.max(4, bodyRows - 7);
  return { bodyRows, innerRows: bodyRows, listRows };
}

function syncViewport(ui: UiState, itemCount: number, listRows: number): void {
  const rows = Math.max(1, listRows);
  ui.selected = Math.max(0, Math.min(ui.selected, Math.max(0, itemCount - 1)));
  if (ui.selected < ui.scroll) ui.scroll = ui.selected;
  else if (ui.selected >= ui.scroll + rows) ui.scroll = ui.selected - rows + 1;
  ui.scroll = Math.max(0, Math.min(ui.scroll, Math.max(0, itemCount - rows)));
}

function findRowById(rows: SettingRow[], id: string): SettingRow | undefined {
  return rows.find((r) => r.id === id);
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
    const layout = getLayout();
    if (!tabs.some((t) => t.id === ui.tab)) ui.tab = TAB_ALL;
    const count = filtered().length;
    syncViewport(ui, count, layout.listRows);
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
      if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
        ui.editing = undefined;
        requestRender();
        return;
      }
      if (matchesKey(data, Key.enter) || matchesKey(data, "return")) {
        saveInlineEdit();
        return;
      }
      if (handleInlineEditInput(ui.editing, data)) {
        requestRender();
      }
      return;
    }

    if (ui.selecting) {
      const row = findRowById(rows, ui.selecting.rowId);
      const { options: opts, canFilter } = row
        ? buildSelectDisplayOptions(row, ui.selecting.filter)
        : { options: [], canFilter: false };
      const filterActive = ui.selecting.filter.length > 0;

      if (matchesKey(data, Key.escape)) {
        if (filterActive) {
          ui.selecting.filter = "";
          ui.selecting.selectedOptionIndex = 0;
          ui.selecting.scroll = 0;
        } else {
          ui.selecting = undefined;
        }
        requestRender();
        return;
      }
      if (canFilter && (matchesKey(data, "backspace") || matchesKey(data, "ctrl+u"))) {
        if (matchesKey(data, "ctrl+u")) ui.selecting.filter = "";
        else ui.selecting.filter = ui.selecting.filter.slice(0, -1);
        ui.selecting.selectedOptionIndex = 0;
        syncSelectScroll(ui.selecting, opts.length);
        requestRender();
        return;
      }
      if (canFilter && data.length === 1 && data >= " " && data !== "\x7f") {
        ui.selecting.filter += data;
        ui.selecting.selectedOptionIndex = 0;
        syncSelectScroll(ui.selecting, opts.length);
        requestRender();
        return;
      }
      if (matchesKey(data, "up")) {
        ui.selecting.selectedOptionIndex = Math.max(0, ui.selecting.selectedOptionIndex - 1);
        syncSelectScroll(ui.selecting, opts.length);
        requestRender();
        return;
      }
      if (matchesKey(data, "down")) {
        ui.selecting.selectedOptionIndex = Math.min(opts.length - 1, ui.selecting.selectedOptionIndex + 1);
        syncSelectScroll(ui.selecting, opts.length);
        requestRender();
        return;
      }
      if (matchesKey(data, "-") || matchesKey(data, "pageUp")) {
        ui.selecting.selectedOptionIndex = Math.max(0, ui.selecting.selectedOptionIndex - SELECT_PAGE_SIZE);
        syncSelectScroll(ui.selecting, opts.length);
        requestRender();
        return;
      }
      if (matchesKey(data, "=") || matchesKey(data, "pageDown")) {
        ui.selecting.selectedOptionIndex = Math.min(
          opts.length - 1,
          ui.selecting.selectedOptionIndex + SELECT_PAGE_SIZE,
        );
        syncSelectScroll(ui.selecting, opts.length);
        requestRender();
        return;
      }
      if (matchesKey(data, Key.enter) || matchesKey(data, "return")) {
        const opt = opts[ui.selecting.selectedOptionIndex];
        if (!opt || !row) return;
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
        return;
      }
      if (
        row?.item.type === "reorderable" &&
        !filterActive &&
        (matchesKey(data, "alt+up") || matchesKey(data, "ctrl+p"))
      ) {
        const vals = Array.isArray(row.currentValue) ? [...row.currentValue] : [];
        const optVal = opts[ui.selecting.selectedOptionIndex]?.value;
        const fromIdx = vals.findIndex((v) => JSON.stringify(v) === JSON.stringify(optVal));
        if (fromIdx > 0) {
          const newVals = moveReorderableItem(row, fromIdx, -1);
          saveSetting(row, newVals);
          row.currentValue = newVals;
          row.isExplicit = true;
          ui.selecting.selectedOptionIndex = Math.max(0, ui.selecting.selectedOptionIndex - 1);
        }
        requestRender();
        return;
      }
      if (
        row?.item.type === "reorderable" &&
        !filterActive &&
        (matchesKey(data, "alt+down") || matchesKey(data, "ctrl+n"))
      ) {
        const vals = Array.isArray(row.currentValue) ? [...row.currentValue] : [];
        const optVal = opts[ui.selecting.selectedOptionIndex]?.value;
        const fromIdx = vals.findIndex((v) => JSON.stringify(v) === JSON.stringify(optVal));
        if (fromIdx >= 0 && fromIdx < vals.length - 1) {
          const newVals = moveReorderableItem(row, fromIdx, 1);
          saveSetting(row, newVals);
          row.currentValue = newVals;
          row.isExplicit = true;
          ui.selecting.selectedOptionIndex = Math.min(opts.length - 1, ui.selecting.selectedOptionIndex + 1);
        }
        requestRender();
        return;
      }
      return;
    }

    if (matchesKey(data, Key.escape) || matchesKey(data, "ctrl+c")) {
      done();
      return;
    }

    if (matchesKey(data, "tab") || matchesKey(data, "right")) {
      switchTab(1);
      return;
    }
    if (matchesKey(data, "shift+tab") || matchesKey(data, "left")) {
      switchTab(-1);
      return;
    }
    if (matchesKey(data, "up")) {
      ui.selected -= 1;
      clamp();
      requestRender();
      return;
    }
    if (matchesKey(data, "down")) {
      ui.selected += 1;
      clamp();
      requestRender();
      return;
    }
    if (matchesKey(data, "-") || matchesKey(data, "pageUp")) {
      ui.selected -= getLayout().listRows;
      clamp();
      requestRender();
      return;
    }
    if (matchesKey(data, "=") || matchesKey(data, "pageDown")) {
      ui.selected += getLayout().listRows;
      clamp();
      requestRender();
      return;
    }
    if (matchesKey(data, "backspace")) {
      ui.search = ui.search.slice(0, -1);
      ui.selected = 0;
      clamp();
      requestRender();
      return;
    }
    if (matchesKey(data, "ctrl+u")) {
      ui.search = "";
      ui.selected = 0;
      clamp();
      requestRender();
      return;
    }
    if (matchesKey(data, "delete")) {
      const row = selectedRow();
      if (row) {
        resetSetting(row);
        row.currentValue = typeof row.item.value === "function" ? (row.item.value as () => unknown)() : row.item.value;
        row.isExplicit = false;
      }
      requestRender();
      return;
    }
    if (matchesKey(data, "alt+x") || matchesKey(data, "ctrl+x")) {
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
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, "return")) {
      enterSelectPage();
      return;
    }
    if (data.length === 1 && data >= " " && data !== "\x7f") {
      ui.search += data;
      ui.selected = 0;
      clamp();
      requestRender();
    }
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
    syncViewport(ui, currentFiltered.length, availableRows);

    const listLines = renderSettingList(
      currentFiltered,
      ui.selected,
      ui.scroll,
      availableRows,
      safeWidth,
      theme,
      ui.editing,
    );
    lines.push(...listLines);
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
