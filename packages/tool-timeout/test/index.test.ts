import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, it, vi } from "vitest";
import { DEFAULT_CONFIG, type ToolTimeoutConfig } from "../src/config.ts";
import extension from "../src/index.ts";

let mockConfig: ToolTimeoutConfig;
let disabled: boolean;

vi.mock("@htwang-contrib/common/config", () => ({
  readConfig: () => mockConfig,
  registerConfigItems: () => {},
}));

vi.mock("@htwang-contrib/common/extension-disable", () => ({
  isExtensionDisabled: () => disabled,
}));

function mockPi() {
  const onHandlers: Record<string, (event: never) => unknown> = {};
  const pi = {
    on(event: string, handler: (event: never) => unknown) {
      onHandlers[event] = handler;
    },
  };
  return { pi: pi as unknown as ExtensionAPI, onHandlers };
}

function bashCall(input: Record<string, unknown>) {
  return { type: "tool_call", toolCallId: "call-1", toolName: "bash", input };
}

describe("tool-timeout wiring", () => {
  beforeEach(() => {
    mockConfig = { ...DEFAULT_CONFIG };
    disabled = false;
  });

  it("applies the cap to bash calls without a timeout", () => {
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = bashCall({ command: "sleep 1000" });
    onHandlers.tool_call(event as never);
    assert.equal(event.input.timeout, 3600);
  });

  it("clamps bash timeouts above the cap", () => {
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = bashCall({ command: "sleep 1000", timeout: 86400 });
    onHandlers.tool_call(event as never);
    assert.equal(event.input.timeout, 3600);
  });

  it("keeps bash timeouts at or below the cap", () => {
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = bashCall({ command: "sleep 5", timeout: 30 });
    onHandlers.tool_call(event as never);
    assert.equal(event.input.timeout, 30);
  });

  it("does not touch other tools", () => {
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = { type: "tool_call", toolCallId: "call-2", toolName: "read", input: { path: "/a" } };
    onHandlers.tool_call(event as never);
    assert.equal("timeout" in event.input, false);
  });

  it("leaves input untouched when the cap is disabled", () => {
    mockConfig = { ...DEFAULT_CONFIG, maxTimeoutSeconds: 0 };
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = bashCall({ command: "sleep 1000" });
    onHandlers.tool_call(event as never);
    assert.equal("timeout" in event.input, false);
  });

  it("registers nothing when the extension is disabled", () => {
    disabled = true;
    const { pi, onHandlers } = mockPi();
    extension(pi);
    assert.equal(Object.keys(onHandlers).length, 0);
  });
});

describe("tool-timeout exempt rules wiring", () => {
  beforeEach(() => {
    mockConfig = { ...DEFAULT_CONFIG, exemptRules: [{ tool: "bash", pattern: "ocr review" }] };
    disabled = false;
  });

  it("leaves matched calls with no timeout at all", () => {
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = bashCall({ command: "ocr review --all" });
    onHandlers.tool_call(event as never);
    assert.equal("timeout" in event.input, false);
  });

  it("removes a model-requested timeout from matched calls", () => {
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = bashCall({ command: "ocr review", timeout: 60 });
    onHandlers.tool_call(event as never);
    assert.equal("timeout" in event.input, false);
  });

  it("strips matched timeouts even when the cap is disabled", () => {
    mockConfig = {
      maxTimeoutSeconds: 0,
      exemptRules: [{ tool: "bash", pattern: "ocr review" }],
    };
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = bashCall({ command: "ocr review", timeout: 60 });
    onHandlers.tool_call(event as never);
    assert.equal("timeout" in event.input, false);
  });

  it("still caps unmatched bash calls when rules are configured", () => {
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = bashCall({ command: "sleep 1000" });
    onHandlers.tool_call(event as never);
    assert.equal(event.input.timeout, 3600);
  });

  it("applies rules to non-bash tools", () => {
    mockConfig = { ...DEFAULT_CONFIG, exemptRules: [{ tool: "mytool", pattern: "watch" }] };
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = {
      type: "tool_call",
      toolCallId: "call-3",
      toolName: "mytool",
      input: { action: "watch stuff", timeout: 30 },
    };
    onHandlers.tool_call(event as never);
    assert.equal("timeout" in event.input, false);
  });

  it("ignores malformed rule entries instead of blocking the cap", () => {
    mockConfig = {
      ...DEFAULT_CONFIG,
      exemptRules: [{ tool: "bash", pattern: "" }, "ocr review"] as unknown as ToolTimeoutConfig["exemptRules"],
    };
    const { pi, onHandlers } = mockPi();
    extension(pi);
    const event = bashCall({ command: "ocr review" });
    onHandlers.tool_call(event as never);
    assert.equal(event.input.timeout, 3600);
  });
});
