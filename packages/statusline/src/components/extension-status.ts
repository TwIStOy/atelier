import type { ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { StatusLineComponent } from "./base.ts";

export class ExtensionStatusComponent implements StatusLineComponent {
  constructor(private readonly footerData: ReadonlyFooterDataProvider) {}

  render(_width: number, theme: Theme): string[] {
    const statuses = this.footerData.getExtensionStatuses();
    if (statuses.size === 0) return [];
    const separator = theme.fg("dim", " ");
    return [Array.from(statuses.values()).join(separator)];
  }
}
