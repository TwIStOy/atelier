import { describe, expect, test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GitComponent } from "./git.ts";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function fakeTheme(): {
  fg: (_color: string, text: string) => string;
} {
  return {
    fg: (_color: string, text: string) => text,
  };
}

describe("GitComponent.render width contract", () => {
  test("renders nothing when branch is unknown", () => {
    const git = new GitComponent("/nonexistent");
    expect(git.render(42, fakeTheme() as never)).toEqual([]);
  });

  test("never exceeds the given width for a long branch", async () => {
    const git = new GitComponent(process.cwd());
    await new Promise<void>((resolve) => {
      git.bindRender(resolve);
    });
    for (const width of [80, 42, 30, 20, 12, 8, 5, 1]) {
      const lines = git.render(width, fakeTheme() as never);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  test("uses ellipsis when truncating, keeps the marker", async () => {
    const git = new GitComponent(process.cwd());
    await new Promise<void>((resolve) => {
      git.bindRender(resolve);
    });
    const lines = git.render(10, fakeTheme() as never);
    const plain = stripAnsi(lines.join(""));
    expect(plain).toMatch(/[✓✗]/);
  });
});
