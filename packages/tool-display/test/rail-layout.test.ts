import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { bashAdapter } from "../src/adapters/bash.ts";
import { readAdapter } from "../src/adapters/read.ts";
import { subagentAdapter } from "../src/adapters/subagent.ts";
import { workflowAdapter } from "../src/adapters/workflow.ts";
import { globalToolDisplayRegistry } from "../src/registry.ts";
import { renderToolCall } from "../src/tool-call-display.ts";

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

globalToolDisplayRegistry.register("read", readAdapter);
globalToolDisplayRegistry.register("bash", bashAdapter);
globalToolDisplayRegistry.register("subagent", subagentAdapter);
globalToolDisplayRegistry.register("workflow", workflowAdapter);

interface RenderOpts {
  output?: string;
  details?: unknown;
  expanded?: boolean;
  isPartial?: boolean;
  isError?: boolean;
  startedAtMs?: number;
  endedAtMs?: number;
  hoverAffordance?: boolean;
  width?: number;
}

function render(toolName: string, args: Record<string, unknown>, opts: RenderOpts = {}): string[] {
  return renderToolCall(
    {
      toolName,
      args,
      output: opts.output,
      details: opts.details,
      expanded: opts.expanded ?? false,
      isPartial: opts.isPartial ?? false,
      isError: opts.isError ?? false,
      registry: globalToolDisplayRegistry,
      startedAtMs: opts.startedAtMs,
      endedAtMs: opts.endedAtMs,
      hoverAffordance: opts.hoverAffordance,
    },
    PLAIN_THEME,
  ).render(opts.width ?? 80);
}

const SUBAGENT_TASKS = {
  tasks: [
    { agent_type: "general-purpose", description: "Standards review" },
    { agent_type: "general-purpose", description: "Spec review" },
  ],
};

const SUBAGENT_DETAILS = {
  per_task_started: [true, false],
  per_task_done: [false, false],
  per_task_tool_calls: [2, 0],
};

const WORKFLOW_SCRIPT = 'export const meta = { name: "audit", description: "d" };';
const WORKFLOW_DETAILS = {
  workflow: { agents: [{ id: 1, label: "one", status: "running", toolCalls: 2 }] },
};

describe("tool call rail column layout", () => {
  it("renders a single-line tool call with a run rail, bullet at column 5, body at column 7", () => {
    const lines = render("bash", { command: "echo hi" }, { output: "hi" });
    expect(lines).toEqual(["  ┃  ◆ Ran echo hi · 1 line"]);
  });

  it("renders multi-line blocks with a run rail on every row and the bullet only on the first", () => {
    const lines = render("read", { path: "foo.txt" }, { output: "a\nb\nc" });
    expect(lines).toEqual(["  ┃  ◆ Read foo.txt", "  ┃    └ 3 lines"]);
  });

  it("renders subagent task rows as plain rail continuation rows aligned to the body column", () => {
    const lines = render("subagent", SUBAGENT_TASKS, { isPartial: true, details: SUBAGENT_DETAILS });
    expect(lines.length).toBe(3);
    expect(lines[0]?.slice(0, 5)).toBe("  ┃  ");
    expect((lines[0]?.[5] ?? "").trim().length).toBeGreaterThan(0);
    for (const line of lines.slice(1)) {
      expect(line.startsWith("  ┃    ")).toBe(true);
      expect(line).not.toContain("├");
      expect(line).not.toContain("└");
    }
  });

  it("renders workflow agent rows as plain rail continuation rows", () => {
    const lines = render("workflow", { script: WORKFLOW_SCRIPT }, { isPartial: true, details: WORKFLOW_DETAILS });
    expect(lines.length).toBe(2);
    expect(lines[1]?.startsWith("  ┃    ")).toBe(true);
    expect(lines[1]).not.toContain("├");
    expect(lines[1]).not.toContain("└");
  });

  it("emits no legacy continuation prefix or four-space indent anywhere", () => {
    const cases: string[][] = [
      render("read", { path: "foo.txt" }, { output: "a\nb" }),
      render("subagent", SUBAGENT_TASKS, { isPartial: true, details: SUBAGENT_DETAILS }),
      render("workflow", { script: WORKFLOW_SCRIPT }, { isPartial: true, details: WORKFLOW_DETAILS }),
    ];
    for (const lines of cases) {
      for (const line of lines) {
        expect(line).not.toContain("│   ");
        expect(line.startsWith("    ")).toBe(false);
      }
    }
  });

  it("keeps the timer as the leading segment of the first body line", () => {
    const lines = render("bash", { command: "echo hi" }, { output: "hi", startedAtMs: 1000, endedAtMs: 1500 });
    expect(lines[0]).toBe("  ┃  ◆ 500 ms Ran echo hi · 1 line");
  });

  it("replaces the bullet diamond with › when hover affordance is on", () => {
    const lines = render("bash", { command: "echo hi" }, { output: "hi", hoverAffordance: true });
    expect(lines).toEqual(["  ┃  › Ran echo hi · 1 line"]);
  });
});

describe("narrow terminals", () => {
  it.each([
    ["subagent", 7],
    ["workflow", 7],
  ] as const)("never overflows for %s at and below the prefix width", (toolName, width) => {
    const args = toolName === "subagent" ? SUBAGENT_TASKS : { script: WORKFLOW_SCRIPT };
    const details = toolName === "subagent" ? SUBAGENT_DETAILS : WORKFLOW_DETAILS;
    for (const w of [width, 6, 1, 0]) {
      const lines = renderToolCall(
        {
          toolName,
          args,
          details,
          expanded: false,
          isPartial: true,
          isError: false,
          registry: globalToolDisplayRegistry,
        },
        PLAIN_THEME,
      ).render(w);
      for (const line of lines) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(w);
      }
    }
  });
});
