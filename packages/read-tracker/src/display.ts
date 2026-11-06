import { formatSize } from "@earendil-works/pi-coding-agent";
import { formatElapsedSeconds, shortenPath } from "@htwang-contrib/common/format";
import { fitColWidths, makeTable } from "@htwang-contrib/common/terminal";
import type { ReadEntry } from "./read-tracker.ts";

export interface ReadDisplayRow {
  path: string;
  entry: ReadEntry;
  stale: boolean;
}

function isStale(entry: ReadEntry): boolean {
  const elapsed = Date.now() - entry.readAt;
  if (elapsed < 0) return false;
  return elapsed > 60 * 60 * 1000;
}

export function buildReadRows(entries: ReadonlyArray<readonly [string, ReadEntry]>): ReadDisplayRow[] {
  return entries.map(([canonical, entry]) => ({
    path: canonical,
    entry,
    stale: isStale(entry),
  }));
}

export function renderReadTrackerTable(rows: ReadDisplayRow[]): string {
  if (rows.length === 0) {
    return "No files tracked yet.";
  }
  const now = Date.now();
  const sorted = [...rows].sort((a, b) => b.entry.readAt - a.entry.readAt);
  const colWidths = fitColWidths(4, 40, 18, 10, 14);
  const table = makeTable(["Path", "Read", "Size", "Mtime age"], colWidths);
  for (const row of sorted) {
    const { entry } = row;
    const readAge = formatElapsedSeconds(Math.max(0, (now - entry.readAt) / 1000));
    const mtimeAge = formatElapsedSeconds(Math.max(0, (now - entry.modifiedAt) / 1000));
    const marker = row.stale ? " ⚠" : "";
    table.push([`${shortenPath(row.path)}${marker}`, `${readAge} ago`, formatSize(entry.size), `${mtimeAge} ago`]);
  }
  return table.toString();
}

export function summarizeRows(rows: ReadDisplayRow[]): {
  total: number;
  stale: number;
} {
  let stale = 0;
  for (const row of rows) {
    if (row.stale) stale += 1;
  }
  return { total: rows.length, stale };
}
