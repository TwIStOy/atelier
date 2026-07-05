import type { SizeValue } from "@earendil-works/pi-tui";
import type { ConfigItem } from "@htwang-contrib/common";

export const TAB_ALL = "all";
export const PACKAGE_TAB_PREFIX = "pkg:";
export const DEFAULT_WIDTH_PCT = 92;
export const DEFAULT_MAX_HEIGHT_PCT = 85;
export const DEFAULT_WIDTH_PERCENT: SizeValue = `${DEFAULT_WIDTH_PCT}%`;
export const DEFAULT_MAX_HEIGHT: SizeValue = `${DEFAULT_MAX_HEIGHT_PCT}%`;
export const SELECT_PAGE_SIZE = 10;

export interface SettingRow {
  id: string;
  extensionId: string;
  extensionLabel: string;
  item: ConfigItem;
  currentValue: unknown;
  isExplicit: boolean;
}

export interface UiState {
  tab: string;
  search: string;
  selected: number;
  scroll: number;
  editing?: InlineEditState;
  selecting?: SelectingState;
}

export interface InlineEditState {
  buffer: string;
  cursor: number;
  rowId: string;
}

export interface InlineEditChar {
  ch: string;
  start: number;
  end: number;
}

export interface SelectingState {
  rowId: string;
  selectedOptionIndex: number;
  scroll: number;
  filter: string;
  reordering?: boolean;
}

export interface TabDef {
  id: string;
  label: string;
  extensionId?: string;
}

export interface PopupLayout {
  bodyRows: number;
  innerRows: number;
  listRows: number;
}
