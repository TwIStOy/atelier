import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const xdg = mkdtempSync(join(tmpdir(), "extra-tools-test-"));
process.env.XDG_CONFIG_HOME = xdg;

// External config edits are observed after the config stat TTL; the mocked
// clock lets tests advance past it after writing the config file.
let nowMs = Date.now();
vi.spyOn(Date, "now").mockImplementation(() => nowMs);

const { registerBashTool } = await import("../src/bash/index.ts");

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_STAT_TTL_MS } from "@htwang-contrib/common";
import { afterAll, describe, expect, it, vi } from "vitest";

interface RegisteredTool {
  name: string;
  description: string;
  parameters: { properties?: Record<string, unknown>; required?: string[] };
}

function capturePi(): { pi: ExtensionAPI; tools: RegisteredTool[] } {
  const tools: RegisteredTool[] = [];
  const pi = {
    registerTool: (def: RegisteredTool) => {
      tools.push(def);
    },
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

afterAll(() => {
  rmSync(xdg, { recursive: true, force: true });
});

describe("registerBashTool", () => {
  it("replaces bash with an extended schema requiring description by default", () => {
    const { pi, tools } = capturePi();
    registerBashTool(pi);
    expect(tools.length).toBe(1);
    const tool = tools[0];
    expect(tool.name).toBe("bash");
    expect(tool.parameters.required).toContain("description");
    expect(Object.keys(tool.parameters.properties ?? {})).toEqual(
      expect.arrayContaining(["command", "description", "timeout"]),
    );
    expect(tool.description).toContain("description");
  });

  it("does not register bash when extendedBash is disabled", () => {
    mkdirSync(join(xdg, "pi"), { recursive: true });
    writeFileSync(join(xdg, "pi", "extensions.json"), JSON.stringify({ "extra-tools": { extendedBash: false } }));
    nowMs += CONFIG_STAT_TTL_MS + 1;
    const { pi, tools } = capturePi();
    registerBashTool(pi);
    expect(tools.length).toBe(0);
  });
});
