import { describe, expect, it } from "vitest";
import { resolveDispatchAgentId } from "../src/agent-catalog.ts";
import type { SubagentSettings } from "../src/settings.ts";
import { validateTaskShape } from "../src/validate.ts";

function catalogWith(ids: string[]) {
  return {
    agents: new Map(ids.map((id) => [id, { prompt: "p", fileOptions: {}, sourcePath: `/x/${id}.md` }])),
    warnings: [],
  };
}

function settingsWith(fallbackAgent: string): SubagentSettings {
  return { maxConcurrent: 3, maxTotal: 10, timeoutMs: 0, fallbackAgent, defaultsByAgentType: {} };
}

const base = settingsWith("general-purpose");

describe("resolveDispatchAgentId (#183)", () => {
  const catalog = catalogWith(["general-purpose", "explore", "reviewer"]);

  it("resolves an exact type", () => {
    const r = resolveDispatchAgentId("explore", catalog, base);
    expect(r).toEqual({ ok: true, id: "explore" });
  });

  it("resolves omitted type to general-purpose", () => {
    const r = resolveDispatchAgentId(undefined, catalog, base);
    expect(r).toEqual({ ok: true, id: "general-purpose" });
  });

  it("routes an unknown type to the default fallback", () => {
    const r = resolveDispatchAgentId("typo-agent", catalog, base);
    expect(r).toEqual({ ok: true, id: "general-purpose", requested: "typo-agent" });
  });

  it("routes an unknown type to a configured named fallback", () => {
    const r = resolveDispatchAgentId("typo-agent", catalog, settingsWith("reviewer"));
    expect(r).toEqual({ ok: true, id: "reviewer", requested: "typo-agent" });
  });

  it("fails closed when fallbackAgent is none", () => {
    const r = resolveDispatchAgentId("typo-agent", catalog, settingsWith("none"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("typo-agent");
      expect(r.message).toContain("general-purpose");
    }
  });

  it("reports a misconfigured fallback that does not resolve", () => {
    const r = resolveDispatchAgentId("typo-agent", catalog, settingsWith("ghost"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("ghost");
  });
});

describe("validateTaskShape fallback enforcement", () => {
  const catalog = catalogWith(["general-purpose", "explore"]);

  it("rejects an unknown single-mode agent_type when fallback is none", () => {
    const r = validateTaskShape({ task: "do x", description: "x", agent_type: "nope" }, catalog, settingsWith("none"));
    expect(r.ok).toBe(false);
  });

  it("rejects when any batch task has an unknown agent_type and fallback is none", () => {
    const r = validateTaskShape(
      {
        tasks: [
          { task: "a", description: "a", agent_type: "explore" },
          { task: "b", description: "b", agent_type: "nope" },
        ],
      },
      catalog,
      settingsWith("none"),
    );
    expect(r.ok).toBe(false);
  });

  it("accepts unknown types when fallback routes to general-purpose", () => {
    const r = validateTaskShape({ task: "do x", description: "x", agent_type: "nope" }, catalog, base);
    expect(r).toEqual({ ok: true, mode: "single" });
  });
});
