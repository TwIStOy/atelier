import type { Theme } from "@earendil-works/pi-coding-agent";

export type ContentRenderer = (content: string, theme: Theme, width: number) => string[];

// Structural view of the ToolExecutionComponent prototype the grouping scan and
// the render patch read. Kept structural so grouping tests can drive it without
// the patch installed.
export type ToolExecutionPatchThis = {
  hideComponent?: boolean;
  __tdHovered?: boolean;
  __tdAggregateLeadingBlank?: boolean;
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  expanded: boolean;
  isPartial: boolean;
  result?: { details?: unknown; isError?: boolean; content?: unknown[] };
  showImages?: boolean;
  toolDefinition?: {
    label?: string;
    description?: string;
    renderCall?: unknown;
    renderResult?: unknown;
  };
  builtInToolDefinition?: {
    label?: string;
    description?: string;
    renderCall?: unknown;
    renderResult?: unknown;
  };
  getTextOutput?: () => string | undefined;
  getCallRenderer?: () => unknown;
  getResultRenderer?: () => unknown;
  setExpanded(expanded: boolean): void;
  invalidate(): void;
};

export interface ToolDisplayAdapter<TArgs = Record<string, unknown>> {
  formatCallHeader(
    args: TArgs,
    theme: Theme,
    details?: unknown,
    isPartial?: boolean,
    expanded?: boolean,
    width?: number,
    output?: string,
    headerAnnotation?: string,
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
  formatExpandedContent(args: TArgs, output: string, theme: Theme, width: number, details?: unknown): string[];
}
