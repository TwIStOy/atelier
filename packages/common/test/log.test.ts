import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createLogger, getExtensionsLogPath, resolveStateDir } from "../src/log.ts";

describe("resolveStateDir", () => {
  test("prefers XDG_STATE_HOME", () => {
    expect(resolveStateDir({ XDG_STATE_HOME: "/xdg/state" })).toBe("/xdg/state");
  });

  test("trims whitespace in XDG_STATE_HOME", () => {
    expect(resolveStateDir({ XDG_STATE_HOME: "  /xdg/state  " })).toBe("/xdg/state");
  });

  test("ignores empty XDG_STATE_HOME and falls back to HOME", () => {
    expect(resolveStateDir({ XDG_STATE_HOME: "   ", HOME: "/home/u" })).toBe("/home/u/.local/state");
  });

  test("falls back to HOME/.local/state", () => {
    expect(resolveStateDir({ HOME: "/home/u" }, "/root")).toBe("/home/u/.local/state");
  });

  test("falls back to provided home when no env vars set", () => {
    expect(resolveStateDir({}, "/root")).toBe("/root/.local/state");
  });
});

describe("getExtensionsLogPath", () => {
  test("joins state dir / pi / extensions.log", () => {
    expect(getExtensionsLogPath({ XDG_STATE_HOME: "/xdg" })).toBe("/xdg/pi/extensions.log");
  });
});

describe("createLogger", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-log-"));
    env = { XDG_STATE_HOME: dir };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function readLog(): string {
    return readFileSync(getExtensionsLogPath(env), "utf8");
  }

  test("writes namespaced, timestamped lines with level", () => {
    const log = createLogger("demo", { env });
    log.info("hello world");
    log.warn("careful");
    const content = readLog();
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[demo\] INFO hello world\n/);
    expect(content).toMatch(/\[demo\] WARN careful\n$/);
  });

  test("multiple loggers append to the same shared file", () => {
    createLogger("alpha", { env }).info("one");
    createLogger("beta", { env }).info("two");
    const content = readLog();
    expect(content).toContain("[alpha] INFO one");
    expect(content).toContain("[beta] INFO two");
  });

  test("respects minLevel filtering", () => {
    const log = createLogger("flt", { env, minLevel: "warn" });
    log.debug("dropped-debug");
    log.info("dropped-info");
    log.warn("kept");
    log.error("kept-too");
    const content = readLog();
    expect(content).not.toContain("dropped-debug");
    expect(content).not.toContain("dropped-info");
    expect(content).toContain("[flt] WARN kept");
    expect(content).toContain("[flt] ERROR kept-too");
  });

  test("never throws when the log path is unwritable", () => {
    // /dev/null is a character device, so mkdirSync under it fails with
    // ENOTDIR immediately (unlike a missing /proc path which can hang in
    // some sandboxes). The logger must swallow the failure, never throw.
    const log = createLogger("x", { env: { XDG_STATE_HOME: "/dev/null/sub" } });
    expect(() => log.error("boom")).not.toThrow();
  });
});
