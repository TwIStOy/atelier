import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { TabDef } from "../types.ts";

function activePill(theme: Theme, label: string): string {
  return theme.fg("accent", theme.inverse(theme.bold(label)));
}

function inactivePill(theme: Theme, label: string): string {
  return theme.bg("selectedBg", theme.fg("accent", label));
}

export function renderTabBar(
  tabs: TabDef[],
  activeId: string,
  width: number,
  theme: Theme,
): string {
  const safeWidth = Math.max(1, width);
  if (tabs.length === 0) return " ".repeat(safeWidth);

  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const widths = tabs.map((tab) => visibleWidth(tab.label) + 2);

  const sliceWidth = (s: number, e: number): number => {
    let total = 0;
    for (let i = s; i < e; i += 1) total += widths[i]!;
    total += Math.max(0, e - s - 1);
    total += s > 0 ? 2 : 0;
    total += e < tabs.length ? 2 : 0;
    return total;
  };

  let start = activeIndex;
  let end = activeIndex + 1;
  let preferRight = true;

  while (start > 0 || end < tabs.length) {
    let progressed = false;
    const tryRight = (): boolean => {
      if (end < tabs.length && sliceWidth(start, end + 1) <= safeWidth) {
        end += 1;
        return true;
      }
      return false;
    };
    const tryLeft = (): boolean => {
      if (start > 0 && sliceWidth(start - 1, end) <= safeWidth) {
        start -= 1;
        return true;
      }
      return false;
    };

    if (preferRight) {
      if (tryRight()) progressed = true;
      if (tryLeft()) progressed = true;
    } else {
      if (tryLeft()) progressed = true;
      if (tryRight()) progressed = true;
    }
    if (!progressed) break;
    preferRight = !preferRight;
  }

  const cells = tabs.slice(start, end).map((tab) => {
    const label = ` ${tab.label} `;
    return tab.id === activeId
      ? activePill(theme, label)
      : inactivePill(theme, label);
  });

  if (start > 0) cells.unshift(theme.fg("dim", "‹"));
  if (end < tabs.length) cells.push(theme.fg("dim", "›"));
  return truncateToWidth(
    cells.join(" ") + " ".repeat(Math.max(0, safeWidth)),
    safeWidth,
    "",
  );
}
