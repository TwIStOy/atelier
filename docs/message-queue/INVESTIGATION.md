# Message Queue Extension — Investigation & API Discovery

> Findings from exploring pi's extension APIs relevant to implementing a Cursor-style message queue.

## I1. Core Problem

When the agent is busy (streaming / executing tools), user input should be **queued** instead of immediately processed. When the agent finishes, the queued message is sent automatically. Pressing Enter on an empty editor flushes the queue immediately.

## I2. Relevant APIs

### I2.1 Detecting Agent State

| API | Returns | Notes |
|-----|---------|-------|
| `ctx.isIdle()` | `boolean` | `false` when agent is streaming / has pending tool calls |
| `ctx.hasPendingMessages()` | `boolean` | `true` when there are queued messages awaiting delivery |

Both are used by `packages/goal/index.ts` to decide whether to queue continuation prompts.

### I2.2 Intercepting User Input

```ts
pi.on("input", async (event, ctx) => {
  // event.text    — the user's input text
  // event.images  — attached images (if any)
  // event.source  — "interactive" | "rpc" | "extension"

  // Return one of:
  return { action: "continue" };                    // pass through normally
  return { action: "transform", text: "..." };      // modify the input
  return { action: "handled" };                     // swallow — agent never sees it
});
```

This is the **primary interception point**. Returning `{ action: "handled" }` prevents the message from reaching the agent entirely. Used by `packages/user-input-history/index.ts` to record history.

### I2.3 Sending Messages Programmatically

```ts
// Send a user message (always triggers a turn)
pi.sendUserMessage(content: string | Content[], options?: {
  deliverAs?: "steer" | "followUp";
});
```

When the agent is busy:
- `deliverAs: "steer"` — injected into the current turn (between tool calls), like an interruption
- `deliverAs: "followUp"` — queued and delivered after the agent finishes its current turn

For this feature, `deliverAs: "followUp"` is the correct choice — we want the queued message to be sent as a new user message after the agent finishes.

### I2.4 Agent Lifecycle Events

```ts
pi.on("agent_start", (event, ctx) => { ... });  // Agent turn begins
pi.on("agent_end", (event, ctx) => { ... });    // Agent turn ends
```

`agent_end` fires when the agent finishes a complete turn (all LLM calls + tool executions). This is where we should check the queue and send the next message.

### I2.5 UI: Widget Below Editor

```ts
ctx.ui.setWidget("key", ["Line 1", "Line 2"], { placement: "belowEditor" });
ctx.ui.setWidget("key", undefined);  // clear
// Or rich component:
ctx.ui.setWidget("key", (tui, theme) => ({
  render(width: number): string[] { return [...]; },
  invalidate() {},
}), { placement: "belowEditor" });
```

Can display queue status below the editor (e.g., "1 message queued · Enter to send now").

### I2.6 Editor Text Access

```ts
ctx.ui.setEditorText("prefill");     // Set editor content
const text = ctx.ui.getEditorText(); // Read current editor content
```

### I2.7 Custom Editor (for Enter key interception)

```ts
class MyEditor extends CustomEditor {
  constructor(tui, theme, keybindings) {
    super(tui, theme, keybindings, { paddingX: 0 });
  }
}
ctx.ui.setEditorComponent((tui, theme, kb) => new MyEditor(tui, theme, kb));
```

`CustomEditor` extends the TUI `Editor` class. It receives raw `handleInput(data)` calls, but the submit action is managed by the enclosing `InteractiveMode`, not the editor itself.

### I2.8 Registering Keyboard Shortcuts

```ts
pi.registerShortcut("enter", {
  description: "Flush message queue",
  handler: async (ctx) => { ... },
});
```

`KeyId` is a string like `"enter"`, `"ctrl+r"`, etc. However, `registerShortcut` registers **app-level** keybindings that fire when the editor is focused — they compete with the editor's own Enter handling.

## I3. The "Empty Editor Enter" Problem

Pi's built-in `InteractiveMode` **does not emit an `input` event when the editor is empty** — it ignores empty submissions. This means we cannot use the `input` event to detect "user pressed Enter on empty editor."

### Options Investigated

| Approach | Feasibility | Notes |
|----------|-------------|-------|
| **A. `registerShortcut("enter")`** | Possible but risky | Would intercept *all* Enter presses, not just empty-editor ones. Would need to check `ctx.ui.getEditorText()` and forward non-empty submits manually. High chance of breaking normal message flow. |
| **B. Custom Editor** | Complex | `CustomEditor.handleInput` receives raw key sequences, but the submit logic is in `InteractiveMode`, not the editor. Overriding `handleInput` to detect Enter would require reimplementing the editor's key handling. |
| **C. Widget + `setEditorText` hint** | Pragmatic | When a message is queued, put a hint in the widget ("Enter to send now") and pre-fill the editor with the queued message text. User can edit it and press Enter normally. No empty-editor detection needed. |
| **D. Command-based flush** | Simplest | Register `/flush` or `/send` command that flushes the queue. Less elegant than Cursor's UX but zero risk of breaking input. |
| **E. `input` event with text check** | Best UX | When the agent is busy and user submits **any** text (even a single space or "go"), treat it as "flush the queue now." The new text can be appended to the queued message or sent separately. This avoids the empty-editor problem entirely. |

### Recommendation

**Option E + C combined** provides the best Cursor-like experience:

1. When agent is busy and user submits new text → queue the original text, send the queue immediately with the new text appended (or send queue first, then the new text as a follow-up).
2. Show a widget below the editor indicating queue status.
3. If the user really wants to send the queued message right now without typing anything, they can type something minimal ("go", "continue", etc.) and press Enter.

This avoids the empty-editor problem entirely while still providing a responsive queue experience.

## I4. Existing Patterns in This Monorepo

### I4.1 Goal Extension (`packages/goal/`)

The goal extension uses a similar pattern:

```ts
// In agent_end handler:
if (shouldQueueGoalContinuationAfterAgentEnd(goal, ctx.hasPendingMessages())) {
  pi.sendMessage(
    { customType: "pi-goal-continuation", content: "...", display: false },
    { triggerTurn: true, deliverAs: "followUp" },
  );
}
```

Key insight: it checks `ctx.hasPendingMessages()` to avoid stacking continuations on top of each other.

### I4.2 Memory Extension (`packages/memory/`)

Uses `ctx.isIdle()` guard in command handlers:

```ts
if (!ctx.isIdle()) {
  ctx.ui.notify("Agent is busy, try again later.", "warning");
  return;
}
```

This is the "reject" approach — our extension will do the opposite (queue instead of reject).

## I5. Thread Safety Notes

- Pi is single-threaded (Node.js event loop), so no mutex needed for the queue.
- `input` event handlers fire sequentially (extension chain), so we can safely read/write the queue.
- `agent_end` fires on the same event loop — no race between queue write and queue flush.
- Multiple queued messages: if the user types multiple messages while the agent is busy, they should be concatenated or kept as a FIFO queue. Cursor concatenates them. We should do the same.
