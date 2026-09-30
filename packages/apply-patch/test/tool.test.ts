import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { isOpenAIGptModel, registerApplyPatchExtension, syncToolset } from "../src/index.ts";
import { APPLY_PATCH_LARK_GRAMMAR } from "../src/patch.ts";
import type { ApplyPatchToolDetails } from "../src/preview.ts";
import { APPLY_PATCH_DESCRIPTION, createApplyPatchTool } from "../src/tool.ts";

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(process.cwd(), "test-temp-"));
  tempDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

const UPDATE_PATCH = `*** Begin Patch
*** Update File: sample.txt
@@
-before
+after
*** End Patch`;

describe("createApplyPatchTool", () => {
  it("exposes the codex grammar tool via constrainedSampling", () => {
    const tool = createApplyPatchTool();

    expect(tool.name).toBe("apply_patch");
    expect(tool.description).toBe(APPLY_PATCH_DESCRIPTION);
    expect(tool.constrainedSampling).toEqual({
      type: "grammar",
      variants: { openai_lark: APPLY_PATCH_LARK_GRAMMAR },
    });
    expect(tool.prepareArguments?.("raw patch text")).toEqual({ input: "raw patch text" });
    expect(tool.prepareArguments?.({ input: "wrapped" })).toEqual({ input: "wrapped" });
    expect(tool.promptSnippet).toBeTruthy();
    expect(tool.promptGuidelines).toBeTruthy();
  });

  it("requires input", async () => {
    const tool = createApplyPatchTool();
    await expect(
      tool.execute("id", { input: "" }, undefined, undefined, { cwd: "/tmp" } as ExtensionToolContext),
    ).rejects.toThrow("input is required");
  });

  it("emits pending updates with preview details before applying", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "sample.txt"), "before\n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: sample.txt
@@
-before
+after
*** Add File: created.txt
+created
*** End Patch`;
    const tool = createApplyPatchTool();
    const updates: Array<{ text: string; details: ApplyPatchToolDetails | undefined }> = [];

    await tool.execute(
      "apply-patch-test",
      { input: patch },
      undefined,
      (update) => {
        const firstText = update.content.find((block) => block.type === "text")?.text;
        updates.push({ text: firstText ?? "", details: update.details });
      },
      { cwd: directory } as ExtensionToolContext,
    );

    const first = updates[0];
    expect(first).toBeDefined();
    expect(first?.text).toContain("Applying patch (0/2)...");
    expect(first?.details?.progress).toEqual({ applied: 0, failed: 0, total: 2 });
    expect(first?.details?.preview?.files).toHaveLength(2);
    expect(first?.details?.preview?.added).toBe(2);
    expect(first?.details?.preview?.removed).toBe(1);
    const sampleDiff = first?.details?.preview?.files[0]?.diff ?? "";
    expect(sampleDiff).toContain("--- a/sample.txt");
    expect(sampleDiff).toContain("-before");
    expect(sampleDiff).toContain("+after");
    expect(await readFile(path.join(directory, "sample.txt"), "utf-8")).toBe("after\n");
    expect(await readFile(path.join(directory, "created.txt"), "utf-8")).toBe("created\n");
  });

  it("emits per-hunk progress updates", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "first.txt"), "one\n", "utf-8");
    await writeFile(path.join(directory, "second.txt"), "two\n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: first.txt
@@
-one
+ONE
*** Update File: second.txt
@@
-two
+TWO
*** End Patch`;
    const tool = createApplyPatchTool();
    const updates: ApplyPatchToolDetails[] = [];

    await tool.execute(
      "apply-patch-progress-test",
      { input: patch },
      undefined,
      (update) => {
        updates.push(update.details);
      },
      { cwd: directory } as ExtensionToolContext,
    );

    expect(updates).toHaveLength(3);
    expect(updates[0]?.progress).toEqual({ applied: 0, failed: 0, total: 2 });
    expect(updates[1]?.progress).toEqual({ applied: 1, failed: 0, total: 2 });
    expect(updates[2]?.progress).toEqual({ applied: 2, failed: 0, total: 2 });
  });

  it("returns summaries with result details on success", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "sample.txt"), "before\n", "utf-8");
    const tool = createApplyPatchTool();

    const result = await tool.execute("apply-patch-success-test", { input: UPDATE_PATCH }, undefined, undefined, {
      cwd: directory,
    } as ExtensionToolContext);

    expect(result.content.find((block) => block.type === "text")?.text).toBe("update: sample.txt");
    expect(result.details?.result?.appliedFiles).toEqual(["sample.txt"]);
    expect(result.details?.result?.failures).toEqual([]);
    expect(result.details?.preview?.files[0]?.operation).toBe("update");
  });

  it("returns recovery instructions on partial failure", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "ok.txt"), "before\n", "utf-8");
    await writeFile(path.join(directory, "broken.txt"), "line\n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: ok.txt
@@
-before
+after
*** Update File: broken.txt
@@
-missing
+changed
*** End Patch`;
    const tool = createApplyPatchTool();

    const result = await tool.execute("apply-patch-test", { input: patch }, undefined, undefined, {
      cwd: directory,
    } as ExtensionToolContext);

    const text = result.content.find((block) => block.type === "text")?.text ?? "";
    expect(text).toContain("apply_patch partially failed.");
    expect(text).toContain("- broken.txt (update):");
    expect(text).toContain("Recovery: MUST read broken.txt before retrying.");
    expect(text).toContain("Earlier file actions in this patch were already applied.");
    expect(result.details?.result?.hasPartialSuccess).toBe(true);
  });

  it("discloses ENOENT failures without reread advice", async () => {
    const directory = await createTempDirectory();
    const tool = createApplyPatchTool();

    const result = await tool.execute("apply-patch-enoent-test", { input: UPDATE_PATCH }, undefined, undefined, {
      cwd: directory,
    } as ExtensionToolContext);

    const text = result.content.find((block) => block.type === "text")?.text ?? "";
    expect(text).toContain("apply_patch failed.");
    expect(text).toContain("sample.txt");
    expect(text).toContain("ENOENT");
    expect(text).not.toContain("MUST read");
    expect(text).toContain("No file actions were applied.");
  });

  it("throws parse errors for empty patches", async () => {
    const directory = await createTempDirectory();
    const tool = createApplyPatchTool();
    const patch = `*** Begin Patch
*** End Patch`;

    await expect(
      tool.execute("apply-patch-empty-test", { input: patch }, undefined, undefined, {
        cwd: directory,
      } as ExtensionToolContext),
    ).rejects.toThrow("empty patch");
  });
});

describe("registerApplyPatchExtension", () => {
  type ToolsetModel = { provider: string; id: string; api?: string };

  function createHarness(initialActiveTools: string[]) {
    let active = [...initialActiveTools];
    const registeredTools: string[] = [];
    const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => Promise<void> | void>>();
    const pi = {
      registerTool(tool: { name: string }) {
        registeredTools.push(tool.name);
      },
      on(event: string, handler: (event: unknown, ctx: unknown) => Promise<void> | void) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      getActiveTools: () => [...active],
      setActiveTools: (names: string[]) => {
        active = [...names];
      },
    };

    const trigger = async (event: string, model: ToolsetModel | undefined) => {
      for (const handler of handlers.get(event) ?? []) {
        await handler(model !== undefined ? { model } : {}, { model });
      }
    };

    return { registeredTools, activeTools: () => [...active], trigger, pi };
  }

  const GPT: ToolsetModel = { provider: "openai", id: "gpt-5" };
  const CLAUDE: ToolsetModel = { provider: "anthropic", id: "claude-sonnet-4" };

  it("does not register the tool for non-GPT sessions", async () => {
    const h = createHarness(["read", "edit", "write"]);
    registerApplyPatchExtension(h.pi as never);

    await h.trigger("session_start", CLAUDE);
    await h.trigger("before_agent_start", CLAUDE);

    expect(h.registeredTools).toEqual([]);
    expect(h.activeTools()).toEqual(["read", "edit", "write"]);
  });

  it("registers the tool once when a GPT model becomes active", async () => {
    const h = createHarness(["read", "edit", "write"]);
    registerApplyPatchExtension(h.pi as never);

    await h.trigger("session_start", GPT);
    await h.trigger("before_agent_start", GPT);
    await h.trigger("model_select", GPT);

    expect(h.registeredTools).toEqual(["apply_patch"]);
    expect(h.activeTools()).toEqual(["read", "apply_patch"]);
  });

  it("registers on model switch from non-GPT to GPT", async () => {
    const h = createHarness(["read", "edit", "write"]);
    registerApplyPatchExtension(h.pi as never);

    await h.trigger("session_start", CLAUDE);
    expect(h.registeredTools).toEqual([]);

    await h.trigger("model_select", GPT);
    expect(h.registeredTools).toEqual(["apply_patch"]);
    expect(h.activeTools()).toEqual(["read", "apply_patch"]);
  });

  it("keeps the registration but restores edit tools when switching away from GPT", async () => {
    const h = createHarness(["read", "edit", "write"]);
    registerApplyPatchExtension(h.pi as never);

    await h.trigger("session_start", GPT);
    await h.trigger("model_select", CLAUDE);

    expect(h.registeredTools).toEqual(["apply_patch"]);
    expect(h.activeTools()).toEqual(["read", "edit", "write"]);
  });
});

describe("syncToolset", () => {
  function createHarness(initial: string[]) {
    let active = [...initial];
    const calls: string[][] = [];
    return {
      get activeTools() {
        return active;
      },
      calls,
      pi: {
        getActiveTools: () => [...active],
        setActiveTools: (names: string[]) => {
          active = [...names];
          calls.push([...names]);
        },
      },
    };
  }

  it("replaces edit tools with apply_patch for GPT models", () => {
    const h = createHarness(["read", "bash", "edit", "write"]);
    syncToolset(h.pi, { provider: "openai", id: "gpt-5" } as never);
    expect(h.activeTools).toEqual(["read", "bash", "apply_patch"]);
  });

  it("keeps apply_patch active when already swapped", () => {
    const h = createHarness(["read", "bash", "apply_patch"]);
    syncToolset(h.pi, { provider: "openai", id: "gpt-5" } as never);
    expect(h.activeTools).toEqual(["read", "bash", "apply_patch"]);
  });

  it("normalizes stale edit tools in GPT mode", () => {
    const h = createHarness(["read", "apply_patch", "edit", "write"]);
    syncToolset(h.pi, { provider: "openai", id: "gpt-5" } as never);
    expect(h.activeTools).toEqual(["read", "apply_patch"]);
  });

  it("restores edit tools for non-GPT models", () => {
    const h = createHarness(["read", "apply_patch"]);
    syncToolset(h.pi, { provider: "anthropic", id: "claude-sonnet-4" } as never);
    expect(h.activeTools).toEqual(["read", "edit", "write"]);
  });

  it("activates for custom Responses providers with gpt ids", () => {
    const h = createHarness(["read", "edit", "write"]);
    syncToolset(h.pi, { provider: "my-proxy", id: "gpt-5", api: "openai-responses" } as never);
    expect(h.activeTools).toEqual(["read", "apply_patch"]);
  });
});

describe("isOpenAIGptModel", () => {
  it("matches known providers and Responses APIs", () => {
    expect(isOpenAIGptModel({ provider: "openai", id: "gpt-5" })).toBe(true);
    expect(isOpenAIGptModel({ provider: "openai-codex", id: "gpt-5.5" })).toBe(true);
    expect(isOpenAIGptModel({ provider: "my-proxy", id: "gpt-5", api: "openai-responses" })).toBe(true);
    expect(isOpenAIGptModel({ provider: "codex-proxy", id: "gpt-5", api: "openai-codex-responses" })).toBe(true);
    expect(isOpenAIGptModel({ provider: "openai", id: "o1" })).toBe(false);
    expect(isOpenAIGptModel({ provider: "anthropic", id: "gpt-5" })).toBe(false);
    expect(isOpenAIGptModel({ provider: "my-proxy", id: "claude-sonnet", api: "openai-responses" })).toBe(false);
    expect(isOpenAIGptModel({ provider: "anthropic-proxy", id: "gpt-5", api: "anthropic-messages" })).toBe(false);
    expect(isOpenAIGptModel(undefined)).toBe(false);
  });
});
