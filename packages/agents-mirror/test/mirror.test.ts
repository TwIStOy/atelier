import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveMirrorRoot } from "../src/mirror.ts";

describe("resolveMirrorRoot", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "am-mir-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the mirror root when cwd matches a mapping key", () => {
    const project = join(root, "proj");
    const mirror = join(root, "mirror");
    mkdirSync(project, { recursive: true });
    mkdirSync(mirror, { recursive: true });
    expect(resolveMirrorRoot({ [project]: mirror }, project)).toBe(mirror);
  });

  it("returns null when no key matches cwd", () => {
    const project = join(root, "proj");
    mkdirSync(project, { recursive: true });
    expect(resolveMirrorRoot({ "/other": "/m" }, project)).toBeNull();
  });

  it("matches through a symlinked project path", () => {
    const project = join(root, "proj");
    const link = join(root, "link");
    const mirror = join(root, "mirror");
    mkdirSync(project, { recursive: true });
    mkdirSync(mirror, { recursive: true });
    symlinkSync(project, link);
    expect(resolveMirrorRoot({ [project]: mirror }, link)).toBe(mirror);
  });

  it("skips mapping keys that do not exist on disk", () => {
    const project = join(root, "proj");
    const mirror = join(root, "mirror");
    mkdirSync(project, { recursive: true });
    mkdirSync(mirror, { recursive: true });
    expect(resolveMirrorRoot({ "/nope": "/m", [project]: mirror }, project)).toBe(mirror);
  });
});
