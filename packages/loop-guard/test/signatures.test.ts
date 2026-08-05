import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { stableStringify, summarizeCall, toolSignature } from "../src/signatures.ts";

describe("stableStringify", () => {
  it("is key-order independent", () => {
    assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
  });

  it("keeps array order significant", () => {
    assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  });

  it("drops undefined object values", () => {
    assert.equal(stableStringify({ a: undefined, b: 1 }), stableStringify({ b: 1 }));
  });

  it("serializes nested structures deterministically", () => {
    assert.equal(stableStringify({ x: { b: 1, a: [true, null] } }), '{"x":{"a":[true,null],"b":1}}');
  });
});

describe("toolSignature", () => {
  it("matches regardless of argument key order", () => {
    assert.equal(toolSignature("read", { path: "/a", offset: 1 }), toolSignature("read", { offset: 1, path: "/a" }));
  });

  it("differs across tools with identical input", () => {
    assert.notEqual(toolSignature("read", { path: "/a" }), toolSignature("write", { path: "/a" }));
  });

  it("differs when any argument value differs", () => {
    assert.notEqual(toolSignature("read", { path: "/a" }), toolSignature("read", { path: "/b" }));
  });
});

describe("summarizeCall", () => {
  it("prefers well-known string fields", () => {
    assert.equal(summarizeCall("bash", { command: "ls -la" }), "bash(ls -la)");
    assert.equal(summarizeCall("read", { path: "/etc/hosts" }), "read(/etc/hosts)");
    assert.equal(summarizeCall("grep", { pattern: "foo" }), "grep(foo)");
  });

  it("falls back to serialized input", () => {
    assert.equal(summarizeCall("custom", { foo: 1 }), 'custom({"foo":1})');
  });

  it("truncates long values", () => {
    const summary = summarizeCall("bash", { command: "x".repeat(300) });
    assert.ok(summary.length <= 120);
  });
});
