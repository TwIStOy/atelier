import { describe, expect, it } from "vitest";
import { runWorkflow, type WorkflowAgentCall, type WorkflowAgentRunResult } from "../src/engine.ts";

const META = `export const meta = { name: "test-flow", description: "test" };`;

function okRunner(value: unknown = "done") {
  const calls: WorkflowAgentCall[] = [];
  const runner = async (call: WorkflowAgentCall): Promise<WorkflowAgentRunResult> => {
    calls.push(call);
    return { ok: true, value };
  };
  return { calls, runner };
}

const BASE_OPTIONS = { maxConcurrency: 4, maxAgents: 8 };

describe("runWorkflow", () => {
  it("returns parse errors without running agents", async () => {
    const { calls, runner } = okRunner();
    const result = await runWorkflow("const x = 1;", { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("export const meta");
    expect(calls).toHaveLength(0);
    expect(result.snapshot.status).toBe("error");
  });

  it("runs agents and returns the script value", async () => {
    const { calls, runner } = okRunner("text-result");
    const script = `${META}
const a = await agent({ label: "one", task: "do one" });
const b = await agent({ label: "two", task: "do two" });
return [a, b];`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(["text-result", "text-result"]);
    expect(calls.map((c) => c.label)).toEqual(["one", "two"]);
    expect(result.snapshot.status).toBe("done");
    expect(result.snapshot.agents.every((a) => a.status === "done")).toBe(true);
  });

  it("returns null for failed agents and keeps going", async () => {
    const runner = async (call: WorkflowAgentCall): Promise<WorkflowAgentRunResult> => {
      if (call.label === "bad") return { ok: false, error: "boom" };
      return { ok: true, text: "fine" };
    };
    const script = `${META}
const bad = await agent({ label: "bad", task: "fail" });
const good = await agent({ label: "good", task: "ok" });
return { bad, good };`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ bad: null, good: "fine" });
    const bad = result.snapshot.agents.find((a) => a.label === "bad");
    expect(bad?.status).toBe("error");
    expect(bad?.detail).toBe("boom");
    expect(result.snapshot.logs.some((l) => l.includes("boom"))).toBe(true);
  });

  it("parallel runs thunks concurrently and preserves order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const runner = async (call: WorkflowAgentCall): Promise<WorkflowAgentRunResult> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { ok: true, value: call.label };
    };
    const script = `${META}
const results = await parallel([
  () => agent({ label: "a", task: "t" }),
  () => agent({ label: "b", task: "t" }),
  () => agent({ label: "c", task: "t" }),
]);
return results;`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, maxConcurrency: 2, runAgent: runner });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(["a", "b", "c"]);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("parallel rejects promises with an actionable error", async () => {
    const { runner } = okRunner();
    const script = `${META}
await parallel([agent({ label: "a", task: "t" })]);`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not a function");
  });

  it("pipeline threads values through stages", async () => {
    const runner = async (call: WorkflowAgentCall): Promise<WorkflowAgentRunResult> => ({
      ok: true,
      value: `${call.task}`,
    });
    const script = `${META}
const out = await pipeline("start", (prev) => agent({ label: "s1", task: prev + "-1" }), (prev) => agent({ label: "s2", task: prev + "-2" }));
return out;`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(true);
    expect(result.value).toBe("start-1-2");
  });

  it("tracks phases in the snapshot", async () => {
    const { runner } = okRunner();
    const script = `${META}
phase("collect");
await agent({ label: "a", task: "t" });
phase("synthesize");
await agent({ label: "b", task: "t" });`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(true);
    expect(result.snapshot.phases.map((p) => [p.title, p.status])).toEqual([
      ["collect", "done"],
      ["synthesize", "done"],
    ]);
    expect(result.snapshot.agents[0]?.phase).toBe("collect");
    expect(result.snapshot.agents[1]?.phase).toBe("synthesize");
  });

  it("enforces the agent limit", async () => {
    const { runner } = okRunner();
    const script = `${META}
for (let i = 0; i < 5; i++) {
  await agent({ label: "a" + i, task: "t" });
}`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, maxAgents: 3, runAgent: runner });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("agent limit");
  });

  it("validates agent call arguments", async () => {
    const { runner } = okRunner();
    const script = `${META}
await agent({ label: "x" });`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("task");
  });

  it("requires object schemas", async () => {
    const { runner } = okRunner();
    const script = `${META}
await agent({ label: "x", task: "t", schema: { type: "array" } });`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('type: "object"');
  });

  it("captures console output into logs", async () => {
    const { runner } = okRunner();
    const script = `${META}
console.log("hello", { a: 1 });
await agent({ label: "a", task: "t" });`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(true);
    expect(result.snapshot.logs).toContain('[log] hello {"a":1}');
  });

  it("passes args into the sandbox", async () => {
    const { runner } = okRunner();
    const script = `${META}
return args.target * 2;`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, args: { target: 21 }, runAgent: runner });
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
  });

  it("sandbox has no host globals", async () => {
    const { runner } = okRunner();
    const script = `${META}
return [typeof process, typeof require, typeof globalThis === "undefined"];`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not available");
  });

  it("aborts in-flight workflow and marks agents", async () => {
    const controller = new AbortController();
    const runner = async (): Promise<WorkflowAgentRunResult> => {
      controller.abort();
      return { ok: false, error: "aborted" };
    };
    const script = `${META}
await agent({ label: "a", task: "t" });
return "unreachable";`;
    const result = await runWorkflow(script, {
      ...BASE_OPTIONS,
      signal: controller.signal,
      runAgent: runner,
    });
    expect(result.ok).toBe(false);
    expect(result.snapshot.status).toBe("aborted");
    expect(result.error).toContain("aborted");
  });

  it("reports tool call progress on agent snapshots", async () => {
    const runner = async (
      _call: WorkflowAgentCall,
      ctx: { onProgress: (toolCalls: number) => void },
    ): Promise<WorkflowAgentRunResult> => {
      ctx.onProgress(3);
      return { ok: true, text: "x" };
    };
    const script = `${META}
await agent({ label: "a", task: "t" });`;
    const result = await runWorkflow(script, { ...BASE_OPTIONS, runAgent: runner });
    expect(result.ok).toBe(true);
    expect(result.snapshot.agents[0]?.toolCalls).toBe(3);
  });
});
