import { describe, expect, it } from "vitest";
import { VIEWER_DEFAULTS } from "./command.ts";

describe("subagents viewer command defaults", () => {
  it("tools are collapsed by default", () => {
    expect(VIEWER_DEFAULTS.expanded).toBe(false);
  });

  it("thinking blocks are shown by default", () => {
    expect(VIEWER_DEFAULTS.hideThinkingBlock).toBe(false);
  });
});
