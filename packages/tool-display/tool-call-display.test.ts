import { describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderToolCall } from "./tool-call-display.ts";
import { globalToolDisplayRegistry } from "./registry.ts";
import { editAdapter } from "./adapters/edit.ts";
import { writeAdapter } from "./adapters/write.ts";
import { todoAdapter } from "./adapters/todo.ts";

const PLAIN_THEME: Theme = {
  fg: (_c: string, text: string) => text,
  bg: (_c: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function renderCollapsed(
  toolName: string,
  args: Record<string, unknown>,
  output: string,
  isError: boolean,
): string[] {
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
    expect(joined).not.toContain("diff");
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
});

describe("todo adapter collapsed-content width safety", () => {
  it("truncates long create output to fit a narrow terminal", () => {
    globalToolDisplayRegistry.register("todo", todoAdapter);
    const result = renderToolCall(
      {
        toolName: "todo",
        args: {
          action: "create",
          subject:
            "Fix todo adapter collapsed-content overflow crash in narrow terminals",
        },
        output:
          "Created #1: Fix todo adapter collapsed-content overflow crash in narrow terminals (pending)",
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
