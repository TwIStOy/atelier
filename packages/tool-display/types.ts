import type { Theme } from "@earendil-works/pi-coding-agent";

export interface ContentRenderer {
  (content: string, theme: Theme, width: number): string[];
}

export interface ToolDisplayAdapter<TArgs = Record<string, unknown>> {
  formatCallHeader(
    args: TArgs,
    theme: Theme,
    details?: unknown,
    isPartial?: boolean,
  ): string;
  formatCollapsedContent(
    args: TArgs,
    output: string,
    theme: Theme,
    width: number,
    details?: unknown,
    isPartial?: boolean,
    spinAt?: number,
  ): string[];
  formatExpandedContent(
    args: TArgs,
    output: string,
    theme: Theme,
    width: number,
    details?: unknown,
  ): string[];
}
