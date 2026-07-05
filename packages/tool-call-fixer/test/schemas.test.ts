import * as assert from "node:assert/strict";
import { describe, it } from "vitest";
import { getToolSchema, validateToolInput } from "../src/schemas.ts";

describe("getToolSchema", () => {
  it("returns the schema for a known tool", () => {
    assert.ok(getToolSchema("read"));
    assert.equal(getToolSchema("read")?.path.type, "string");
    assert.equal(getToolSchema("read")?.path.required, true);
  });

  it("returns undefined for an unknown tool", () => {
    assert.equal(getToolSchema("web_search"), undefined);
  });
});

describe("validateToolInput", () => {
  it("produces no issues for a valid input", () => {
    const schema = getToolSchema("read")!;
    assert.deepEqual(validateToolInput(schema, { path: "/x", offset: 1, limit: 5 }), []);
  });

  it("flags a missing required field", () => {
    const issues = validateToolInput(getToolSchema("read")!, {});
    assert.equal(issues.length, 1);
    assert.equal(issues[0].code, "missing_field");
    assert.deepEqual(issues[0].path, ["path"]);
  });

  it("flags a null required field as missing", () => {
    const issues = validateToolInput(getToolSchema("read")!, { path: null });
    assert.equal(issues[0].code, "missing_field");
    assert.deepEqual(issues[0].path, ["path"]);
  });

  it("flags a null optional field as invalid_type(null)", () => {
    const issues = validateToolInput(getToolSchema("read")!, { path: "/x", offset: null });
    const offsetIssue = issues.find((i) => i.path[0] === "offset");
    assert.equal(offsetIssue?.code, "invalid_type");
    assert.equal(offsetIssue?.received, "null");
  });

  it("flags a wrong-typed value", () => {
    const issues = validateToolInput(getToolSchema("read")!, { path: "/x", offset: "5" });
    const offsetIssue = issues.find((i) => i.path[0] === "offset");
    assert.equal(offsetIssue?.code, "invalid_type");
    assert.equal(offsetIssue?.expected, "number");
    assert.equal(offsetIssue?.received, "string");
  });

  it("treats an array value as the array type", () => {
    const issues = validateToolInput(getToolSchema("edit")!, { path: "/x", edits: [{ oldText: "a", newText: "b" }] });
    assert.deepEqual(issues, []);
  });

  it("flags an array field given a non-array", () => {
    const issues = validateToolInput(getToolSchema("edit")!, { path: "/x", edits: "not an array" });
    const editsIssue = issues.find((i) => i.path[0] === "edits");
    assert.equal(editsIssue?.code, "invalid_type");
    assert.equal(editsIssue?.expected, "array");
    assert.equal(editsIssue?.received, "string");
  });
});
