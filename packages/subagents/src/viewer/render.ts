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

type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;
type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;
type UserMessage = Extract<AgentMessage, { role: "user" }>;

type ToolCallPart = {
  type: string;
  id?: string;
  name?: string;
  arguments?: unknown;
};

type ResolvedToolCallPart = {
  type: string;
  id: string;
  name: string;
  arguments?: unknown;
};

type ConversationBuild = {
  container: Container;
  pending: Map<string, ToolExecutionComponent>;
  opts: SubagentConversationRenderOptions;
  markdownTheme: ReturnType<typeof getMarkdownTheme>;
  tui: TUI;
  cwd: string;
};

function isActionableToolCall(part: ToolCallPart): part is ResolvedToolCallPart {
  return part.type === "toolCall" && Boolean(part.id) && Boolean(part.name);
}

function abortedToolReason(message: AssistantMessage): string {
  return message.stopReason === "aborted" ? "Operation aborted" : (message.errorMessage ?? "Error");
}

function settleToolCall(
  build: ConversationBuild,
  message: AssistantMessage,
  toolCallId: string,
  tool: ToolExecutionComponent,
): void {
  if (message.stopReason === "aborted" || message.stopReason === "error") {
    tool.updateResult({
      content: [{ type: "text", text: abortedToolReason(message) }],
      isError: true,
    });
    return;
  }
  build.pending.set(toolCallId, tool);
}

function addToolCall(build: ConversationBuild, message: AssistantMessage, part: ToolCallPart): void {
  if (!isActionableToolCall(part)) return;
  const tool = new ToolExecutionComponent(
    part.name,
    part.id,
    part.arguments ?? {},
    { showImages: true },
    undefined,
    build.tui,
    build.cwd,
  );
  tool.setExpanded(build.opts.expanded);
  build.container.addChild(tool);
  settleToolCall(build, message, part.id, tool);
}

function addAssistantMessage(build: ConversationBuild, message: AssistantMessage): void {
  const assistant = new AssistantMessageComponent(message, build.opts.hideThinkingBlock, build.markdownTheme);
  // The component emits its own leading blank, exactly as it does in the host
  // chat container, so no spacer is added here.
  build.container.addChild(assistant);
  for (const part of message.content as ToolCallPart[]) {
    addToolCall(build, message, part);
  }
}

function applyToolResult(build: ConversationBuild, message: ToolResultMessage): void {
  const component = build.pending.get(message.toolCallId);
  if (!component) return;
  const result = message as unknown as ToolResultLike;
  component.updateResult({
    content: result.content,
    isError: result.isError,
    details: result.details,
  });
  build.pending.delete(message.toolCallId);
}

function addUserMessage(build: ConversationBuild, message: UserMessage): void {
  const text = getUserText(message);
  if (!text) return;
  if (build.container.children.length > 0) build.container.addChild(new Spacer(1));
  build.container.addChild(new UserMessageComponent(text, build.markdownTheme));
}

function addMessage(build: ConversationBuild, message: AgentMessage): void {
  if (message.role === "assistant") {
    addAssistantMessage(build, message);
    return;
  }
  if (message.role === "toolResult") {
    applyToolResult(build, message);
    return;
  }
  if (message.role === "user") {
    addUserMessage(build, message);
  }
}

export function buildSubagentConversation(
  messages: AgentMessage[],
  opts: SubagentConversationRenderOptions,
  tui: TUI,
  cwd: string,
): Container {
  const build: ConversationBuild = {
    container: new Container(),
    pending: new Map<string, ToolExecutionComponent>(),
    opts,
    markdownTheme: getMarkdownTheme(),
    tui,
    cwd,
  };
  for (const message of messages) {
    addMessage(build, message);
  }
  return build.container;
}

class Spacer implements Component {
  constructor(private readonly rows: number) {}
  invalidate(): void {}
  render(): string[] {
    return Array.from({ length: this.rows }, () => "");
  }
}
