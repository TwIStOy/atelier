# Tool Display Adapters Reference

Tool display adapters customize how registered tools render in the TUI. They live in `packages/tool-display/adapters/`.

## Adapter Interface

```typescript
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ToolDisplayAdapter } from "../types.ts";

interface ToolDisplayAdapter<TArgs = Record<string, unknown>> {
  formatCallHeader(
    args: TArgs,
    theme: Theme,
    details?: unknown,
    isPartial?: boolean,
    expanded?: boolean,
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
```

## Conventions

### Header
- Use `theme.fg("toolTitle", theme.bold("ToolName"))` for the label
- Tool labels use `CamelCase` (e.g., `CreateGoal`, `UpdateGoal`), **not** `Create Goal`
- Show key args inline (path, objective preview, etc.)

### Collapsed Content
- Use `theme.fg("muted", "└ ...")` — no manual indent prefix, the rendering system adds it
- Keep to 1-2 lines maximum
- Show status summary from `details`

### Expanded Content
- Use `theme.fg("toolOutput", line)` per line with `truncateToWidth`
- Can use `formatExpandedToolOutputLines` from `./shared.ts` for standard output rendering

## Registration

In `packages/tool-display/registry.ts`:

```typescript
import { myToolAdapter } from "./adapters/my-tool.ts";
globalToolDisplayRegistry.register("my_tool", myToolAdapter);
```

In `packages/tool-display/index.ts`:

```typescript
export { myToolAdapter } from "./adapters/my-tool.ts";
```

## Example: Simple Status Tool

```typescript
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines } from "./shared.ts";

interface MyToolArgs {
  action: string;
}

export const myToolAdapter: ToolDisplayAdapter<MyToolArgs> = {
  formatCallHeader(args, theme, _details, _isPartial, _expanded) {
    const label = theme.fg("toolTitle", theme.bold("MyTool"));
    const action = theme.fg("accent", args.action);
    return `${label} ${action}`;
  },

  formatCollapsedContent(_args, _output, theme, _width, details) {
    const d = details as Record<string, unknown> | undefined;
    const ok = d?.success;
    if (ok) {
      return [theme.fg("muted", "└ ✓ done")];
    }
    return [theme.fg("muted", "└ failed")];
  },

  formatExpandedContent(_args, output, theme, width) {
    if (!output) return [];
    return formatExpandedToolOutputLines(output, theme, width);
  },
};
```

## Shared Helpers

From `packages/tool-display/adapters/shared.ts`:

| Helper | Purpose |
|--------|---------|
| `formatExpandedToolOutputLines(output, theme, width)` | Indented, truncated output lines |
| `formatLineCount(content, theme)` | `└ N lines` summary |
| `renderContentWithLineNumbers(content, startLine, filePath, theme, width)` | Syntax-highlighted code with line numbers |

## Theme Colors for Tool Display

| Color | Usage |
|-------|-------|
| `"toolTitle"` | Tool name label |
| `"toolOutput"` | Output text content |
| `"accent"` | Highlighted args (paths, actions) |
| `"muted"` | Collapsed summaries, tree branches |
| `"dim"` | Secondary info |
| `"success"` | Success indicators (✓, ●) |
| `"error"` | Error indicators (✗) |
| `"warning"` | Warning indicators |

## Common Imports

```typescript
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { truncateDisplay } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, formatLineCount } from "./shared.ts";
```
