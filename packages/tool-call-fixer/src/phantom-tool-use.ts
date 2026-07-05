import type { AssistantMessage } from "@earendil-works/pi-ai";

export interface PhantomToolUseResult {
  changed: boolean;
  message: AssistantMessage;
}

export function normalizePhantomToolUse(message: AssistantMessage): PhantomToolUseResult {
  if (message.role !== "assistant") {
    return { changed: false, message };
  }
  if (message.stopReason !== "toolUse") {
    return { changed: false, message };
  }
  const hasToolCall = Array.isArray(message.content) && message.content.some((block) => block.type === "toolCall");
  if (hasToolCall) {
    return { changed: false, message };
  }
  return {
    changed: true,
    message: {
      ...message,
      stopReason: "error",
      errorMessage: "stream ended before tool_calls were received (vLLM phantom tool_use)",
    },
  };
}
