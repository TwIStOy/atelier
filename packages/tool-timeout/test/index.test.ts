import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, it, vi } from "vitest";
import { DEFAULT_CONFIG, type ToolTimeoutConfig } from "../src/config.ts";
import extension from "../src/index.ts";

let mockConfig: ToolTimeoutConfig;
let disabled: boolean;

vi.mock("@htwang-contrib/common", () => ({
  isExtensionDisabled: () => disabled,
  readConfig: () => mockConfig,
  registerConfigItems: () => {},
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
    mockConfig = { maxTimeoutSeconds: 0 };
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
