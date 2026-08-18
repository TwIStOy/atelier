import { describe, expect, it } from "vitest";
import { buildAgentPersonaCatalog, sharedPersonasDir } from "../../src/agents/agent-personas.ts";

describe("shared personas layer", () => {
  it("resolves the repo-root agents directory", () => {
    expect(sharedPersonasDir()).toMatch(/agents[\\/]$/);
  });

  it("includes the shipped personas for any cwd without injection", () => {
    const catalog = buildAgentPersonaCatalog(process.cwd());
    for (const id of ["general-purpose", "explore", "plan", "scout"]) {
      expect(catalog.agents.has(id)).toBe(true);
    }
    const explore = catalog.agents.get("explore");
    expect(explore?.fileOptions.model).toBe("toori/deepseek-v4-flash");
    expect(explore?.sourcePath).toContain(sharedPersonasDir());
  });
});
