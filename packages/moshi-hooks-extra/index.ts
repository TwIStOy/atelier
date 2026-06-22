import type {
  ExtensionAPI,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { isMoshiHookAvailable, sendToMoshi } from "./moshi-client.ts";
import { textFromContent } from "./payload.ts";

export default function moshiHooksExtra(pi: ExtensionAPI): void {
  if (!isMoshiHookAvailable()) {
    return;
  }

  pi.on("tool_call", (event, ctx) => {
    sendToMoshi("ToolCallStart", event, ctx, {
      tool_call_id: event.toolCallId,
      tool_name: event.toolName,
      input: event.input,
    });
    return;
  });

  pi.on("tool_result", (event: ToolResultEvent, ctx) => {
    sendToMoshi("ToolCallEnd", event, ctx, {
      tool_call_id: event.toolCallId,
      tool_name: event.toolName,
      is_error: event.isError,
      content_preview: previewContent(event.content),
    });
    return;
  });
}

function previewContent(
  content: ToolResultEvent["content"],
  maxChars = 2000,
): string {
  const text = textFromContent(content);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated]`;
}
