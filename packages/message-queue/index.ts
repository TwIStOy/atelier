import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { TUI } from "@earendil-works/pi-tui";
import { getKeybindings, Key, matchesKey } from "@earendil-works/pi-tui";
import { MessageQueue } from "./queue.ts";
import type { QueuedMessage } from "./queue.ts";
import {
  WIDGET_KEY,
  WIDGET_OPTIONS,
  renderQueueWidget,
} from "./queue-widget.ts";
import { createQueuePanel, type QueueAction } from "./queue-panel.ts";

const USER_MSG_QUEUE = { deliverAs: "followUp" as const };

export default function messageQueueExtension(pi: ExtensionAPI): void {
  const queue = new MessageQueue();
  let widgetCtx: ExtensionContext | null = null;
  let unsubTerminal: (() => void) | null = null;
  let panelOpen = false;
  let currentWidgetMessages: readonly QueuedMessage[] = [];

  function refreshWidget(): void {
    if (!widgetCtx?.hasUI) return;
    currentWidgetMessages = queue.items;
    if (queue.isEmpty) {
      widgetCtx.ui.setWidget(WIDGET_KEY, undefined, WIDGET_OPTIONS);
      if (!panelOpen) disableEmptyEnter();
      return;
    }
    widgetCtx.ui.setWidget(
      WIDGET_KEY,
      (_tui: unknown, theme: Theme) => ({
        render(width: number): string[] {
          return renderQueueWidget(currentWidgetMessages, theme, width);
        },
        invalidate() {},
      }),
      WIDGET_OPTIONS,
    );
    if (!panelOpen) enableEmptyEnter();
  }

  function buildContent(
    msg: QueuedMessage,
  ): string | (TextContent | ImageContent)[] {
    if (!msg.images || msg.images.length === 0) return msg.text;
    return [{ type: "text", text: msg.text } as TextContent, ...msg.images];
  }

  function flushOnAgentEnd(): void {
    if (queue.isEmpty) return;
    const msg = queue.dequeue()!;
    pi.sendUserMessage(buildContent(msg), USER_MSG_QUEUE);
    refreshWidget();
  }

  function flushOnInput(): void {
    if (queue.isEmpty) return;
    const msg = queue.dequeue()!;
    setImmediate(() => {
      pi.sendUserMessage(buildContent(msg), USER_MSG_QUEUE);
    });
  }

  function sendFromPanel(index: number): void {
    const msg = queue.removeAt(index);
    if (!msg) return;
    pi.sendUserMessage(buildContent(msg), USER_MSG_QUEUE);
    refreshWidget();
  }

  function deleteAt(index: number): void {
    queue.removeAt(index);
    refreshWidget();
  }

  function isEmptyEditorSubmit(data: string): boolean {
    const kb = getKeybindings();
    return (
      kb.matches(data, "tui.input.submit") ||
      kb.matches(data, "tui.select.confirm") ||
      matchesKey(data, Key.enter) ||
      matchesKey(data, "return") ||
      data === "\r" ||
      data === "\n"
    );
  }

  function handleEmptyEnter(data: string): { consume: boolean } | undefined {
    if (panelOpen) return undefined;
    if (queue.isEmpty) return undefined;
    if (!isEmptyEditorSubmit(data)) return undefined;
    if (!widgetCtx?.hasUI) return undefined;
    if (widgetCtx.ui.getEditorText().length > 0) return undefined;
    flushOnInput();
    refreshWidget();
    return { consume: true };
  }

  function enableEmptyEnter(): void {
    if (unsubTerminal || !widgetCtx?.hasUI) return;
    unsubTerminal = widgetCtx.ui.onTerminalInput(handleEmptyEnter);
  }

  function disableEmptyEnter(): void {
    if (unsubTerminal) {
      unsubTerminal();
      unsubTerminal = null;
    }
  }

  pi.on("session_start", () => {
    queue.clear();
    disableEmptyEnter();
    refreshWidget();
  });

  pi.on("session_shutdown", () => {
    widgetCtx = null;
    queue.clear();
    disableEmptyEnter();
  });

  pi.on("input", (event, ctx) => {
    widgetCtx = ctx;

    if (event.source === "extension") {
      return { action: "continue" } as const;
    }

    const trimmed = event.text.trim();

    if (event.text.startsWith("/")) {
      return { action: "continue" } as const;
    }

    if (trimmed.length === 0) {
      return { action: "continue" } as const;
    }

    if (!queue.isEmpty || !ctx.isIdle()) {
      queue.enqueue(event.text, event.images);
      refreshWidget();
      return { action: "handled" } as const;
    }

    return { action: "continue" } as const;
  });

  pi.on("agent_end", (_event, ctx) => {
    widgetCtx = ctx;
    setImmediate(() => {
      if (queue.isEmpty) return;
      if (ctx.hasPendingMessages()) return;
      flushOnAgentEnd();
    });
  });

  pi.registerCommand("queue", {
    description: "Manage queued messages in an interactive panel",
    handler: async (_rawArgs, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("/queue requires an interactive terminal.", "warning");
        return;
      }
      if (queue.isEmpty) {
        ctx.ui.notify("No messages in queue.", "info");
        return;
      }

      panelOpen = true;
      disableEmptyEnter();

      const action = await ctx.ui.custom<QueueAction>(
        (tui: TUI, theme: Theme, kb, done) =>
          createQueuePanel(
            () => queue.items,
            (idx) => deleteAt(idx),
            theme,
            tui,
            kb,
            done,
          ),
      );

      panelOpen = false;
      refreshWidget();

      if (action?.kind === "send") {
        sendFromPanel(action.index);
      }
    },
  });
}
