import type { Theme } from "@earendil-works/pi-coding-agent";

export interface StatusLineComponent {
  /** Higher values survive longer when the footer line must shrink. */
  priority?: number;
  render(width: number, theme: Theme): string[];
}
