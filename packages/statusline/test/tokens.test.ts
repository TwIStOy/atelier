import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { formatTokens, formatTokenUsageArrows } from "@htwang-contrib/common";
import { describe, expect, it } from "vitest";
import { TokensComponent } from "../src/components/tokens.ts";

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function assistant(usage: Usage) {
  return { type: "message", message: { role: "assistant", usage } };
}

function other() {
  return { type: "tool_result", content: [] };
}

function ctxWithBranch(getBranch: () => unknown[]): ExtensionContext {
  return { sessionManager: { getBranch } } as unknown as ExtensionContext;
}

const theme = { fg: (_c: string, t: string) => t } as unknown as Theme;

function expectedLine(usage: Usage): string {
  const parts = [
    formatTokenUsageArrows(usage.input, usage.output),
    `R${formatTokens(usage.cacheRead)}`,
    `W${formatTokens(usage.cacheWrite)}`,
  ];
  return parts.join(" ");
}

describe("TokensComponent", () => {
  it("sums usage over all assistant messages", () => {
    const comp = new TokensComponent(
      ctxWithBranch(() => [
        other(),
        assistant({ input: 10, output: 2, cacheRead: 0, cacheWrite: 0 }),
        other(),
        assistant({ input: 5, output: 3, cacheRead: 100, cacheWrite: 7 }),
      ]),
    );
    expect(comp.render(120, theme)).toEqual([expectedLine({ input: 15, output: 5, cacheRead: 100, cacheWrite: 7 })]);
  });

  it("reflects live usage growth of the streaming last message", () => {
    const live = assistant({ input: 10, output: 1, cacheRead: 0, cacheWrite: 0 });
    const branch = [assistant({ input: 4, output: 4, cacheRead: 0, cacheWrite: 0 }), live];
    const comp = new TokensComponent(ctxWithBranch(() => branch));
    expect(comp.render(120, theme)).toEqual([expectedLine({ input: 14, output: 5, cacheRead: 0, cacheWrite: 0 })]);
    live.message.usage = { input: 10, output: 9, cacheRead: 0, cacheWrite: 0 };
    expect(comp.render(120, theme)).toEqual([expectedLine({ input: 14, output: 13, cacheRead: 0, cacheWrite: 0 })]);
  });

  it("folds finalized entries forward as new ones arrive", () => {
    const a = assistant({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
    const b = assistant({ input: 2, output: 2, cacheRead: 0, cacheWrite: 0 });
    const branch = [a];
    const comp = new TokensComponent(ctxWithBranch(() => branch));
    comp.render(120, theme);
    branch.push(b);
    expect(comp.render(120, theme)).toEqual([expectedLine({ input: 3, output: 3, cacheRead: 0, cacheWrite: 0 })]);
    a.message.usage = { input: 99, output: 99, cacheRead: 0, cacheWrite: 0 };
    expect(comp.render(120, theme)).toEqual([
      expectedLine({ input: 1 + 2, output: 1 + 2, cacheRead: 0, cacheWrite: 0 }),
    ]);
  });

  it("recomputes after a tree switch to a diverging branch", () => {
    const root = other();
    const left = assistant({ input: 10, output: 0, cacheRead: 0, cacheWrite: 0 });
    const right = assistant({ input: 0, output: 0, cacheRead: 20, cacheWrite: 0 });
    let branch = [root, left];
    const comp = new TokensComponent(ctxWithBranch(() => branch));
    expect(comp.render(120, theme)).toEqual([expectedLine({ input: 10, output: 0, cacheRead: 0, cacheWrite: 0 })]);
    branch = [root, right];
    expect(comp.render(120, theme)).toEqual([expectedLine({ input: 0, output: 0, cacheRead: 20, cacheWrite: 0 })]);
  });

  it("recomputes after head compaction replaces early entries", () => {
    const m0 = assistant({ input: 1000, output: 1000, cacheRead: 0, cacheWrite: 0 });
    const m1 = assistant({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 });
    const m2 = assistant({ input: 2, output: 2, cacheRead: 0, cacheWrite: 0 });
    let branch: unknown[] = [m0, m1, m2];
    const comp = new TokensComponent(ctxWithBranch(() => branch));
    expect(comp.render(120, theme)).toEqual([expectedLine({ input: 1003, output: 1003, cacheRead: 0, cacheWrite: 0 })]);
    branch = [{ type: "summary" }, m1, m2];
    expect(comp.render(120, theme)).toEqual([expectedLine({ input: 3, output: 3, cacheRead: 0, cacheWrite: 0 })]);
  });

  it("renders zeros for an empty branch", () => {
    const comp = new TokensComponent(ctxWithBranch(() => []));
    expect(comp.render(120, theme)).toEqual([expectedLine({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })]);
  });
});
