import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { loadSubagentMessages } from "../../src/viewer/index.ts";
import { buildSubagentConversation } from "../../src/viewer/render.ts";

function makeMockTui(): TUI {
  const tui = {
    requestRender: vi.fn(),
    terminal: { rows: 50, columns: 120 },
  };
  return tui as unknown as TUI;
}

initTheme(undefined, false);

function findSampleChildSession(): string | null {
  const dir = path.join(os.homedir(), ".agent", "subagents", "session");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));
  return files[0] ?? null;
}

describe("subagents viewer-render", () => {
  it("builds a non-empty conversation tree from a real child session", () => {
    const sample = findSampleChildSession();
    if (!sample) {
      console.warn("no sample child session; skipping");
      return;
    }
    const messages = loadSubagentMessages(sample);
    const tree = buildSubagentConversation(
      messages,
      { expanded: true, hideThinkingBlock: false },
      makeMockTui(),
      os.homedir(),
    );
    expect(tree.children.length).toBeGreaterThan(0);
  });

  it("render() of the conversation tree produces lines", () => {
    const sample = findSampleChildSession();
    if (!sample) {
      console.warn("no sample child session; skipping");
      return;
    }
    const messages = loadSubagentMessages(sample);
    const tree = buildSubagentConversation(
      messages,
      { expanded: false, hideThinkingBlock: false },
      makeMockTui(),
      os.homedir(),
    );
    const lines = tree.render(120);
    expect(lines.length).toBeGreaterThan(0);
    const joined = lines.join("\n");
    expect(typeof joined).toBe("string");
  });

  it("handles an empty message list", () => {
    const tree = buildSubagentConversation(
      [],
      { expanded: true, hideThinkingBlock: false },
      makeMockTui(),
      os.homedir(),
    );
    expect(tree.children.length).toBe(0);
    expect(tree.render(100)).toEqual([]);
  });
});
