import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ToolLoopDetector, type ToolLoopOptions } from "../src/tool-loop.ts";

const OPTIONS: ToolLoopOptions = { windowSize: 30, maxRepeats: 3, pingPongMinCycles: 3 };

function run(
  detector: ToolLoopDetector,
  toolName: string,
  input: unknown,
  resultText: string,
  isError = false,
): ReturnType<ToolLoopDetector["checkCall"]> {
  const detection = detector.checkCall(toolName, input, OPTIONS);
  detector.recordResult(toolName, input, resultText, isError, OPTIONS);
  return detection;
}

describe("ToolLoopDetector repeat detection", () => {
  it("allows the first two identical calls and blocks the third", () => {
    const detector = new ToolLoopDetector();
    assert.equal(run(detector, "read", { path: "/a" }, "contents"), null);
    assert.equal(run(detector, "read", { path: "/a" }, "contents"), null);
    assert.deepEqual(detector.checkCall("read", { path: "/a" }, OPTIONS), {
      kind: "repeat",
      toolName: "read",
      count: 3,
      summary: "read(/a)",
    });
  });

  it("does not flag identical calls whose results differ", () => {
    const detector = new ToolLoopDetector();
    run(detector, "read", { path: "/a" }, "v1");
    run(detector, "read", { path: "/a" }, "v2");
    run(detector, "read", { path: "/a" }, "v3");
    assert.equal(detector.checkCall("read", { path: "/a" }, OPTIONS), null);
  });

  it("blocks when one identical result reaches the threshold among mixed results", () => {
    const detector = new ToolLoopDetector();
    run(detector, "read", { path: "/a" }, "v1");
    run(detector, "read", { path: "/a" }, "v2");
    run(detector, "read", { path: "/a" }, "v1");
    assert.equal(detector.checkCall("read", { path: "/a" }, OPTIONS)?.kind, "repeat");
  });

  it("flags repeated identical errors", () => {
    const detector = new ToolLoopDetector();
    run(detector, "bash", { command: "npm test" }, "exit 1", true);
    run(detector, "bash", { command: "npm test" }, "exit 1", true);
    assert.equal(detector.checkCall("bash", { command: "npm test" }, OPTIONS)?.kind, "repeat");
  });

  it("treats success and error results as different outcomes", () => {
    const detector = new ToolLoopDetector();
    run(detector, "bash", { command: "npm test" }, "exit 1", true);
    run(detector, "bash", { command: "npm test" }, "exit 1", false);
    assert.equal(detector.checkCall("bash", { command: "npm test" }, OPTIONS), null);
  });

  it("tracks different arguments independently", () => {
    const detector = new ToolLoopDetector();
    run(detector, "read", { path: "/a" }, "contents");
    run(detector, "read", { path: "/a" }, "contents");
    assert.equal(detector.checkCall("read", { path: "/b" }, OPTIONS), null);
  });

  it("forgets calls outside the history window", () => {
    const options: ToolLoopOptions = { ...OPTIONS, windowSize: 4 };
    const detector = new ToolLoopDetector();
    detector.recordResult("read", { path: "/a" }, "contents", false, options);
    detector.recordResult("read", { path: "/a" }, "contents", false, options);
    for (let i = 0; i < 4; i++) {
      detector.recordResult("bash", { command: `cmd ${i}` }, "ok", false, options);
    }
    assert.equal(detector.checkCall("read", { path: "/a" }, options), null);
  });

  it("reset clears history", () => {
    const detector = new ToolLoopDetector();
    run(detector, "read", { path: "/a" }, "contents");
    run(detector, "read", { path: "/a" }, "contents");
    detector.reset();
    assert.equal(detector.checkCall("read", { path: "/a" }, OPTIONS), null);
  });
});

describe("ToolLoopDetector ping-pong detection", () => {
  it("detects an A,B cycle with identical results on the third cycle", () => {
    const detector = new ToolLoopDetector();
    run(detector, "edit", { path: "/a" }, "edited");
    run(detector, "bash", { command: "npm test" }, "failed");
    run(detector, "edit", { path: "/a" }, "edited");
    run(detector, "bash", { command: "npm test" }, "failed");
    assert.deepEqual(detector.checkCall("edit", { path: "/a" }, OPTIONS), {
      kind: "ping-pong",
      tools: ["edit", "bash"],
      cycles: 3,
    });
  });

  it("does not flag a cycle whose results change between iterations", () => {
    const detector = new ToolLoopDetector();
    run(detector, "edit", { path: "/a" }, "edited v1");
    run(detector, "bash", { command: "npm test" }, "failed 1");
    run(detector, "edit", { path: "/a" }, "edited v2");
    run(detector, "bash", { command: "npm test" }, "failed 2");
    assert.equal(detector.checkCall("edit", { path: "/a" }, OPTIONS), null);
  });

  it("does not flag when the alternation breaks", () => {
    const detector = new ToolLoopDetector();
    run(detector, "edit", { path: "/a" }, "edited v1");
    run(detector, "bash", { command: "npm test" }, "failed");
    run(detector, "edit", { path: "/a" }, "edited v2");
    run(detector, "grep", { pattern: "x" }, "match");
    assert.equal(detector.checkCall("edit", { path: "/a" }, OPTIONS), null);
  });

  it("falls back to repeat detection when the same tool repeats without alternation", () => {
    const detector = new ToolLoopDetector();
    run(detector, "bash", { command: "ls" }, "out");
    run(detector, "bash", { command: "ls" }, "out");
    assert.equal(detector.checkCall("bash", { command: "ls" }, OPTIONS)?.kind, "repeat");
  });

  it("respects a higher cycle threshold", () => {
    const options: ToolLoopOptions = { ...OPTIONS, maxRepeats: 10, pingPongMinCycles: 4 };
    const detector = new ToolLoopDetector();
    run(detector, "edit", { path: "/a" }, "edited");
    run(detector, "bash", { command: "npm test" }, "failed");
    run(detector, "edit", { path: "/a" }, "edited");
    run(detector, "bash", { command: "npm test" }, "failed");
    assert.equal(detector.checkCall("edit", { path: "/a" }, options), null);
    detector.recordResult("edit", { path: "/a" }, "edited", false, options);
    detector.recordResult("bash", { command: "npm test" }, "failed", false, options);
    assert.equal(detector.checkCall("edit", { path: "/a" }, options)?.kind, "ping-pong");
  });
});
