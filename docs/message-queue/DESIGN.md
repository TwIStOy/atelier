# Message Queue Extension — Design Document

> Cursor-style message queue for pi: intercept user input while agent is busy, queue it, auto-send when agent finishes, and allow immediate flush.

## D1. Overview

When the agent is busy (streaming / executing tools), the user's next message should be **queued** rather than sent immediately. When the agent finishes its turn, the queued message is sent automatically. The user can also force-send the queued message immediately by submitting new input while a message is queued.

Key properties:

- **Non-blocking** — user can always type; the extension decides what happens.
- **Transparent** — widget shows queue status; no mystery about where the message went.
- **FIFO** — if multiple messages are queued, they are sent in order.
- **Immediate flush** — any new submission while a message is queued triggers immediate delivery.

## D2. User Experience

### D2.1 Normal Flow

```
Agent: [idle]  User types "fix the bug" → Enter
  → Message sent immediately (no queue)

Agent: [busy]  User types "also check tests" → Enter
  → Message QUEUED
  → Widget: "💬 1 message queued · type anything to send now"

Agent: [busy]  User types "go" → Enter
  → Queue FLUSHED: "also check tests" sent immediately
  → "go" appended or sent as follow-up

Agent: [finishes turn]
  → If queue has messages: auto-send first queued message
```

### D2.2 Multiple Queue

```
Agent: [busy]  User types "do A" → Enter   → Queue: ["do A"]
Agent: [busy]  User types "do B" → Enter   → Queue: ["do A", "do B"]
  → Widget: "💬 2 messages queued"

Agent: [finishes turn]
  → Auto-send "do A" via sendUserMessage
  → Queue: ["do B"]

Agent: [finishes next turn]
  → Auto-send "do B" via sendUserMessage
  → Queue: [] → widget cleared
```

### D2.3 Immediate Flush

When a message is already queued and the user submits new input:

```
Queue: ["check tests"]
User types "also fix lint" → Enter
  → Flush: send "check tests" immediately (bypass waiting for agent_end)
  → Queue: ["also fix lint"]
```

This replaces the "empty editor Enter" UX from Cursor with a more practical "any new input flushes" approach, since pi does not emit events for empty-editor submissions.

## D3. Architecture

```
packages/message-queue/
  index.ts              ← Extension entry
  queue.ts              ← Queue state management
  queue-widget.ts       ← Widget rendering
  package.json
  tsconfig.json
```

### D3.1 Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                     input event                         │
│                                                         │
│  ctx.isIdle()?                                         │
│    ├── YES → { action: "continue" }                    │
│    │         (pass through to agent normally)           │
│    │                                                    │
│    └── NO  → enqueue(event.text)                       │
│              update widget                              │
│              { action: "handled" }                      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    agent_end event                      │
│                                                         │
│  queue.isNotEmpty() AND !ctx.hasPendingMessages()?     │
│    ├── YES → dequeue() → pi.sendUserMessage(text)      │
│    │         update widget                              │
│    │                                                    │
│    └── NO  → nothing                                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│               input event (queue active)                │
│                                                         │
│  queue.isNotEmpty()?                                    │
│    ├── YES → flush queue immediately                   │
│    │         pi.sendUserMessage(dequeue(), {followUp})  │
│    │         enqueue new text                           │
│    │         update widget                              │
│    │         { action: "handled" }                      │
│    │                                                    │
│    └── NO  → normal flow (see above)                   │
└─────────────────────────────────────────────────────────┘
```

### D3.2 Queue State

```ts
interface QueuedMessage {
  text: string;
  images?: ImageContent[];
  queuedAt: number;
}
```

The queue is a simple `QueuedMessage[]` stored in a module-level variable. No persistence needed — the queue is ephemeral and cleared on session end.

## D4. Module Design

### D4.1 `queue.ts` — Queue State Management

```ts
import type { ImageContent } from "@earendil-works/pi-coding-agent";

interface QueuedMessage {
  text: string;
  images?: ImageContent[];
  queuedAt: number;
}

export class MessageQueue {
  private items: QueuedMessage[] = [];

  enqueue(text: string, images?: ImageContent[]): void {
    this.items.push({ text, images, queuedAt: Date.now() });
  }

  dequeue(): QueuedMessage | undefined {
    return this.items.shift();
  }

  peek(): QueuedMessage | undefined {
    return this.items[0];
  }

