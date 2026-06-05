import type { Theme } from "@earendil-works/pi-coding-agent";
import { pad } from "./frame.ts";

export function renderSearchBar(
  search: string,
  width: number,
  theme: Theme,
  editing = false,
): string {
  if (editing) {
    return theme.bg(
      "toolPendingBg",
      pad(` ${theme.fg("dim", "Editing inline value")}`, width),
    );
  }
  const cursor = theme.inverse(" ");
  const searchText = ` > ${search}${cursor}`;
  return theme.bg("toolPendingBg", pad(searchText, width));
}
