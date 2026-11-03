import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TabDef } from "../types.ts";

function activePill(theme: Theme, label: string): string {
  return theme.fg("accent", theme.inverse(theme.bold(label)));
}

function inactivePill(theme: Theme, label: string): string {
  return theme.bg("selectedBg", theme.fg("accent", label));
}

interface TabRange {
  start: number;
  end: number;
}

function sliceWidth(widths: number[], tabCount: number, s: number, e: number): number {
  let total = 0;
  for (let i = s; i < e; i += 1) total += widths[i]!;
  total += Math.max(0, e - s - 1);
  total += s > 0 ? 2 : 0;
  total += e < tabCount ? 2 : 0;
  return total;
}

function expandRight(range: TabRange, widths: number[], tabCount: number, safeWidth: number): boolean {
  if (range.end < tabCount && sliceWidth(widths, tabCount, range.start, range.end + 1) <= safeWidth) {
    range.end += 1;
    return true;
  }
  return false;
}

function expandLeft(range: TabRange, widths: number[], tabCount: number, safeWidth: number): boolean {
  if (range.start > 0 && sliceWidth(widths, tabCount, range.start - 1, range.end) <= safeWidth) {
    range.start -= 1;
    return true;
  }
  return false;
}

function expandStep(
  range: TabRange,
  widths: number[],
  tabCount: number,
  safeWidth: number,
  preferRight: boolean,
): boolean {
  if (preferRight) {
    const grewRight = expandRight(range, widths, tabCount, safeWidth);
    const grewLeft = expandLeft(range, widths, tabCount, safeWidth);
    return grewRight || grewLeft;
  }
  const grewLeft = expandLeft(range, widths, tabCount, safeWidth);
  const grewRight = expandRight(range, widths, tabCount, safeWidth);
  return grewLeft || grewRight;
}

function computeTabRange(widths: number[], tabCount: number, activeIndex: number, safeWidth: number): TabRange {
  const range: TabRange = { start: activeIndex, end: activeIndex + 1 };
  let preferRight = true;
  while (range.start > 0 || range.end < tabCount) {
    if (!expandStep(range, widths, tabCount, safeWidth, preferRight)) break;
    preferRight = !preferRight;
  }
  return range;
}

export function renderTabBar(tabs: TabDef[], activeId: string, width: number, theme: Theme): string {
  const safeWidth = Math.max(1, width);
  if (tabs.length === 0) return " ".repeat(safeWidth);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const widths = tabs.map((tab) => visibleWidth(tab.label) + 2);
  const { start, end } = computeTabRange(widths, tabs.length, activeIndex, safeWidth);

  const cells = tabs.slice(start, end).map((tab) => {
    const label = ` ${tab.label} `;
    return tab.id === activeId ? activePill(theme, label) : inactivePill(theme, label);
  });

  if (start > 0) cells.unshift(theme.fg("dim", "‹"));
  if (end < tabs.length) cells.push(theme.fg("dim", "›"));
  return truncateToWidth(cells.join(" ") + " ".repeat(Math.max(0, safeWidth)), safeWidth, "");
}
