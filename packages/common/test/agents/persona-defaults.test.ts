import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parsePersonaDefaultsByType,
  personaDefaultsFilePath,
  personaDefaultsForType,
  readPersonaDefaultsByType,
} from "../../src/agents/persona-defaults.ts";

describe("parsePersonaDefaultsByType", () => {
  it("parses model and thinking rows with normalized keys", () => {
    const out = parsePersonaDefaultsByType({
      Explore: { model: " m1 ", thinking: "high" },
      scout: { model: "m2" },
    });
    expect(out).toEqual({
      explore: { model: "m1", thinking: "high" },
      scout: { model: "m2" },
    });
  });

  it("skips rows without model or thinking and invalid shapes", () => {
    const out = parsePersonaDefaultsByType({
      empty: {},
      nothing: "nope",
      "bad id!": { model: "m" },
      arr: [{ model: "m" }],
    });
    expect(out).toEqual({});
  });

  it("returns an empty map for non-objects", () => {
    expect(parsePersonaDefaultsByType(undefined)).toEqual({});
    expect(parsePersonaDefaultsByType(null)).toEqual({});
    expect(parsePersonaDefaultsByType([])).toEqual({});
  });
});

describe("readPersonaDefaultsByType", () => {
  let tmp: string;
  let saved: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "persona-defaults-"));
    saved = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = tmp;
  });

  afterEach(() => {
    if (saved === undefined) {
      Reflect.deleteProperty(process.env, "PI_CODING_AGENT_DIR");
    } else {
      process.env.PI_CODING_AGENT_DIR = saved;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("reads defaults_by_agent_type from the subagents settings file", () => {
    fs.mkdirSync(path.join(tmp, "subagents"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "subagents", "settings.json"),
      JSON.stringify({
        max_concurrent: 4,
        defaults_by_agent_type: {
          explore: { thinking: "medium" },
        },
      }),
    );
    expect(personaDefaultsFilePath()).toBe(path.join(tmp, "subagents", "settings.json"));
    expect(readPersonaDefaultsByType()).toEqual({ explore: { thinking: "medium" } });
  });

  it("returns an empty map when the file is missing or malformed", () => {
    expect(readPersonaDefaultsByType()).toEqual({});
    fs.mkdirSync(path.join(tmp, "subagents"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "subagents", "settings.json"), "{not json");
    expect(readPersonaDefaultsByType()).toEqual({});
    fs.writeFileSync(path.join(tmp, "subagents", "settings.json"), JSON.stringify(["array"]));
    expect(readPersonaDefaultsByType()).toEqual({});
  });
});

describe("personaDefaultsForType", () => {
  it("resolves by normalized id and falls back to general-purpose for the key only", () => {
    const defaults = { explore: { model: "m1" }, "general-purpose": { model: "base" } };
    expect(personaDefaultsForType(defaults, "Explore")).toEqual({ model: "m1" });
    expect(personaDefaultsForType(defaults, "unknown")).toEqual({});
    expect(personaDefaultsForType(defaults, "!!!")).toEqual({ model: "base" });
  });
});
