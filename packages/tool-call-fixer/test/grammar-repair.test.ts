import * as assert from "node:assert/strict";
import type { AssistantMessage, TextContent, ToolCall } from "@earendil-works/pi-ai";
import { describe, it } from "vitest";
import {
  type GrammarRepairConfig,
  parseGlm,
  parseKimi,
  parseQwen,
  repairAssistantMessageGrammarLeaks,
} from "../src/grammar-repair/index.ts";

function makeMessage(text: string, overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  const textBlock: TextContent = { type: "text", text };
  return {
    role: "assistant",
    content: [textBlock],
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

const recoverOn: GrammarRepairConfig = { enabled: true, mode: "recover", requireKnownTool: false };
const stripOn: GrammarRepairConfig = { enabled: true, mode: "strip", requireKnownTool: false };
const disabled: GrammarRepairConfig = { enabled: false, mode: "recover", requireKnownTool: false };

const GLM_READ = [
  "<tool_call>read",
  "<arg_key>path</arg_key>",
  "<arg_value>/etc/hosts</arg_value>",
  "</tool_call>",
].join("\n");

describe("parseGlm", () => {
  it("parses a GLM <tool_call> with arg_key/arg_value", () => {
    const calls = parseGlm(GLM_READ);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "read");
    assert.deepEqual(calls[0].arguments, { path: "/etc/hosts" });
    assert.equal(calls[0].grammar, "glm");
  });

  it("also matches the <tools> wrapper", () => {
    const text = GLM_READ.replace(/tool_call/g, "tools");
    assert.equal(parseGlm(text)[0]?.name, "read");
  });

  it("parses JSON-ish arg values via maybeParseJsonValue", () => {
    const text = [
      "<tool_call>edit",
      "<arg_key>path</arg_key><arg_value>/a</arg_value>",
      '<arg_key>edits</arg_key><arg_value>[{"oldText":"a","newText":"b"}]</arg_value>',
      "</tool_call>",
    ].join("\n");
    const call = parseGlm(text)[0];
    assert.equal(call?.name, "edit");
    assert.equal(call?.arguments.path, "/a");
    assert.deepEqual(call?.arguments.edits, [{ oldText: "a", newText: "b" }]);
  });

  it("returns [] for plain text", () => {
    assert.deepEqual(parseGlm("just some text, no grammar"), []);
  });

  it("ignores leaked grammar inside a fenced code block", () => {
    const text = `\`\`\`\n${GLM_READ}\n\`\`\``;
    assert.deepEqual(parseGlm(text), []);
  });

  it("rejects an invalid tool name", () => {
    const text = "<tool_call>123bad<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>";
    assert.deepEqual(parseGlm(text), []);
  });
});

describe("repairAssistantMessageGrammarLeaks", () => {
  it("is a no-op when disabled", () => {
    const result = repairAssistantMessageGrammarLeaks(makeMessage(GLM_READ), disabled, new Set(["read"]));
    assert.equal(result.changed, false);
    assert.equal((result.message.content[0] as TextContent).text, GLM_READ);
  });

  it("strips leaked markup in strip mode without recovering", () => {
    const result = repairAssistantMessageGrammarLeaks(makeMessage(GLM_READ), stripOn, new Set(["read"]));
    assert.equal(result.changed, true);
    assert.equal(result.recoveredCalls.length, 0);
    assert.equal(result.message.stopReason, "stop");
    assert.ok(!(result.message.content[0] as TextContent).text.includes("<tool_call>"));
  });

  it("recovers a tool call in recover mode and sets stopReason toolUse", () => {
    const result = repairAssistantMessageGrammarLeaks(makeMessage(GLM_READ), recoverOn, new Set(["read"]));
    assert.equal(result.changed, true);
    assert.equal(result.recoveredCalls.length, 1);
    assert.equal(result.recoveredCalls[0].name, "read");
    assert.equal(result.message.stopReason, "toolUse");
    const recovered = result.message.content.find((b) => b.type === "toolCall");
    assert.ok(recovered, "expected a recovered toolCall block");
    assert.equal(recovered.type === "toolCall" && recovered.name, "read");
  });

  it("does not recover when the assistant already emitted a native tool call", () => {
    const existing: ToolCall = { type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } };
    const result = repairAssistantMessageGrammarLeaks(
      makeMessage(GLM_READ, { content: [existing, { type: "text", text: GLM_READ }] }),
      recoverOn,
      new Set(["read"]),
    );
    assert.equal(result.recoveredCalls.length, 0);
    assert.notEqual(result.message.stopReason, "toolUse");
  });

  it("requireKnownTool drops unknown-tool leaks entirely (no strip, no recover)", () => {
    const cfg: GrammarRepairConfig = { enabled: true, mode: "recover", requireKnownTool: true };
    const result = repairAssistantMessageGrammarLeaks(makeMessage(GLM_READ), cfg, new Set(["bash"]));
    assert.equal(result.changed, false);
    assert.equal((result.message.content[0] as TextContent).text, GLM_READ);
  });

  it("requireKnownTool=false recovers even unknown tools", () => {
    const cfg: GrammarRepairConfig = { enabled: true, mode: "recover", requireKnownTool: false };
    const result = repairAssistantMessageGrammarLeaks(makeMessage(GLM_READ), cfg, new Set(["bash"]));
    assert.equal(result.recoveredCalls.length, 1);
  });

  it("strips but does not recover a call with empty arguments", () => {
    const text = "<tool_call>write</tool_call>";
    const result = repairAssistantMessageGrammarLeaks(makeMessage(text), recoverOn, new Set(["write"]));
    assert.equal(result.changed, true);
    assert.equal(result.recoveredCalls.length, 0);
    assert.notEqual(result.message.stopReason, "toolUse");
  });
});

