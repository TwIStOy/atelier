import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FALLBACK_AGENT_NONE, readSubagentSettings } from "../src/settings.ts";

describe("readSubagentSettings fallback_agent", () => {
  let dir: string;
  const ENV = "PI_CODING_AGENT_DIR";
  let saved: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "subagents-settings-"));
    mkdirSync(join(dir, "subagents"), { recursive: true });
    saved = process.env[ENV];
    process.env[ENV] = dir;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  function write(settings: unknown) {
    writeFileSync(join(dir, "subagents", "settings.json"), JSON.stringify(settings));
  }

  it("defaults fallbackAgent to general-purpose when unset", () => {
    write({});
    expect(readSubagentSettings().fallbackAgent).toBe("general-purpose");
  });

  it("reads a named fallback agent", () => {
    write({ fallback_agent: "reviewer" });
    expect(readSubagentSettings().fallbackAgent).toBe("reviewer");
  });

  it('reads "none" as fail-closed', () => {
    write({ fallback_agent: "none" });
    expect(readSubagentSettings().fallbackAgent).toBe(FALLBACK_AGENT_NONE);
  });

  it("reads boolean false as fail-closed", () => {
    write({ fallback_agent: false });
    expect(readSubagentSettings().fallbackAgent).toBe(FALLBACK_AGENT_NONE);
  });

  it("ignores wrong-typed values", () => {
    write({ fallback_agent: 42 });
    expect(readSubagentSettings().fallbackAgent).toBe("general-purpose");
  });

  it("keeps working when the settings file is missing", () => {
    expect(readSubagentSettings().fallbackAgent).toBe("general-purpose");
  });
});
