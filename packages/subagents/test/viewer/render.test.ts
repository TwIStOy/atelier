import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSubagentMessages } from "../../src/viewer/index.ts";
import { buildSubagentConversation } from "../../src/viewer/render.ts";
import { writeChildSession } from "./fixtures.ts";

process.env.PI_PACKAGE_DIR = fileURLToPath(
  new URL("../../../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);

function makeMockTui(): TUI {
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 50, columns: 120 },
  };
  return tui as unknown as TUI;
}

initTheme(undefined, false);

const originalHome = process.env.HOME;
let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "subagents-render-"));
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("subagents viewer-render", () => {
  it("builds a non-empty conversation tree from a child session", () => {
    const sample = writeChildSession(path.join(tmpHome, "sessions"));
    const messages = loadSubagentMessages(sample);
    const tree = buildSubagentConversation(
      messages,
      { expanded: true, hideThinkingBlock: false },
      makeMockTui(),
      tmpHome,
    );
    expect(tree.children.length).toBeGreaterThan(0);
  });

  it("render() of the conversation tree produces lines", () => {
    const sample = writeChildSession(path.join(tmpHome, "sessions"));
    const messages = loadSubagentMessages(sample);
    const tree = buildSubagentConversation(
      messages,
      { expanded: false, hideThinkingBlock: false },
      makeMockTui(),
      tmpHome,
    );
    const lines = tree.render(120);
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join("\n");
    expect(typeof joined).toBe("string");
  });

  it("handles an empty message list", () => {
    const tree = buildSubagentConversation([], { expanded: true, hideThinkingBlock: false }, makeMockTui(), tmpHome);
    expect(tree.children.length).toBe(0);
    expect(tree.render(100)).toEqual([]);
  });
});
