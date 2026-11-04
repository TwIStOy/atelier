import { join } from "node:path";
import { expect, it } from "vitest";
import { InjectionCache } from "../src/cache.ts";
import { relativeToBase, updateStatus } from "../src/reporter.ts";

it("returns the path relative to the base when inside it", () => {
  expect(relativeToBase("/proj", join("/proj", "src", "AGENTS.md"))).toBe(join("src", "AGENTS.md"));
});

it("returns the absolute path when outside the base", () => {
  expect(relativeToBase("/proj", "/mirror/src/AGENTS.md")).toBe("/mirror/src/AGENTS.md");
});

it("passes through non-absolute paths unchanged", () => {
  expect(relativeToBase("/proj", "AGENTS.md")).toBe("AGENTS.md");
});

it("handles a parent-traversal relative result by falling back to absolute", () => {
  expect(relativeToBase("/proj", "/proj-other/AGENTS.md")).toBe("/proj-other/AGENTS.md");
});

class ReceiverBoundTheme {
  private readonly ansi = { dim: "[dim]", warning: "[warn]" };

  fg(color: string, text: string): string {
    return `${this.ansi[color as "dim" | "warning"]}${text}`;
  }
}

it("invokes theme.fg as a method so class-based themes keep their receiver", () => {
  const cache = new InjectionCache();
  cache.markInjected("s1", "/proj/agents");
  cache.markInjected("s1", "/proj/docs");
  let captured: string | undefined;
  updateStatus(
    {
      hasUI: true,
      cwd: "/proj",
      ui: {
        theme: new ReceiverBoundTheme(),
        setStatus: (_key, text) => {
          captured = text;
        },
      },
    },
    cache,
    "s1",
    false,
  );
  expect(captured).toBe("[dim]◆ 2");
});
