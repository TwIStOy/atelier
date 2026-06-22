import type {
  ExtensionAPI,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import {
  isMoshiHookAvailable,
  resolveTransportMode,
  sendEnvelope,
} from "./moshi-client.ts";
import { previewContent } from "./envelope.ts";

export default function moshiHooksExtra(pi: ExtensionAPI): void {
  if (!isMoshiHookAvailable()) {
    return;
  }

  const transport = resolveTransportMode();
  if (transport === "none") return;

  pi.on("tool_call", (event, ctx) => {
    void sendEnvelope(
      {
        eventName: "ToolCallStart",
        event,
        ctx,
        extra: {
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
          input: event.input,
        },
      },
      { preferSocket: true },
    );
    return;
  });

  pi.on("tool_result", (event: ToolResultEvent, ctx) => {
    void sendEnvelope(
      {
        eventName: "ToolCallEnd",
        event,
        ctx,
        extra: {
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
          is_error: event.isError,
          content_preview: previewContent(event.content),
        },
      },
      { preferSocket: true },
    );
    return;
  });
}

export { previewContent };
