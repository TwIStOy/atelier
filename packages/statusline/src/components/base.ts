import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

export interface StatusLineComponent {
  render(width: number, theme: Theme): string[];
}

export function makeWidget(
  component: StatusLineComponent,
): (tui: TUI, theme: Theme) => Component & { dispose?(): void } {
  return (_tui, theme) => ({
    render(width: number): string[] {
      return component.render(width, theme);
    },
    invalidate() {},
  });
}
