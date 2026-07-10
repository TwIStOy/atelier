import { describe, expect, it } from "vitest";
import { AccessPath } from "../src/access-intent/access-path.ts";
import { approvalKeyFromTrigger, SessionApprovalStore } from "../src/session-approval.ts";
import type { GateTrigger } from "../src/types.ts";

function pathTrigger(display: string): GateTrigger {
  const path = AccessPath.forLiteral(display, [display]);
  return { kind: "path", surface: "path", path, display };
}

describe("approvalKeyFromTrigger", () => {
  it("derives a command key from the bash prefix", () => {
    const trigger: GateTrigger = { kind: "command", command: "npm test --verbose", prefix: "npm test" };
    expect(approvalKeyFromTrigger(trigger)).toBe("command:npm test");
  });

  it("falls back to the full command when no prefix", () => {
    const trigger: GateTrigger = { kind: "command", command: "weird-cmd --flag" };
    expect(approvalKeyFromTrigger(trigger)).toBe("command:weird-cmd --flag");
  });

  it("derives a path key from the display path", () => {
    expect(approvalKeyFromTrigger(pathTrigger("/etc/hosts"))).toBe("path:/etc/hosts");
  });

  it("derives a tool key from the none trigger", () => {
    const trigger: GateTrigger = { kind: "none", toolName: "memory-read" };
    expect(approvalKeyFromTrigger(trigger)).toBe("tool:memory-read");
  });
});

describe("SessionApprovalStore", () => {
  it("reports a key as absent until remembered", () => {
    const store = new SessionApprovalStore();
    expect(store.has("command:npm test")).toBe(false);
  });

  it("reports a key as present after it is remembered", () => {
    const store = new SessionApprovalStore();
    store.remember("command:npm test");
    expect(store.has("command:npm test")).toBe(true);
  });

  it("clear forgets all remembered keys", () => {
    const store = new SessionApprovalStore();
    store.remember("command:npm test");
    store.remember("path:/etc/hosts");
    store.clear();
    expect(store.has("command:npm test")).toBe(false);
    expect(store.has("path:/etc/hosts")).toBe(false);
  });

  it("tracks the count of remembered approvals", () => {
    const store = new SessionApprovalStore();
    expect(store.size).toBe(0);
    store.remember("command:npm test");
    expect(store.size).toBe(1);
    store.remember("command:npm test");
    expect(store.size).toBe(1);
    store.remember("path:/etc/hosts");
    expect(store.size).toBe(2);
  });
});