  get length(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  clear(): void {
    this.items = [];
  }
}
```

### D4.2 `queue-widget.ts` — Widget Rendering

Displays queue status below the editor.

```ts
import type { Component } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

const WIDGET_KEY = "htwang-contrib-message-queue";
const WIDGET_OPTIONS = { placement: "belowEditor" as const };

export function updateQueueWidget(
  ctx: { ui: { setWidget: Function; theme: Theme } },
  queueLength: number,
): void {
  if (queueLength === 0) {
    ctx.ui.setWidget(WIDGET_KEY, undefined, WIDGET_OPTIONS);
    return;
  }

  ctx.ui.setWidget(
    WIDGET_KEY,
    (_tui: unknown, theme: Theme) => ({
      render(width: number): string[] {
        const count = queueLength === 1
          ? "1 message queued"
          : `${queueLength} messages queued`;
        const hint = "type anything to send now";
        const left = theme.fg("accent", `💬 ${count}`);
        const sep = theme.fg("muted", " · ");
        const right = theme.fg("muted", hint);
        // pad to width...
        return [`${left}${sep}${right}`];
      },
      invalidate() {},
    }),
    WIDGET_OPTIONS,
  );
}
```

### D4.3 `index.ts` — Extension Entry

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MessageQueue } from "./queue.ts";
import { updateQueueWidget } from "./queue-widget.ts";

const WIDGET_KEY = "htwang-contrib-message-queue";

export default function (pi: ExtensionAPI) {
  const queue = new MessageQueue();
  let widgetCtx: ExtensionContext | null = null;

  function refreshWidget(): void {
    if (!widgetCtx?.hasUI) return;
    updateQueueWidget(widgetCtx, queue.length);
  }

  function flushQueue(): void {
    if (queue.isEmpty) return;
    const msg = queue.dequeue()!;
    pi.sendUserMessage(
      msg.images ? [{ type: "text", text: msg.text }, ...msg.images] : msg.text,
      { deliverAs: "followUp" },
    );
    refreshWidget();
  }

  pi.on("session_start", (_event, ctx) => {
    widgetCtx = ctx;
    queue.clear();
    refreshWidget();
  });

  pi.on("session_shutdown", () => {
    widgetCtx = null;
    queue.clear();
  });

  pi.on("input", (event, ctx) => {
    const trimmed = event.text.trim();

    // If queue has items and user submits new input → flush immediately
    if (!queue.isEmpty && trimmed.length > 0) {
      flushQueue();
      // Queue the new input for after flush
      queue.enqueue(event.text, event.images);
      refreshWidget();
      return { action: "handled" };
    }

    // If agent is busy → queue the message
    if (!ctx.isIdle() && trimmed.length > 0) {
      queue.enqueue(event.text, event.images);
      refreshWidget();
      return { action: "handled" };
    }

    // Otherwise pass through
    return { action: "continue" };
  });

  pi.on("agent_end", (_event, ctx) => {
    // Auto-send next queued message when agent finishes
    if (!queue.isEmpty && !ctx.hasPendingMessages()) {
      flushQueue();
    }
  });
}
```

## D5. Edge Cases

### D5.1 Slash Commands While Agent Is Busy

If the user types a slash command (e.g., `/goal show`) while the agent is busy, the `input` event fires but the text starts with `/`. Slash commands are processed *before* the `input` event in some flows — need to verify.

**Mitigation:** Only queue messages that don't start with `/`. Let slash commands pass through with `{ action: "continue" }`.

```ts
if (event.text.startsWith("/")) {
  return { action: "continue" };
}
```

### D5.2 Multiple Rapid Inputs

If the user submits multiple messages in quick succession while the agent is busy, each is queued in order. The `agent_end` handler sends one at a time per turn, so messages are naturally serialized.

### D5.3 Session Switch / Reload

On `session_start` with reason `"reload"` or `"new"`, the queue should be cleared since the session context changes. On `"resume"`, the queue should also be cleared since any queued messages were from a previous interaction context.

### D5.4 Agent Ends With Pending Messages

If `ctx.hasPendingMessages()` is true in `agent_end` (e.g., the goal extension queued a continuation), we should not send our queued message — it would race with the pending message. Wait for the next `agent_end` when `hasPendingMessages()` is false.

### D5.5 Images

The `InputEvent` includes `images?: ImageContent[]`. These must be preserved in the queue and forwarded when the message is sent.

## D6. Configuration

No configuration needed for the initial version. The extension is opt-in via `pi.extensions` in the root `package.json`.

Future considerations:
- Max queue size (default: unlimited)
- Queue behavior: FIFO vs concatenate all queued messages into one
- Whether to show queue count in the editor border instead of a separate widget

## D7. Package Setup

### D7.1 `package.json`

```json
{
  "name": "@htwang-contrib/message-queue",
  "version": "0.1.0",
  "type": "module",
  "main": "index.ts",
  "types": "index.ts",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "dependencies": {},
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "latest",
    "@earendil-works/pi-tui": "^0.76.0",
    "@types/node": "^25.9.1",
    "typescript": "^6.0.0"
  }
}
```

No runtime dependencies — the extension uses only pi's built-in APIs.

### D7.2 Integration

- Add `"packages/message-queue"` to `pi.extensions` in root `package.json`.
- Add `{ "path": "packages/message-queue" }` to root `tsconfig.json` references.

## D8. Future Enhancements

1. **Editor border integration** — Instead of a separate widget, embed queue status in the editor's bottom border (like `packages/statusline/editor.ts` does for model/context info).
2. **Queue preview** — Show a preview of the queued message in the widget (truncated to one line).
3. **Cancel queue** — A `/flush clear` command to discard all queued messages.
4. **Concatenation mode** — Option to concatenate all queued messages into a single message with separators, rather than sending them one-by-one.
5. **Sound / visual notification** — Alert the user when a queued message is auto-sent.
