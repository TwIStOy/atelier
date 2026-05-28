import type { Component, TUI } from "@earendil-works/pi-tui";
import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";

export function makeFooter(
  _ctx: ExtensionContext,
): (
  _tui: TUI,
  _theme: Theme,
  _footerData: ReadonlyFooterDataProvider,
) => Component & { dispose?(): void } {
  return () => ({
    render(): string[] {
      return [];
    },
    invalidate() {},
  });
}
