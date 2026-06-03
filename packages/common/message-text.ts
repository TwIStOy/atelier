import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

export function extractMessageText(
  content: UserMessage["content"] | AssistantMessage["content"],
): string {
  if (typeof content === "string") return content;
  return content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

export function userMessageText(msg: UserMessage): string {
  return extractMessageText(msg.content);
}

export function assistantMessageText(msg: AssistantMessage): string {
  return extractMessageText(msg.content);
}