describe("parseQwen (JSON variant)", () => {
  const QWEN_READ = '<tool_call>{"name":"read","arguments":{"path":"/etc/hosts"}}</tool_call>';

  it("parses a single object tool call", () => {
    const calls = parseQwen(QWEN_READ);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "read");
    assert.deepEqual(calls[0].arguments, { path: "/etc/hosts" });
    assert.equal(calls[0].grammar, "qwen");
  });

  it("parses an array of tool calls", () => {
    const text =
      '<tool_call>[{"name":"read","arguments":{"path":"/a"}},{"name":"bash","arguments":{"command":"ls"}}]</tool_call>';
    const calls = parseQwen(text);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].name, "read");
    assert.equal(calls[1].name, "bash");
  });

  it("parses the <tools> wrapper", () => {
    const text = '<tools>{"name":"read","arguments":{"path":"/x"}}</tools>';
    assert.equal(parseQwen(text)[0]?.name, "read");
  });

  it("unwraps a tool call wrapped in a markdown fence", () => {
    const text = '<tool_call>```json\n{"name":"read","arguments":{"path":"/x"}}\n```</tool_call>';
    assert.equal(parseQwen(text)[0]?.name, "read");
  });

  it("returns [] for a GLM-style body (no JSON)", () => {
    assert.deepEqual(parseQwen(GLM_READ), []);
  });
});

describe("parseKimi", () => {
  const KIMI_READ =
    "<|tool_calls_section_begin|>\n" +
    '<|tool_call_begin|>functions.read:1<|tool_call_argument_begin|>{"path":"/etc/hosts"}<|tool_call_end|>\n' +
    "<|tool_calls_section_end|>";

  it("parses a canonical functions.<name>:<n> tool call", () => {
    const calls = parseKimi(KIMI_READ);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "read");
    assert.deepEqual(calls[0].arguments, { path: "/etc/hosts" });
    assert.equal(calls[0].grammar, "kimi");
  });

  it("parses a relaxed bare-name id", () => {
    const text =
      "<|tool_calls_section_begin|>" +
      '<|tool_call_begin|>bash:2<|tool_call_argument_begin|>{"command":"ls"}<|tool_call_end|>' +
      "<|tool_calls_section_end|>";
    assert.equal(parseKimi(text)[0]?.name, "bash");
  });

  it("rejects a call_<n> id", () => {
    const text =
      "<|tool_calls_section_begin|>" +
      '<|tool_call_begin|>call_123<|tool_call_argument_begin|>{"path":"/x"}<|tool_call_end|>' +
      "<|tool_calls_section_end|>";
    assert.deepEqual(parseKimi(text), []);
  });

  it("returns [] for plain text", () => {
    assert.deepEqual(parseKimi("no kimi markers here"), []);
  });
});

describe("repairAssistantMessageGrammarLeaks: qwen + kimi recovery", () => {
  it("recovers a leaked Qwen JSON tool call", () => {
    const text = '<tool_call>{"name":"read","arguments":{"path":"/a"}}</tool_call>';
    const result = repairAssistantMessageGrammarLeaks(makeMessage(text), recoverOn, new Set(["read"]));
    assert.equal(result.recoveredCalls.length, 1);
    assert.equal(result.recoveredCalls[0].name, "read");
    assert.equal(result.message.stopReason, "toolUse");
  });

  it("recovers a leaked Kimi tool call", () => {
    const text =
      "<|tool_calls_section_begin|>" +
      '<|tool_call_begin|>functions.read:1<|tool_call_argument_begin|>{"path":"/a"}<|tool_call_end|>' +
      "<|tool_calls_section_end|>";
    const result = repairAssistantMessageGrammarLeaks(makeMessage(text), recoverOn, new Set(["read"]));
    assert.equal(result.recoveredCalls.length, 1);
    assert.equal(result.recoveredCalls[0].name, "read");
    assert.equal(result.message.stopReason, "toolUse");
  });
});
