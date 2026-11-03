import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  AssistantMessageComponent,
  getMarkdownTheme,
  ToolExecutionComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, type TUI } from "@earendil-works/pi-tui";

function getUserText(message: AgentMessage): string {
  if (message.role !== "user") return "";
  const c = message.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return (c as { type: string; text?: string }[])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join("\n");
}

export type SubagentConversationRenderOptions = {
  expanded: boolean;
  hideThinkingBlock: boolean;
};

type ToolResultLike = {
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
  details?: unknown;
};

export function buildSubagentConversation(
  messages: AgentMessage[],
  opts: SubagentConversationRenderOptions,
  tui: TUI,
  cwd: string,
): Container {
  const markdownTheme = getMarkdownTheme();
  const container = new Container();
  const pending = new Map<string, ToolExecutionComponent>();

  const addSpacer = () => container.addChild(new Spacer(1));

  for (const message of messages) {
    if (message.role === "assistant") {
      const assistant = new AssistantMessageComponent(message, opts.hideThinkingBlock, markdownTheme);
      if (container.children.length > 0) addSpacer();
      container.addChild(assistant);

      for (const part of message.content as {
        type: string;
        id?: string;
        name?: string;
        arguments?: unknown;
      }[]) {
        if (part.type !== "toolCall") continue;
        if (!part.id || !part.name) continue;
        const tool = new ToolExecutionComponent(
          part.name,
          part.id,
          part.arguments ?? {},
          { showImages: true },
          undefined,
          tui,
          cwd,
        );
        tool.setExpanded(opts.expanded);
        container.addChild(tool);

        if (message.stopReason === "aborted" || message.stopReason === "error") {
          const reason = message.stopReason === "aborted" ? "Operation aborted" : (message.errorMessage ?? "Error");
          tool.updateResult({
            content: [{ type: "text", text: reason }],
            isError: true,
          });
        } else {
          pending.set(part.id, tool);
        }
      }
    } else if (message.role === "toolResult") {
      const component = pending.get(message.toolCallId);
      if (component) {
        const result = message as unknown as ToolResultLike;
        component.updateResult({
          content: result.content,
          isError: result.isError,
          details: result.details,
        });
        pending.delete(message.toolCallId);
      }
    } else if (message.role === "user") {
      const text = getUserText(message);
      if (text) {
        if (container.children.length > 0) addSpacer();
        container.addChild(new UserMessageComponent(text, markdownTheme));
      }
    }
  }

  return container;
}

class Spacer implements Component {
  constructor(private readonly rows: number) {}
  invalidate(): void {}
  render(): string[] {
    return Array.from({ length: this.rows }, () => "");
  }
}
