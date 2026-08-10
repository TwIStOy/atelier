import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { bashAdapter } from "../src/adapters/bash.ts";
import { editAdapter } from "../src/adapters/edit.ts";
import { subagentAdapter } from "../src/adapters/subagent.ts";
import { todoAdapter } from "../src/adapters/todo.ts";
import { writeAdapter } from "../src/adapters/write.ts";
import { globalToolDisplayRegistry } from "../src/registry.ts";
import { renderToolCall } from "../src/tool-call-display.ts";

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function renderCollapsed(toolName: string, args: Record<string, unknown>, output: string, isError: boolean): string[] {
  return renderToolCall(
    {
      toolName,
      args,
      output,
      expanded: false,
      isPartial: false,
      isError,
      registry: globalToolDisplayRegistry,
    },
    PLAIN_THEME,
  ).render(80);
}

describe("renderToolCall collapsed error reason", () => {
  it("shows block reason after the edit bar when collapsed and errored", () => {
    globalToolDisplayRegistry.register("edit", editAdapter);
    const lines = renderCollapsed(
      "edit",
      { path: "src/foo.ts", edits: [{ oldText: "a", newText: "b" }] },
      "Read the file before editing it. (run /read-tracker to see tracked files)",
      true,
    );
    const joined = lines.join("\n");
    expect(joined).toContain("Edit");
    expect(joined).toContain("src/foo.ts");
    expect(joined).toContain("Read the file before editing");
    expect(joined).toContain("diff");
    expect(joined.indexOf("Read the file before editing")).toBeLessThan(joined.indexOf("diff"));
  });

  it("shows block reason for write when collapsed and errored", () => {
    globalToolDisplayRegistry.register("write", writeAdapter);
    const lines = renderCollapsed(
      "write",
      { path: "src/bar.ts", content: "x" },
      "File has been modified since you read it. Re-read before editing.",
      true,
    );
    const joined = lines.join("\n");
    expect(joined).toContain("Write");
    expect(joined).toContain("File has been modified since you read it");
  });

  it("does not show a reason line when not errored (normal expanded edit)", () => {
    globalToolDisplayRegistry.register("edit", editAdapter);
    const lines = renderToolCall(
      {
        toolName: "edit",
        args: { path: "src/foo.ts", edits: [{ oldText: "a", newText: "b" }] },
        output: "",
        expanded: true,
        isPartial: false,
        isError: false,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(80);
    const joined = lines.join("\n");
    expect(joined).not.toContain("Read the file before editing");
  });

  it("shows the reason when errored and expanded (no diff)", () => {
    globalToolDisplayRegistry.register("edit", editAdapter);
    const lines = renderToolCall(
      {
        toolName: "edit",
        args: { path: "src/foo.ts", edits: [{ oldText: "a", newText: "b" }] },
        output: "Read the file before editing it.",
        expanded: true,
        isPartial: false,
        isError: true,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(80);
    const joined = lines.join("\n");
    expect(joined).toContain("Read the file before editing it.");
  });

  it("renders the error icon only on the first line when expanded and wrapped", () => {
    globalToolDisplayRegistry.register("bash", bashAdapter);
    const reason =
      "Command timed out after 40 seconds while pinging the NAS host which is a very long reason that must wrap";
    const lines = renderToolCall(
      {
        toolName: "bash",
        args: { command: "tailscale ping 100.65.0.6" },
        output: reason,
        expanded: true,
        isPartial: false,
        isError: true,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(40);
    const body = lines.slice(1);
    const iconCount = body.filter((l) => l.includes("\ue654")).length;
    expect(iconCount).toBe(1);
    expect(body[0].includes("\ue654")).toBe(true);
  });
});

describe("todo adapter collapsed-content width safety", () => {
  it("truncates long create output to fit a narrow terminal", () => {
    globalToolDisplayRegistry.register("todo", todoAdapter);
    const result = renderToolCall(
      {
        toolName: "todo",
        args: {
          action: "create",
          subject: "Fix todo adapter collapsed-content overflow crash in narrow terminals",
        },
        output: "Created #1: Fix todo adapter collapsed-content overflow crash in narrow terminals (pending)",
        expanded: false,
        isPartial: false,
        isError: false,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    );
    const lines = result.render(45);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(45);
    }
  });
});

describe("bash adapter command display width", () => {
  const LONG_CMD =
    "nix build .#default --print-build-logs --fallback --extra-experimental-features 'nix-command flakes ca-derivations' --cores 8 --max-jobs 4";

  it("wraps the command onto continuation lines on a narrow terminal instead of truncating", () => {
    globalToolDisplayRegistry.register("bash", bashAdapter);
    const lines = renderToolCall(
      {
        toolName: "bash",
        args: { command: LONG_CMD },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(40);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
    const joined = lines.join(" ");
    expect(joined).not.toContain("…");
    expect(joined.replaceAll("│", "").replace(/\s+/g, " ")).toContain(LONG_CMD);
  });

  it("produces multiple header lines when the command is wider than the terminal", () => {
    globalToolDisplayRegistry.register("bash", bashAdapter);
    const lines = renderToolCall(
      {
        toolName: "bash",
        args: { command: LONG_CMD },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(40);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain("Bash");
  });

  it("prefixes continuation lines of a multi-line command with a tree bar", () => {
    globalToolDisplayRegistry.register("bash", bashAdapter);
    const lines = renderToolCall(
      {
        toolName: "bash",
        args: { command: 'set -e\nfor slug in a b; do\n  echo "$slug"\ndone' },
        output: "ok",
        expanded: false,
        isPartial: false,
        isError: false,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(80);
    expect(lines[0]).toContain("Bash set -e");
    expect(lines[1]).toBe("│   for slug in a b; do");
    expect(lines[2]).toBe('│     echo "$slug"');
    expect(lines[3]).toBe("│   done");
  });

  it("fits on one line with no ellipsis on a wide terminal", () => {
    globalToolDisplayRegistry.register("bash", bashAdapter);
    const width = 200;
    const lines = renderToolCall(
      {
        toolName: "bash",
        args: { command: LONG_CMD },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(width);
    const joined = lines.join(" ");
    expect(joined).not.toContain("…");
    expect(joined).toContain(LONG_CMD);
  });

  it("keeps the description and cwd suffix visible when the command wraps", () => {
    globalToolDisplayRegistry.register("bash", bashAdapter);
    const width = 80;
    const lines = renderToolCall(
      {
        toolName: "bash",
        args: { command: LONG_CMD, description: "build the package", workdir: "/r" },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(width);
    const joined = lines.join(" ");
    expect(joined).toContain("in /r");
    expect(joined).toContain("build the package");
    expect(joined).not.toContain("…");
    expect(joined.replaceAll("│", "").replace(/\s+/g, " ")).toContain(LONG_CMD);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("wraps the command within the available width and never overflows the line", () => {
    const header = bashAdapter.formatCallHeader(
      { command: LONG_CMD, description: "build", workdir: "/r" },
      PLAIN_THEME,
      undefined,
      false,
      false,
      60,
    );
    expect(header).toContain("in /r");
    expect(header).not.toContain("…");
    for (const line of header.split("\n")) {
      expect(visibleWidth(`◆ ${line}`)).toBeLessThanOrEqual(60);
    }
  });
});

describe("multi-line headers of other tools", () => {
  it("prefixes wrapped generic-tool args with a tree bar", () => {
    const lines = renderToolCall(
      {
        toolName: "some_unknown_tool",
        args: { path: "a/very/long/path/that/keeps/going/and/going/to/force/wrapping.json", filter: "x" },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(40);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(1)) {
      expect(line.startsWith("│   ")).toBe(true);
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
  });

  it("prefixes a wrapped todo subject with a tree bar", () => {
    globalToolDisplayRegistry.register("todo", todoAdapter);
    const lines = renderToolCall(
      {
        toolName: "todo",
        args: { action: "create", subject: "Fix todo adapter collapsed-content overflow crash in narrow terminals" },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(40);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain("Todo create");
    for (const line of lines.slice(1)) {
      expect(line.startsWith("│   ")).toBe(true);
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
  });
});

describe("tool call timer", () => {
  it("renders the elapsed-time label between the status icon and tool name", () => {
    const lines = renderToolCall(
      {
        toolName: "read",
        args: { path: "foo.txt" },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        registry: globalToolDisplayRegistry,
        startedAtMs: 1000,
        endedAtMs: 1500,
      },
      PLAIN_THEME,
    ).render(80);
    const first = lines[0] ?? "";
    expect(first).toContain("500 ms");
    expect(first.indexOf("500 ms")).toBeLessThan(first.indexOf("Read"));
  });

  it("keeps the timer on the first line and never overflows narrow terminals", () => {
    globalToolDisplayRegistry.register("bash", bashAdapter);
    const lines = renderToolCall(
      {
        toolName: "bash",
        args: { command: "echo hello world this is a long enough command to wrap" },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        registry: globalToolDisplayRegistry,
        startedAtMs: 0,
        endedAtMs: 2500,
      },
      PLAIN_THEME,
    ).render(40);
    const joined = lines.join("\n");
    expect(lines[0]).toContain("2500 ms");
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
    expect(joined).toContain("Bash");
  });

  it("freezes the timer at the final elapsed time once the tool completes", () => {
    const lines = renderToolCall(
      {
        toolName: "read",
        args: { path: "foo.txt" },
        output: "done",
        expanded: false,
        isPartial: false,
        isError: false,
        registry: globalToolDisplayRegistry,
        startedAtMs: 1000,
        endedAtMs: 5200,
      },
      PLAIN_THEME,
    ).render(80);
    expect(lines[0]).toContain("4.20s");
  });

  it("omits the timer when no timing is provided", () => {
    const lines = renderToolCall(
      {
        toolName: "read",
        args: { path: "foo.txt" },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(80);
    expect(lines[0]).not.toContain(" ms");
    expect(lines[0]).not.toMatch(/\d+s\b/);
  });
});

describe("subagent adapter respects terminal width", () => {
  it("truncates per-task rows so no line exceeds a narrow terminal width", () => {
    globalToolDisplayRegistry.register("subagent", subagentAdapter);
    const lines = renderToolCall(
      {
        toolName: "subagent",
        args: {
          tasks: [
            { agent_type: "general-purpose", description: "Standards review of #79 diff" },
            { agent_type: "general-purpose", description: "Spec review of #79 diff" },
          ],
        },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        details: {
          per_task_started: [false, false],
          per_task_done: [false, false],
          per_task_tool_calls: [0, 0],
        },
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(50);

    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(50);
    }
    const joined = lines.join("\n");
    expect(joined).toContain("calls");
    expect(joined).toContain("tools");
  });

  it("truncates batch rows so no line exceeds a narrow terminal width", () => {
    globalToolDisplayRegistry.register("subagent", subagentAdapter);
    const lines = renderToolCall(
      {
        toolName: "subagent",
        args: {
          tasks: [
            { agent_type: "general-purpose", description: "Standards review of #79 diff" },
            { agent_type: "general-purpose", description: "Spec review of #79 diff" },
          ],
        },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        details: {
          mode: "batch",
          batch: [
            { index: 0, tool_calls: 0, agent_type: "general-purpose", description: "Standards review of #79 diff" },
            { index: 1, tool_calls: 0, agent_type: "general-purpose", description: "Spec review of #79 diff" },
          ],
        },
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(40);

    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
  });

  it("never overflows even on a very narrow terminal", () => {
    globalToolDisplayRegistry.register("subagent", subagentAdapter);
    const lines = renderToolCall(
      {
        toolName: "subagent",
        args: {
          tasks: [
            { agent_type: "general-purpose", description: "Standards review of #79 diff" },
            { agent_type: "general-purpose", description: "Spec review of #79 diff" },
          ],
        },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        details: {
          per_task_started: [false, false],
          per_task_done: [false, false],
          per_task_tool_calls: [0, 0],
        },
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(20);

    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(20);
    }
  });

  it("keeps full descriptions when the terminal is wide enough", () => {
    globalToolDisplayRegistry.register("subagent", subagentAdapter);
    const lines = renderToolCall(
      {
        toolName: "subagent",
        args: {
          tasks: [
            { agent_type: "general-purpose", description: "Short desc one" },
            { agent_type: "general-purpose", description: "Short desc two" },
          ],
        },
        output: "",
        expanded: false,
        isPartial: true,
        isError: false,
        details: {
          per_task_started: [false, false],
          per_task_done: [false, false],
          per_task_tool_calls: [0, 0],
        },
        registry: globalToolDisplayRegistry,
      },
      PLAIN_THEME,
    ).render(120);

    const joined = lines.join("\n");
    expect(joined).toContain("Short desc one");
    expect(joined).toContain("Short desc two");
  });
});
