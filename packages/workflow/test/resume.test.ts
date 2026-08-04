import { describe, expect, it } from "vitest";
import { type ResumeState, runWorkflow, type WorkflowAgentCall, type WorkflowAgentRunResult } from "../src/engine.ts";

const META = `export const meta = { name: "resume-test", description: "test" };`;
const BASE_OPTIONS = { maxConcurrency: 4, maxAgents: 8 };

const THREE_AGENT_SCRIPT = `${META}
const a = await agent({ label: "one", task: "t1" });
const b = await agent({ label: "two", task: "t2" });
const c = await agent({ label: "three", task: "t3" });
return [a, b, c];`;

function recordRunner(calls: WorkflowAgentCall[], values?: Map<string, unknown>) {
  return async (call: WorkflowAgentCall): Promise<WorkflowAgentRunResult> => {
    calls.push(call);
    return { ok: true, value: values?.get(call.label) ?? `live:${call.label}` };
  };
}

describe("runWorkflow resume", () => {
  it("serves agents before the cutoff from cache and runs the rest live", async () => {
    const calls: WorkflowAgentCall[] = [];
    const resume: ResumeState = {
      cutoff: 3,
      agents: [
        { seq: 1, call: { label: "one", task: "t1" }, ok: true, value: "cached:one" },
        { seq: 2, call: { label: "two", task: "t2" }, ok: true, value: "cached:two" },
      ],
    };
    const result = await runWorkflow(THREE_AGENT_SCRIPT, {
      ...BASE_OPTIONS,
      resume,
      runAgent: recordRunner(calls),
    });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(["cached:one", "cached:two", "live:three"]);
    expect(calls.map((c) => c.label)).toEqual(["three"]);
    expect(result.snapshot.agents[0]?.cached).toBe(true);
    expect(result.snapshot.agents[1]?.cached).toBe(true);
    expect(result.snapshot.agents[2]?.cached).toBeUndefined();
  });

  it("re-runs everything after the first unfinished agent, even completed ones", async () => {
    const calls: WorkflowAgentCall[] = [];
    const resume: ResumeState = {
      cutoff: 2,
      agents: [
        { seq: 1, call: { label: "one", task: "t1" }, ok: true, value: "cached:one" },
        { seq: 3, call: { label: "three", task: "t3" }, ok: true, value: "cached:three" },
      ],
    };
    const result = await runWorkflow(THREE_AGENT_SCRIPT, {
      ...BASE_OPTIONS,
      resume,
      runAgent: recordRunner(calls),
    });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(["cached:one", "live:two", "live:three"]);
    expect(calls.map((c) => c.label)).toEqual(["two", "three"]);
  });

  it("ignores cache entries whose call no longer matches", async () => {
    const calls: WorkflowAgentCall[] = [];
    const resume: ResumeState = {
      cutoff: 4,
      agents: [{ seq: 1, call: { label: "one", task: "DIFFERENT" }, ok: true, value: "cached:one" }],
    };
    const result = await runWorkflow(THREE_AGENT_SCRIPT, {
      ...BASE_OPTIONS,
      resume,
      runAgent: recordRunner(calls),
    });
    expect(result.ok).toBe(true);
    expect(calls.map((c) => c.label)).toEqual(["one", "two", "three"]);
  });

  it("reports settled agents through onAgentSettled, including cached ones", async () => {
    const settled: Array<{ seq: number; ok: boolean; value?: unknown }> = [];
    const resume: ResumeState = {
      cutoff: 2,
      agents: [{ seq: 1, call: { label: "one", task: "t1" }, ok: true, value: "cached:one" }],
    };
    await runWorkflow(THREE_AGENT_SCRIPT, {
      ...BASE_OPTIONS,
      resume,
      runAgent: recordRunner([]),
      onAgentSettled: (record) => settled.push(record),
    });
    expect(settled.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(settled[0]).toMatchObject({ ok: true, value: "cached:one" });
    expect(settled[2]).toMatchObject({ ok: true, value: "live:three" });
  });

  it("records failed outcomes without poisoning the cache", async () => {
    const settled: Array<{ seq: number; ok: boolean }> = [];
    const runner = async (call: WorkflowAgentCall): Promise<WorkflowAgentRunResult> => {
      if (call.label === "two") return { ok: false, error: "boom" };
      return { ok: true, value: `live:${call.label}` };
    };
    const result = await runWorkflow(THREE_AGENT_SCRIPT, {
      ...BASE_OPTIONS,
      runAgent: runner,
      onAgentSettled: (record) => settled.push(record),
    });
    expect(result.ok).toBe(true);
    expect(settled.find((s) => s.seq === 2)?.ok).toBe(false);
    expect(settled.find((s) => s.seq === 3)?.ok).toBe(true);
  });
});
