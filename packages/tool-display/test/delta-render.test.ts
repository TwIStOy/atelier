import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const FALLBACK_THEME = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

let tmpDir: string;
let callbacks: Array<(error: Error | null, stdout: string) => void>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tool-display-delta-"));
  vi.stubEnv("XDG_CONFIG_HOME", tmpDir);
  callbacks = [];
  execFileMock.mockReset();
  execFileMock.mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: (error: Error | null, stdout: string) => void) => {
      callbacks.push(cb);
      return { stdin: { on: vi.fn(), end: vi.fn() } };
    },
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("renderWithDelta", () => {
  it("returns fallback lines immediately and spawns at most once per diff", async () => {
    const { currentDeltaRenderVersion, renderWithDelta } = await import("../src/adapters/shared.ts");
    const version = currentDeltaRenderVersion();

    const first = renderWithDelta("line1\nline2\n", 80, FALLBACK_THEME);
    expect(first).toEqual(["line1", "line2"]);
    await settle();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    renderWithDelta("line1\nline2\n", 80, FALLBACK_THEME);
    await settle();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    callbacks[0]?.(null, "styled\n");
    await settle();
    await settle();
    expect(currentDeltaRenderVersion()).toBe(version + 1);
    expect(renderWithDelta("line1\nline2\n", 80, FALLBACK_THEME)).toEqual(["styled"]);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("filters diff headers, expands tabs, and drops the binary name from argv", async () => {
    const { renderWithDelta } = await import("../src/adapters/shared.ts");
    renderWithDelta("unique-diff-A\n", 200, FALLBACK_THEME);
    await settle();

    const [file, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(file).toBe("delta");
    expect(args).not.toContain("delta");
    expect(args).toContain("--width=200");
    expect(args.join(" ")).not.toContain('"');

    callbacks[callbacks.length - 1]?.(null, "keep\ttab\n--- a/f\n+++\nstays\n");
    await settle();
    await settle();
    expect(renderWithDelta("unique-diff-A\n", 200, FALLBACK_THEME)).toEqual(["keep   tab", "stays"]);
  });

  it("caches the fallback when the spawn fails so it never respawns", async () => {
    const { currentDeltaRenderVersion, renderWithDelta } = await import("../src/adapters/shared.ts");
    const version = currentDeltaRenderVersion();
    const first = renderWithDelta("unique-diff-B\n", 80, FALLBACK_THEME);
    expect(first).toEqual(["unique-diff-B"]);
    await settle();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    callbacks[callbacks.length - 1]?.(new Error("spawn ENOENT"), "");
    await settle();
    await settle();
    expect(renderWithDelta("unique-diff-B\n", 80, FALLBACK_THEME)).toEqual(["unique-diff-B"]);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(currentDeltaRenderVersion()).toBe(version + 1);
  });
});
