import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export function makeBelowWidget(): (
  tui: TUI,
  theme: Theme,
) => Component & {
  dispose?(): void;
} {
  return () => ({
    render(): string[] {
      return [];
    },
    invalidate() {},
  });
}
