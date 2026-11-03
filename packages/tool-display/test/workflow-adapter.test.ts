import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { workflowAdapter } from "../src/adapters/workflow.ts";

initTheme("dark", false);

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

const SCRIPT = `export const meta = { name: "repo-audit", description: "audit" };
phase("collect");
const a = await agent({ label: "one", task: "t1" });
return a;`;

function detailsWithAgents() {
  return {
    ok: true,
    workflow: {
      status: "running",
      agents: [
        { id: 1, label: "one", status: "done", toolCalls: 3 },
        { id: 2, label: "two", status: "running", toolCalls: 1 },
        { id: 3, label: "three", status: "queued", toolCalls: 0 },
      ],
    },
  };
}

describe("workflowAdapter.formatCallHeader", () => {
  it("shows the workflow meta name", () => {
    const header = workflowAdapter.formatCallHeader({ script: SCRIPT }, theme);
    expect(header).toContain("Workflow");
    expect(header).toContain("repo-audit");
  });

  it("shows settled/total agent stats from details", () => {
    const header = workflowAdapter.formatCallHeader({ script: SCRIPT }, theme, detailsWithAgents(), true);
    expect(header).toContain("1/3 agents");
  });

  it("falls back to the first script line when meta is invalid", () => {
    const header = workflowAdapter.formatCallHeader({ script: "// nightly run\nconst x = 1;" }, theme);
    expect(header).toContain("nightly run");
  });
});

describe("workflowAdapter.formatCollapsedContent", () => {
  it("shows live agent rows while running", () => {
    const lines = workflowAdapter.formatCollapsedContent(
      { script: SCRIPT },
      "",
      theme,
      100,
      detailsWithAgents(),
      true,
      0,
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("✓ #1 one");
    expect(lines[0]).toContain("3 tools");
    expect(lines[2]).toContain("◌ #3 three");
    expect(lines.join("")).not.toContain("├");
    expect(lines.join("")).not.toContain("└");
  });

  it("shows error details on failed agents when no output exists", () => {
    const lines = workflowAdapter.formatCollapsedContent(
      { script: SCRIPT },
      "",
      theme,
      100,
      { ok: false, workflow: { agents: [{ id: 1, label: "bad", status: "error", toolCalls: 2, detail: "boom" }] } },
      false,
    );
    expect(lines[0]).toContain("✗ #1 bad");
    expect(lines[0]).toContain("boom");
  });

  it("shows a truncated summary preview once finished", () => {
    const output = "line1\nline2\nline3";
    const lines = workflowAdapter.formatCollapsedContent({ script: SCRIPT }, output, theme, 100, undefined, false);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("line1");
    expect(lines[2]).toContain("line3");
  });

  it("hints at hidden summary lines beyond the preview", () => {
    const output = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join("\n");
    const lines = workflowAdapter.formatCollapsedContent({ script: SCRIPT }, output, theme, 100, undefined, false);
    expect(lines.some((l) => l.includes("more lines"))).toBe(true);
    expect(lines.some((l) => l.includes("line100"))).toBe(true);
    expect(lines.some((l) => l.includes("line1 "))).toBe(false);
  });
});

describe("workflowAdapter.formatExpandedContent", () => {
  it("renders the full script with line numbers", () => {
    const lines = workflowAdapter.formatExpandedContent({ script: SCRIPT }, "", theme, 100).map(stripAnsi);
    expect(lines.some((l) => l.includes("export const meta"))).toBe(true);
    expect(lines.some((l) => l.includes('phase("collect")'))).toBe(true);
    expect(lines.some((l) => l.includes("return a;"))).toBe(true);
    expect(lines[0]).toMatch(/1 │/);
  });

  it("appends the output section after the script", () => {
    const lines = workflowAdapter.formatExpandedContent({ script: SCRIPT }, '{"ok":true}', theme, 100);
    const sep = lines.findIndex((l) => l.includes("── output ──"));
    expect(sep).toBeGreaterThan(0);
    expect(lines[sep + 1]).toContain('{"ok":true}');
  });
});
