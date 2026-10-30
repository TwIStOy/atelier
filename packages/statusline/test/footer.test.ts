import type { ExtensionContext, ReadonlyFooterDataProvider, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, test, vi } from "vitest";

let showGitBranch = true;
let showExtensionStatus = true;
let gitInstances = 0;

vi.mock("../src/config.ts", () => ({
  loadConfig: () => ({ showGitBranch, showExtensionStatus }),
}));

vi.mock("../src/components/git.ts", () => {
  return {
    GitComponent: class {
      constructor() {
        gitInstances++;
      }
      bindRender() {}
      dispose() {}
      render(_width: number, _theme: Theme): string[] {
        return ["main \u2713"];
      }
    },
  };
});

const { makeFooter } = await import("../src/footer.ts");

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function fakeTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
  } as unknown as Theme;
}

function fakeCtx(): ExtensionContext {
  return {
    cwd: process.cwd(),
    model: { provider: "other", id: "m" },
    sessionManager: { getBranch: () => [] },
  } as unknown as ExtensionContext;
}

function fakeFooterData(statuses: Map<string, string> = new Map()): ReadonlyFooterDataProvider {
  return {
    getGitBranch: () => null,
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => 0,
    onBranchChange: () => () => {},
  } as unknown as ReadonlyFooterDataProvider;
}

function fakeTui(): TUI {
  return { requestRender: () => {} } as unknown as TUI;
}

afterEach(() => {
  showGitBranch = true;
  showExtensionStatus = true;
  gitInstances = 0;
});

describe("makeFooter git branch toggle", () => {
  test("creates the git component when enabled", () => {
    showGitBranch = true;
    const factory = makeFooter(fakeCtx());
    const comp = factory(fakeTui(), fakeTheme(), fakeFooterData());
    expect(gitInstances).toBe(1);
    const lines = comp.render(80);
    expect(stripAnsi(lines.join(" "))).toContain("\u2713");
    comp.dispose?.();
  });

  test("does not create the git component when disabled", () => {
    showGitBranch = false;
    const factory = makeFooter(fakeCtx());
    const comp = factory(fakeTui(), fakeTheme(), fakeFooterData());
    expect(gitInstances).toBe(0);
    const lines = comp.render(80);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(80);
      expect(stripAnsi(line)).not.toMatch(/[\u2713\u2717]/);
    }
    comp.dispose?.();
  });
});

describe("makeFooter extension status", () => {
  test("renders ctx.ui.setStatus values from footerData.ln()", () => {
    showGitBranch = false;
    const factory = makeFooter(fakeCtx());
    const statuses = new Map([["ext:agents-mirror:status", "\u25C6 2"]]);
    const comp = factory(fakeTui(), fakeTheme(), fakeFooterData(statuses));
    const lines = comp.render(80);
    expect(stripAnsi(lines.join(" "))).toContain("\u25C6 2");
    comp.dispose?.();
  });

  test("renders nothing extra when no extension has set a status", () => {
    showGitBranch = true;
    const factory = makeFooter(fakeCtx());
    const comp = factory(fakeTui(), fakeTheme(), fakeFooterData(new Map()));
    const lines = comp.render(80);
    expect(stripAnsi(lines.join(" "))).toContain("\u2713");
    comp.dispose?.();
  });

  test("can be disabled via config", () => {
    showGitBranch = false;
    showExtensionStatus = false;
    const factory = makeFooter(fakeCtx());
    const statuses = new Map([["ext:agents-mirror:status", "\u25C6 2"]]);
    const comp = factory(fakeTui(), fakeTheme(), fakeFooterData(statuses));
    const lines = comp.render(80);
    expect(stripAnsi(lines.join(" "))).not.toContain("\u25C6");
    comp.dispose?.();
  });
});
