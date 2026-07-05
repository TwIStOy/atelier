import * as assert from "node:assert/strict";
import type { AssistantMessage, TextContent, ToolCall } from "@earendil-works/pi-ai";
import { describe, it } from "vitest";
import { normalizePhantomToolUse } from "../src/phantom-tool-use.ts";

function makeMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai" as AssistantMessage["api"],
    provider: "zai-coding-plan" as AssistantMessage["provider"],
    model: "glm-5.2",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
    ...overrides,
  };
}

const toolCallBlock: ToolCall = {
  type: "toolCall",
  id: "call_1",
  name: "read",
  arguments: { path: "/x" },
};
const textBlock: TextContent = { type: "text", text: "hi" };

describe("normalizePhantomToolUse", () => {
  it("is a no-op when stopReason is not toolUse", () => {
    const msg = makeMessage({ stopReason: "stop", content: [textBlock] });
    assert.equal(normalizePhantomToolUse(msg).changed, false);
  });

  it("is a no-op when toolUse has a real toolCall block", () => {
    const msg = makeMessage({ stopReason: "toolUse", content: [toolCallBlock] });
    assert.equal(normalizePhantomToolUse(msg).changed, false);
  });

  it("normalizes toolUse with no toolCall blocks to error", () => {
    const msg = makeMessage({ stopReason: "toolUse", content: [textBlock] });
    const result = normalizePhantomToolUse(msg);
    assert.equal(result.changed, true);
    assert.equal(result.message.stopReason, "error");
    assert.ok(result.message.errorMessage?.includes("phantom tool_use"));
  });

  it("normalizes toolUse with empty content", () => {
    const msg = makeMessage({ stopReason: "toolUse", content: [] });
    const result = normalizePhantomToolUse(msg);
    assert.equal(result.changed, true);
    assert.equal(result.message.stopReason, "error");
  });

  it("preserves the rest of the message (content, usage, model)", () => {
    const msg = makeMessage({ stopReason: "toolUse", content: [textBlock], model: "glm-5.2" });
    const result = normalizePhantomToolUse(msg);
    assert.equal(result.message.model, "glm-5.2");
    assert.deepEqual(result.message.content, [textBlock]);
    assert.equal(result.message.usage.totalTokens, 0);
  });
});
