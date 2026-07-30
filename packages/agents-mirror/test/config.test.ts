import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearMappingsCache, loadMappings, normalizeMappings } from "../src/config.ts";

function writeFile(dir: string, rel: string, content: string): void {
  const target = join(dir, rel);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

describe("normalizeMappings", () => {
  it("keeps string-to-string entries", () => {
    expect(normalizeMappings({ "/a": "/b", "/c": "/d" })).toEqual({ "/a": "/b", "/c": "/d" });
  });

  it("drops non-string values and empty strings", () => {
    expect(normalizeMappings({ "/a": 1, "/b": "/c", ok: "" })).toEqual({ "/b": "/c" });
  });

  it("rejects non-object input", () => {
    expect(normalizeMappings(null)).toEqual({});
    expect(normalizeMappings([])).toEqual({});
    expect(normalizeMappings("x")).toEqual({});
  });
});

describe("loadMappings", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "am-cfg-"));
    clearMappingsCache();
  });

  afterEach(() => {
    clearMappingsCache();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty when the file does not exist", () => {
    expect(loadMappings(join(dir, "missing.json"))).toEqual({});
  });

  it("reads and caches an object map", () => {
    const file = join(dir, "m.json");
    writeFile(dir, "m.json", JSON.stringify({ "/proj": "/mirror" }));
    expect(loadMappings(file)).toEqual({ "/proj": "/mirror" });
  });

  it("reloads when the file mtime changes", () => {
    const file = join(dir, "m.json");
    writeFile(dir, "m.json", JSON.stringify({ "/proj": "/mirror1" }));
    expect(loadMappings(file)).toEqual({ "/proj": "/mirror1" });

    writeFile(dir, "m.json", JSON.stringify({ "/proj": "/mirror2" }));
    const future = Date.now() / 1000 + 10;
    utimesSync(file, future, future);
    expect(loadMappings(file)).toEqual({ "/proj": "/mirror2" });
  });

  it("returns empty on invalid json", () => {
    const file = join(dir, "m.json");
    writeFileSync(file, "{ not json", "utf8");
    expect(loadMappings(file)).toEqual({});
  });
});
