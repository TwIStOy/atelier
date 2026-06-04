import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

export function extractMessageText(
  content: UserMessage["content"] | AssistantMessage["content"],
): string {
  if (typeof content === "string") return content;
  return content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

export function userMessageText(msg: UserMessage): string {
  return extractMessageText(msg.content);
}

export function assistantMessageText(msg: AssistantMessage): string {
  return extractMessageText(msg.content);
}
