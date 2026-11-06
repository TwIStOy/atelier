import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  InputEvent,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { getKeybindings, Key, matchesKey } from "@earendil-works/pi-tui";
import { MODAL_ACTIVE_EVENT } from "@htwang-contrib/common/events";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { registerTuiCommands } from "@htwang-contrib/common/tui-commands";
import type { QueuedMessage } from "./queue.ts";
import { MessageQueue } from "./queue.ts";
import { createQueuePanel, type QueueAction } from "./queue-panel.ts";
import { renderQueueWidget, WIDGET_KEY, WIDGET_OPTIONS } from "./queue-widget.ts";

const USER_MSG_QUEUE = { deliverAs: "followUp" as const };

export default function messageQueueExtension(pi: ExtensionAPI): void {
  if (isExtensionDisabled("message-queue")) return;
  const queue = new MessageQueue();
  let widgetCtx: ExtensionContext | null = null;
  let unsubTerminal: (() => void) | null = null;
  let panelOpen = false;
  let modalActive = false;
  let currentWidgetMessages: readonly QueuedMessage[] = [];

  function refreshWidget(): void {
    if (!widgetCtx?.hasUI) return;
    currentWidgetMessages = queue.items;
    if (queue.isEmpty) {
      hideQueueWidget();
      return;
    }
    showQueueWidget();
  }

  function hideQueueWidget(): void {
    widgetCtx?.ui.setWidget(WIDGET_KEY, undefined, WIDGET_OPTIONS);
    if (!panelOpen) disableEmptyEnter();
  }

  function showQueueWidget(): void {
    widgetCtx?.ui.setWidget(
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

  function buildContent(msg: QueuedMessage): string | (TextContent | ImageContent)[] {
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
    return kb.matches(data, "tui.input.submit") || kb.matches(data, "tui.select.confirm") || isPlainEnter(data);
  }

  function isPlainEnter(data: string): boolean {
    return matchesKey(data, Key.enter) || matchesKey(data, "return") || data === "\r" || data === "\n";
  }

  function handleEmptyEnter(data: string): { consume: boolean } | undefined {
    if (!emptyEnterAllowed(data)) return undefined;
    flushOnInput();
    refreshWidget();
    return { consume: true };
  }

  function emptyEnterAllowed(data: string): boolean {
    if (!queueInteractable()) return false;
    if (!isEmptyEditorSubmit(data)) return false;
    return editorIsEmpty();
  }

  function queueInteractable(): boolean {
    return !modalActive && !panelOpen && !queue.isEmpty;
  }

  function editorIsEmpty(): boolean {
    if (!widgetCtx?.hasUI) return false;
    return widgetCtx.ui.getEditorText().length === 0;
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

  pi.events.on(MODAL_ACTIVE_EVENT, (active: unknown) => {
    modalActive = Boolean(active);
  });

  pi.on("session_start", () => {
    queue.clear();
    modalActive = false;
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
    return routeQueueInput(event, ctx);
  });

  function routeQueueInput(
    event: InputEvent,
    ctx: { isIdle(): boolean },
  ): { action: "continue" } | { action: "handled" } {
    if (shouldBypassQueue(event, ctx)) return { action: "continue" } as const;
    queue.enqueue(event.text, event.images);
    refreshWidget();
    return { action: "handled" } as const;
  }

  function shouldBypassQueue(event: { source: string; text: string }, ctx: { isIdle(): boolean }): boolean {
    if (!isQueueableText(event)) return true;
    return queue.isEmpty && ctx.isIdle();
  }

  function isQueueableText(event: { source: string; text: string }): boolean {
    if (event.source === "extension") return false;
    if (event.text.startsWith("/")) return false;
    return event.text.trim().length > 0;
  }

  pi.on("agent_end", (_event, ctx) => {
    widgetCtx = ctx;
    setImmediate(() => {
      if (queue.isEmpty) return;
      if (ctx.hasPendingMessages()) return;
      flushOnAgentEnd();
    });
  });

  registerTuiCommands(pi, (api) => {
    api.registerCommand("queue", {
      description: "Manage queued messages in an interactive panel",
      handler: async (_rawArgs, ctx) => {
        if (!queuePanelAvailable(ctx)) return;
        await openQueuePanel(ctx);
      },
    });
  });

  function queuePanelAvailable(ctx: ExtensionCommandContext): boolean {
    if (!ctx.hasUI) {
      ctx.ui.notify("/queue requires an interactive terminal.", "warning");
      return false;
    }
    if (queue.isEmpty) {
      ctx.ui.notify("No messages in queue.", "info");
      return false;
    }
    return true;
  }

  async function openQueuePanel(ctx: ExtensionCommandContext): Promise<void> {
    panelOpen = true;
    disableEmptyEnter();

    const action = await ctx.ui.custom<QueueAction>((tui: TUI, theme: Theme, kb, done) =>
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
  }
}
