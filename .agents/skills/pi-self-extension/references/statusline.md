# Statusline & UI Customization Reference

Pi does not have a single `registerStatusLine` API. Instead, it provides layered composable UI primitives via `ctx.ui` for customizing the area around the user's prompt input.

## UI Layout Map

```
┌─────────────────────────────────────────┐
│  Header        (setHeader)              │  ← Logo, startup banner
├─────────────────────────────────────────┤
│                                         │
│  Chat / message history                 │
│                                         │
├─────────────────────────────────────────┤
│  Widget above  (setWidget, aboveEditor) │  ← Info lines above prompt
├─────────────────────────────────────────┤
│  ┌─ Editor border top ────────────────┐ │  ← setEditorComponent border
│  │  User prompt input                 │ │
│  └─ Editor border bottom ────────────┘ │  ← setEditorComponent border
├─────────────────────────────────────────┤
│  Widget below  (setWidget, belowEditor) │  ← Info lines below prompt
├─────────────────────────────────────────┤
│  Footer        (setFooter / setStatus)  │  ← Model, branch, cost
└─────────────────────────────────────────┘
```

## Core APIs

### 1. `ctx.ui.setStatus(key, text)` — Simple Footer Text

Set named text in the built-in footer status bar. Multiple extensions can coexist using different keys. Pass `undefined` to clear.

```typescript
ctx.ui.setStatus("my-ext", theme.fg("dim", "Ready"));
ctx.ui.setStatus("my-ext", undefined); // clear
```

**Events to react to:** `session_start`, `turn_start`, `turn_end`, `model_select`

### 2. `ctx.ui.setWidget(key, content, options?)` — Lines Above/Below Editor

Display arbitrary text lines or rich components near the editor.

```typescript
// Simple string lines
ctx.ui.setWidget("my-widget", ["Line 1", "Line 2"], { placement: "aboveEditor" });
ctx.ui.setWidget("my-widget", ["Below"], { placement: "belowEditor" });
ctx.ui.setWidget("my-widget", undefined); // clear

// Rich component factory
ctx.ui.setWidget("my-widget", (tui, theme) => {
    return {
        render(width: number): string[] {
            return [theme.fg("accent", `Width: ${width}`)];
        },
        invalidate() {},
    };
}, { placement: "aboveEditor" });
```

**Options:**
- `placement`: `"aboveEditor"` (default) or `"belowEditor"`

**Component interface:**
```typescript
interface Component {
    render(width: number): string[];
    invalidate(): void;
    dispose?(): void;
}
```

### 3. `ctx.ui.setFooter(factory)` — Full Custom Footer

Replace the entire footer with a custom component. The factory receives `ReadonlyFooterDataProvider` for git branch and extension statuses.

```typescript
ctx.ui.setFooter((tui, theme, footerData) => {
    const unsub = footerData.onBranchChange(() => tui.requestRender());
    return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
            const branch = footerData.getGitBranch();
            const statuses = footerData.getExtensionStatuses();
            const left = theme.fg("dim", "status text");
            const right = theme.fg("dim", "right side");
            const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
            return [truncateToWidth(left + pad + right, width)];
        },
    };
});
ctx.ui.setFooter(undefined); // restore default
```

**`ReadonlyFooterDataProvider` methods:**
| Method | Returns | Description |
|--------|---------|-------------|
| `getGitBranch()` | `string \| null` | Current git branch |
| `getExtensionStatuses()` | `ReadonlyMap<string, string>` | All `setStatus()` texts |
| `getAvailableProviderCount()` | `number` | Providers with models |
| `onBranchChange(cb)` | `() => void` | Subscribe to branch changes |

### 4. `ctx.ui.setEditorComponent(factory)` — Custom Editor with Border Status

Replace the editor to embed status info in the top/bottom border lines. Extend `CustomEditor` for full keybinding support.

```typescript
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

class BorderStatusEditor extends CustomEditor {
    constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
        super(tui, theme, keybindings, { paddingX: 0 });
    }

    render(width: number): string[] {
        const lines = super.render(width);
        if (lines.length < 2) return lines;

        // Top border = lines[0], Bottom border = lines[last]
        const topLeft = "...";
        const topRight = "...";
        const bottomLeft = "...";
        const bottomRight = "...";

        lines[0] = fitBorder(topLeft, topRight, width, (t) => this.borderColor(t));
        lines[lines.length - 1] = fitBorder(bottomLeft, bottomRight, width, (t) => this.borderColor(t));
        return lines;
    }
}

ctx.ui.setEditorComponent((tui, theme, keybindings) => new BorderStatusEditor(tui, theme, keybindings));
ctx.ui.setEditorComponent(undefined); // restore default
```

