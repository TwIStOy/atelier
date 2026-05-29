import type { Theme } from "@earendil-works/pi-coding-agent";

export interface ContentRenderer {
  (content: string, theme: Theme, width: number): string[];
}

export interface ToolDisplayAdapter<TArgs = Record<string, unknown>> {
  formatCallHeader(args: TArgs, theme: Theme): string;
  formatCollapsedContent(
    args: TArgs,
    output: string,
    theme: Theme,
    width: number,
  ): string[];
  formatExpandedContent(
    args: TArgs,
    output: string,
    theme: Theme,
    width: number,
  ): string[];
}
