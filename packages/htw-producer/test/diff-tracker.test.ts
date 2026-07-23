import { describe, expect, test } from "vitest";
import { countLines, DiffTracker } from "../src/diff-tracker.ts";

describe("countLines", () => {
  test("empty string is zero", () => {
    expect(countLines("")).toBe(0);
    expect(countLines(undefined)).toBe(0);
  });

  test("counts by newline splits", () => {
    expect(countLines("a")).toBe(1);
    expect(countLines("a\nb\nc")).toBe(3);
    expect(countLines("a\nb\n")).toBe(3);
  });
});

describe("DiffTracker", () => {
  test("starts at zero", () => {
    const tracker = new DiffTracker();
    expect(tracker.snapshot()).toEqual({ add: 0, delete: 0 });
  });

  test("edit with array of edits accumulates both directions", () => {
    const tracker = new DiffTracker();
    tracker.recordToolStart("edit", {
      file: "a.ts",
      edits: [
        { oldText: "x\ny", newText: "p\nq\nr" },
        { oldText: "z", newText: "" },
      ],
    });
    expect(tracker.snapshot()).toEqual({ add: 3, delete: 3 });
  });

  test("edit with single top-level oldText/newText shape", () => {
    const tracker = new DiffTracker();
    tracker.recordToolStart("edit", { oldText: "a\nb", newText: "c" });
    expect(tracker.snapshot()).toEqual({ add: 1, delete: 2 });
  });

  test("write only counts additions (no prior content known)", () => {
    const tracker = new DiffTracker();
    tracker.recordToolStart("write", { path: "f.ts", content: "a\nb\nc\nd" });
    expect(tracker.snapshot()).toEqual({ add: 4, delete: 0 });
  });

  test("non-editing tools are ignored", () => {
    const tracker = new DiffTracker();
    tracker.recordToolStart("bash", { command: "rm -rf /" });
    tracker.recordToolStart("read", { file: "f" });
    expect(tracker.snapshot()).toEqual({ add: 0, delete: 0 });
  });

  test("accumulates across multiple tool calls", () => {
    const tracker = new DiffTracker();
    tracker.recordToolStart("edit", { edits: [{ oldText: "a", newText: "b\nc" }] });
    tracker.recordToolStart("write", { content: "x\ny" });
    expect(tracker.snapshot()).toEqual({ add: 4, delete: 1 });
  });

  test("reset returns to zero", () => {
    const tracker = new DiffTracker();
    tracker.recordToolStart("write", { content: "a\nb" });
    tracker.reset();
    expect(tracker.snapshot()).toEqual({ add: 0, delete: 0 });
  });

  test("ignores malformed args", () => {
    const tracker = new DiffTracker();
    tracker.recordToolStart("edit", null);
    tracker.recordToolStart("edit", { edits: "not-an-array" });
    tracker.recordToolStart("write", "nope");
    expect(tracker.snapshot()).toEqual({ add: 0, delete: 0 });
  });
});
