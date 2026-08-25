import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runChildAgent } from "../../src/agents/child-agent.ts";

function makeCtx(cwd: string): ExtensionContext {
  return {
    cwd,
    model: undefined,
    sessionManager: {
      getHeader: () => ({ id: "parent-test" }),
      getSessionFile: () => "",
    },
  } as unknown as ExtensionContext;
}

describe("runChildAgent setup failures (#179)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "child-agent-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("throws when the session directory cannot be created, instead of returning an isError result", async () => {
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory");

    await expect(
      runChildAgent(
        makeCtx(dir),
        {
          task: "do nothing",
          extensionFactories: [],
          sessionDir: join(blocker, "sessions"),
        },
        undefined,
      ),
    ).rejects.toThrow();
  });

  it("returns an isError result for a pre-aborted signal without throwing", async () => {
    const result = await runChildAgent(
      makeCtx(dir),
      {
        task: "do nothing",
        extensionFactories: [],
        sessionDir: join(dir, "sessions"),
      },
      AbortSignal.abort(),
    );
    expect(result.isError).toBe(true);
    expect(result.errorMessage).toMatch(/aborted/i);
  });
});