**Helper: `fitBorder`** — pads left/right text into a border line:
```typescript
function fitBorder(left: string, right: string, width: number, border: (t: string) => string): string {
    const gapWidth = Math.max(0, width - 2 - visibleWidth(left) - visibleWidth(right));
    return `${border("─")}${left}${border("─".repeat(gapWidth))}${right}${border("─")}`;
}
```

### 5. `ctx.ui.setWorkingIndicator(options?)` — Streaming Loader

```typescript
ctx.ui.setWorkingIndicator({
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    intervalMs: 80,
});
ctx.ui.setWorkingIndicator(); // restore default
ctx.ui.setWorkingIndicator({ frames: [] }); // hide
```

The loader row renders `<frame> <message>`. The spinner comes from `setWorkingIndicator`; **the message comes from `setWorkingMessage(text)`** (no arg resets to default "Working..."). The two are independent.

**Gotcha — `agent_start` recreates the loader.** On every `agent_start`, interactive-mode stops and recreates the working loader, re-reading `workingMessage ?? "Working..."`. If you call `setWorkingMessage()` (no arg) on `message_end`, the next turn's `agent_start` flashes "Working..." until your next `message_update` repushes. To keep a custom message stable across turns: **push it in `agent_start`** (`setWorkingMessage(text)` before tokens stream) and **don't clear it in `message_end`**.

To drive a live timer (e.g. "thinking Ns..."), detect phase from `message_update`'s `event.assistantMessageEvent` discriminant (`thinking_start`/`thinking_delta` to enter, `text_*`/`toolcall_start` to exit) and run a `setInterval` that re-calls `setWorkingMessage`.

### 6. `ctx.ui.setWorkingVisible(visible)` — Show/Hide Loader Row

```typescript
ctx.ui.setWorkingVisible(false); // hide built-in working row (useful when embedding in editor borders)
```

## Theme Colors

```typescript
ctx.ui.theme.fg("dim", "text");      // dimmed
ctx.ui.theme.fg("muted", "text");    // muted
ctx.ui.theme.fg("accent", "text");   // accent/highlight
ctx.ui.theme.fg("success", "text");  // green
ctx.ui.theme.fg("error", "text");    // red
ctx.ui.theme.fg("warning", "text");  // yellow
```

## Useful Imports

```typescript
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { Component, EditorTheme, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AssistantMessage } from "@earendil-works/pi-ai";
```

## Data Access Patterns

```typescript
// Current model
ctx.model?.id           // "glm-5.1"
ctx.model?.name         // "GLM 5.1" (display name)
ctx.model?.provider     // "zai-coding-plan"
ctx.model?.reasoning    // true/false

// Thinking level
pi.getThinkingLevel()   // "minimal" | "low" | "medium" | "high" | "xhigh"

// Context usage
ctx.getContextUsage()   // { tokens, contextWindow, percent }

// Current working directory
ctx.cwd                 // "/path/to/project"

// Token stats from session
for (const e of ctx.sessionManager.getBranch()) {
    if (e.type === "message" && e.message.role === "assistant") {
        const m = e.message as AssistantMessage;
        m.usage.input;        // input tokens
        m.usage.output;       // output tokens
        m.usage.cacheRead;    // cache read tokens
        m.usage.cacheWrite;   // cache write tokens
        m.usage.totalTokens;  // total tokens
        m.usage.cost.total;   // cost in dollars
    }
}
```

## Example Extensions

| Example | Path | APIs Used |
|---------|------|-----------|
| Status line | `examples/extensions/status-line.ts` | `setStatus` |
| Widget placement | `examples/extensions/widget-placement.ts` | `setWidget` |
| Custom footer | `examples/extensions/custom-footer.ts` | `setFooter` |
| Custom header | `examples/extensions/custom-header.ts` | `setHeader` |
| Border status editor | `examples/extensions/border-status-editor.ts` | `setEditorComponent`, `CustomEditor` |
| Working indicator | `examples/extensions/working-indicator.ts` | `setWorkingIndicator` |
| Model status | `examples/extensions/model-status.ts` | `setStatus` on `model_select` |
