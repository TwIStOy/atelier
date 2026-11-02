import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { registerWorkflowTool } from "../src/tool.ts";

type ParameterDefinition = {
  description?: string;
};

type WorkflowToolDefinition = {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  promptGuidelines: string[];
  parameters: {
    properties?: Record<string, ParameterDefinition>;
  };
};

function registeredWorkflowTool(): WorkflowToolDefinition {
  let registered: unknown;
  const pi = {
    registerTool(tool: unknown) {
      registered = tool;
    },
  } as unknown as ExtensionAPI;

  registerWorkflowTool(pi);
  if (!registered) throw new Error("workflow tool was not registered");
  return registered as WorkflowToolDefinition;
}

describe("registerWorkflowTool", () => {
  it("requires explicit opt-in and distinguishes workflow from adaptive delegation", () => {
    const tool = registeredWorkflowTool();
    const guidelines = tool.promptGuidelines.join("\n");

    expect(tool.name).toBe("workflow");
    expect(tool.label).toBe("Workflow");
    expect(tool.description).toContain("Use only when the user explicitly requests");
    expect(tool.promptSnippet).toContain("explicitly opted-in");
    expect(tool.promptGuidelines.every((guideline) => guideline.toLowerCase().includes("workflow"))).toBe(true);
    expect(guidelines).toContain("Do not invoke `workflow` solely because parallelism might help");
    expect(guidelines).toContain("bounded discovery");
    expect(guidelines).toContain("adaptive delegation");
  });

  it("keeps only invocation policy in the prompt and moves DSL mechanics into the workflow-dsl skill", () => {
    const guidelines = registeredWorkflowTool().promptGuidelines.join("\n");
    const skill = readFileSync(new URL("../../../skills/workflow-dsl/SKILL.md", import.meta.url), "utf8");

    expect(guidelines).toContain("workflow-dsl");
    expect(guidelines).not.toContain("JavaScript, not TypeScript");
    expect(guidelines).not.toContain("`parallel([...])` is a barrier");

    expect(skill).toContain("JavaScript, not TypeScript");
    expect(skill).toContain("literal values only");
    expect(skill).toContain("`parallel([...])` is a barrier");
    expect(skill).toContain("returns results in input order");
    expect(skill).toContain("runs stages sequentially");
    expect(skill).toContain("pipeline inside each parallel branch");
    expect(skill).toContain("resolves to `null`");
    expect(skill).toContain("sampling, top-N cutoffs, skipped items");
    expect(skill).toContain("4 concurrent and 32 total");
  });

  it("describes structured args, resume, and save parameters", () => {
    const tool = registeredWorkflowTool();
    const properties = tool.parameters.properties;
    if (!properties) throw new Error("workflow parameter properties are missing");

    expect(properties.script?.description).toContain("JavaScript workflow script (not TypeScript)");
    expect(properties.args?.description).toContain("Pass objects and arrays directly");
    expect(properties.resume_run_id?.description).toContain("stored script and args are reused");
    expect(properties.save_as?.description).toContain("save this script as a reusable slash command");
    expect(properties.save_scope?.description).toContain("Default 'user'");
  });
});
