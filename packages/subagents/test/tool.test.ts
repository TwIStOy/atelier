import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { registerSubagentStatusTool, registerSubagentTool } from "../src/tool.ts";

function captureTool(): ToolDefinition {
  let captured: ToolDefinition | undefined;
  const pi = {
    registerTool(definition: ToolDefinition) {
      captured = definition;
    },
  } as unknown as ExtensionAPI;
  registerSubagentTool(pi);
  if (!captured) throw new Error("tool was not registered");
  return captured;
}

const context = {
  cwd: process.cwd(),
  sessionManager: {
    getHeader: () => ({ id: "parent-session" }),
    getSessionFile: () => "/tmp/parent-session.jsonl",
  },
} as never;

describe("subagent input validation", () => {
  it("throws when task and tasks are both provided", async () => {
    const tool = captureTool();

    await expect(
      tool.execute(
        "call_invalid_shape",
        {
          task: "single task",
          tasks: [{ task: "batch task", description: "Batch task" }],
        },
        undefined,
        undefined,
        context,
      ),
    ).rejects.toThrow("subagent: pass either `task` or `tasks`, not both.");
  });
});

describe("subagent_status structured content", () => {
  it("mirrors the status payload for programmatic callers", async () => {
    let captured: ToolDefinition | undefined;
    const pi = {
      registerTool(definition: ToolDefinition) {
        captured = definition;
      },
    } as unknown as ExtensionAPI;
    registerSubagentStatusTool(pi);
    if (!captured) throw new Error("status tool was not registered");

    const result = await captured.execute("call_status", { id: "nope" }, undefined, undefined, context);
    expect(result.structuredContent).toEqual({
      status: "unknown",
      id: "nope",
      message: "No background subagent with this id (wrong id or pruned after many newer jobs).",
    });
  });
});
