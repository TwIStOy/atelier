import * as assert from "node:assert/strict";
import { describe, it } from "vitest";
import { STRATEGIES } from "../src/strategies/index.ts";
import { shapeRepair } from "../src/strategies/shape-repair.ts";
import {
  dropEmptyObjectPlaceholder,
  dropNullOrUndefined,
  parseJsonStringifiedArray,
  REPAIR_RULES,
  type RepairContext,
  tryParseJsonArray,
  wrapBareStringAsArray,
  wrapRootStringAsObject,
} from "../src/strategies/shape-repair-rules.ts";
import { applyStrategies, DEFAULT_CONFIG, type ToolCallFixerConfig } from "../src/strategy.ts";

const enabledConfig: ToolCallFixerConfig = { ...DEFAULT_CONFIG, enabled: true };

function makeCtx(overrides: Partial<RepairContext> = {}): RepairContext {
  return {
    toolName: "read",
    parent: {},
    key: "offset",
    value: null,
    issue: { code: "invalid_type", expected: "number", received: "null", path: ["offset"], message: "" },
    ...overrides,
  };
}

describe("tryParseJsonArray", () => {
  it("parses a JSON array string", () => {
    assert.deepEqual(tryParseJsonArray("[1,2,3]"), [1, 2, 3]);
  });
  it("returns null for non-array JSON", () => {
    assert.equal(tryParseJsonArray('{"a":1}'), null);
    assert.equal(tryParseJsonArray('"x"'), null);
    assert.equal(tryParseJsonArray("5"), null);
  });
  it("returns null for invalid JSON", () => {
    assert.equal(tryParseJsonArray("[oops"), null);
  });
});

describe("dropNullOrUndefined", () => {
  it("drops a null value", () => {
    const parent = { offset: null };
    const res = dropNullOrUndefined(makeCtx({ parent, key: "offset", value: null }));
    assert.equal(res?.ruleName, "dropNullOrUndefined");
    assert.deepEqual(parent, {});
  });
  it("is a no-op for a non-null value", () => {
    const parent = { offset: 1 };
    assert.equal(dropNullOrUndefined(makeCtx({ parent, key: "offset", value: 1 })), null);
    assert.deepEqual(parent, { offset: 1 });
  });
});

describe("dropEmptyObjectPlaceholder", () => {
  it("drops an empty object {}", () => {
    const parent = { edits: {} };
    const res = dropEmptyObjectPlaceholder(
      makeCtx({
        toolName: "edit",
        parent,
        key: "edits",
        value: {},
        issue: { code: "invalid_type", expected: "array", received: "object", path: ["edits"], message: "" },
      }),
    );
    assert.equal(res?.ruleName, "dropEmptyObjectPlaceholder");
    assert.deepEqual(parent, {});
  });
  it("is a no-op for a non-empty object, array, or primitive", () => {
    const v = { a: 1 };
    assert.equal(dropEmptyObjectPlaceholder(makeCtx({ value: v })), null);
    assert.equal(dropEmptyObjectPlaceholder(makeCtx({ value: [1] })), null);
    assert.equal(dropEmptyObjectPlaceholder(makeCtx({ value: "x" })), null);
  });
});

describe("parseJsonStringifiedArray", () => {
  it("parses a JSON-stringified array in place", () => {
    const parent: Record<string, unknown> = { edits: '[{"oldText":"a","newText":"b"}]' };
    const res = parseJsonStringifiedArray(
      makeCtx({
        toolName: "edit",
        parent,
        key: "edits",
        value: parent.edits,
        issue: { code: "invalid_type", expected: "array", received: "string", path: ["edits"], message: "" },
      }),
    );
    assert.equal(res?.ruleName, "parseJsonStringifiedArray");
    assert.deepEqual(parent.edits, [{ oldText: "a", newText: "b" }]);
  });
  it("is a no-op for a non-array JSON string", () => {
    const parent = { offset: "5" };
    assert.equal(parseJsonStringifiedArray(makeCtx({ parent, key: "offset", value: "5" })), null);
    assert.deepEqual(parent, { offset: "5" });
  });
});

