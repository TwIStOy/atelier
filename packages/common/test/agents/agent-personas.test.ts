import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(explore?.fileOptions.model).toBe("cheap");
    expect(catalog.agents.get("scout")?.fileOptions.model).toBe("middle");
    expect(catalog.agents.get("plan")?.fileOptions.model).toBe("flagship");
    expect(catalog.agents.get("general-purpose")?.fileOptions.model).toBeUndefined();
    expect(explore?.sourcePath).toContain(sharedPersonasDir());
  });
});

describe("malformed persona files (#212)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "personas-test-"));
    mkdirSync(join(dir, ".pi", "agents"), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips a file with broken frontmatter and records a warning naming the file", () => {
    const bad = join(dir, ".pi", "agents", "broken.md");
    writeFileSync(bad, "---\ndescription: [unterminated\n---\nbody text");

    const catalog = buildAgentPersonaCatalog(dir);

    expect(catalog.agents.has("broken")).toBe(false);
    expect(catalog.warnings.length).toBe(1);
    expect(catalog.warnings[0]).toContain("broken.md");
  });

  it("names the surviving file when the malformed one would have overridden it", () => {
    writeFileSync(join(dir, ".pi", "agents", "explore.md"), "---\n: not yaml at all : [\n---\nbody");

    const catalog = buildAgentPersonaCatalog(dir);

    expect(catalog.warnings.length).toBe(1);
    expect(catalog.warnings[0]).toContain("instead");
    expect(catalog.agents.get("explore")?.sourcePath).toContain(sharedPersonasDir());
  });

  it("loads valid files alongside a malformed one", () => {
    writeFileSync(join(dir, ".pi", "agents", "broken.md"), "---\nbad: [\n---\nbody");
    writeFileSync(join(dir, ".pi", "agents", "custom.md"), "---\ndescription: custom agent\n---\nDo the thing.");

    const catalog = buildAgentPersonaCatalog(dir);

    expect(catalog.agents.has("custom")).toBe(true);
    expect(catalog.agents.has("broken")).toBe(false);
    expect(catalog.warnings.length).toBe(1);
  });

  it("reports no warnings when every file parses", () => {
    writeFileSync(join(dir, ".pi", "agents", "custom.md"), "---\ndescription: custom agent\n---\nDo the thing.");

    const catalog = buildAgentPersonaCatalog(dir);

    expect(catalog.warnings).toEqual([]);
  });
});
