import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { runIsolatedSession } from "../src/isolated-session.ts";

describe("runIsolatedSession", () => {
  it("returns a no-model error without spawning when ctx.model is undefined", async () => {
    const result = await runIsolatedSession({ model: undefined } as unknown as ExtensionContext, {
      label: "/test",
      systemPrompt: "",
      task: "do nothing",
      extensionFactories: [],
    });

    expect(result.isError).toBe(true);
    expect(result.toolCalls).toBe(0);
    expect(result.errorMessage).toMatch(/no model available/i);
  });
});
