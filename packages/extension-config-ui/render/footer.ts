import type { Theme } from "@earendil-works/pi-coding-agent";

export function renderFooter(
  theme: Theme,
  mode: "browse" | "editing" | "selecting",
  isReorderable?: boolean,
): string {
  const k = (s: string) => theme.fg("warning", s);
  const d = (s: string) => theme.fg("dim", s);
  const sep = ` ${d("·")} `;

  if (mode === "editing") {
    return [
      k("←/→"),
      d("move"),
      k("alt+←/→"),
      d("word"),
      k("home/end"),
      d("jump"),
      k("backspace/delete"),
      d("delete"),
      k("ctrl+u"),
      d("clear"),
      k("enter"),
      d("save"),
      k("esc"),
      d("cancel"),
    ].join(sep);
  }

  if (mode === "selecting") {
    const base = [k("↑↓"), d("navigate"), k("enter"), d("select")];
    if (isReorderable) {
      base.push(k("alt+↑↓"), d("reorder"));
    }
    base.push(k("esc"), d("back"));
    return base.join(sep);
  }

  return [
    k("tab"),
    d("switch tabs"),
    k("↑↓"),
    d("navigate"),
    k("enter"),
    d("edit"),
    k("delete"),
    d("reset"),
    k("alt+x"),
    d("reset ext"),
    k("backspace"),
    d("search"),
    k("esc"),
    d("close"),
  ].join(sep);
}
