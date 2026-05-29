import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export { wrapTextWithAnsi };

export function prefixLine(
  line: string,
  prefix: string,
  width: number,
): string {
  const prefixWidth = visibleWidth(prefix);
  const innerWidth = Math.max(1, width - prefixWidth);
  return prefix + truncateToWidth(line, innerWidth, "");
}
