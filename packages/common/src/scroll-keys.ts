import { Key, matchesKey } from "@earendil-works/pi-tui";

/**
 * Apply up/down scroll keys to an overlay scroll offset. Returns the new
 * offset, or undefined when `data` is neither key.
 */
export function scrollKeyOffset(data: string, offset: number): number | undefined {
  if (matchesKey(data, Key.up)) return Math.max(0, offset - 1);
  if (matchesKey(data, Key.down)) return offset + 1;
  return undefined;
}