describe("wrapBareStringAsArray", () => {
  const arrayIssue = (key: string): RepairContext["issue"] => ({
    code: "invalid_type",
    expected: "array",
    received: "string",
    path: [key],
    message: "",
  });
  it("wraps a bare string as a single-element array when an array was expected", () => {
    const parent: Record<string, unknown> = { edits: "a" };
    const res = wrapBareStringAsArray(
      makeCtx({ toolName: "edit", parent, key: "edits", value: "a", issue: arrayIssue("edits") }),
    );
    assert.equal(res?.ruleName, "wrapBareStringAsArray");
    assert.deepEqual(parent.edits, ["a"]);
  });
  it("is a no-op when the issue does not expect an array", () => {
    assert.equal(wrapBareStringAsArray(makeCtx({ value: "5" })), null);
  });
});

describe("REPAIR_RULES order", () => {
  it("parses before wrapping (no double-wrapping of a JSON array string)", () => {
    assert.equal(REPAIR_RULES.indexOf(parseJsonStringifiedArray), REPAIR_RULES.indexOf(wrapBareStringAsArray) - 1);
  });
});

describe("wrapRootStringAsObject", () => {
  it("wraps a bare string for a known single-string-arg tool", () => {
    const res = wrapRootStringAsObject("/etc/hosts", "read");
    assert.deepEqual(res?.value, { path: "/etc/hosts" });
  });
  it("maps bash bare string to command", () => {
    assert.deepEqual(wrapRootStringAsObject("ls -la", "bash")?.value, { command: "ls -la" });
  });
  it("returns null for a non-string input", () => {
    assert.equal(wrapRootStringAsObject({ path: "/x" }, "read"), null);
  });
  it("returns null for an unknown tool", () => {
    assert.equal(wrapRootStringAsObject("x", "web_search"), null);
  });
});

describe("shapeRepair strategy", () => {
  it("drops a null optional field", () => {
    const input: Record<string, unknown> = { path: "/x", offset: null };
    const res = shapeRepair.apply("read", input);
    assert.equal(res.applied, true);
    assert.deepEqual(input, { path: "/x" });
  });

  it("is a no-op on a valid call", () => {
    const input: Record<string, unknown> = { path: "/x", offset: 1 };
    assert.equal(shapeRepair.apply("read", input).applied, false);
    assert.deepEqual(input, { path: "/x", offset: 1 });
  });

  it("does not coerce a wrong scalar type (string->number)", () => {
    const input: Record<string, unknown> = { path: "/x", offset: "5" };
    assert.equal(shapeRepair.apply("read", input).applied, false);
    assert.deepEqual(input, { path: "/x", offset: "5" });
  });

  it("parses a JSON-stringified array field (edit.edits)", () => {
    const input: Record<string, unknown> = { path: "/x", edits: '[{"oldText":"a","newText":"b"}]' };
    shapeRepair.apply("edit", input);
    assert.deepEqual(input.edits, [{ oldText: "a", newText: "b" }]);
  });

  it("wraps a bare-string array field (edit.edits)", () => {
    const input: Record<string, unknown> = { path: "/x", edits: "a" };
    shapeRepair.apply("edit", input);
    assert.deepEqual(input.edits, ["a"]);
  });

  it("drops an empty {} placeholder for an array field", () => {
    const input: Record<string, unknown> = { path: "/x", edits: {} };
    shapeRepair.apply("edit", input);
    assert.deepEqual(input, { path: "/x" });
  });

  it("is a no-op for a tool without a schema", () => {
    const input: Record<string, unknown> = { query: "x" };
    assert.equal(shapeRepair.apply("web_search", input).applied, false);
  });
});

describe("applyStrategies: param-name-repair + shape-repair together", () => {
  it("renames an alias then drops the null it was paired with", () => {
    const input: Record<string, unknown> = { file_path: "/x", offset: null };
    const outcome = applyStrategies("read", input, enabledConfig, STRATEGIES);
    assert.equal(outcome.applied, true);
    assert.deepEqual(input, { path: "/x" });
    assert.ok(outcome.notes.some((n) => n.startsWith("shape-repair:")));
  });
});
