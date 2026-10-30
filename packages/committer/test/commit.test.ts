import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { executeSideCall } from "@htwang-contrib/common";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { handleCommit } from "../src/commit.ts";
import { showCommitterOverlay } from "../src/widget.ts";

vi.mock("@htwang-contrib/common", () => ({ executeSideCall: vi.fn() }));

vi.mock("../src/model-select.ts", () => ({
  loadConfig: () => ({
    model: "",
    groupingThreshold: 1,
    maxDiffLength: 12_000,
    maxDiffLengthSingle: 8_000,
    maxGroupingRetries: 0,
  }),
  resolveCommitModel: () => ({ provider: "test", id: "test" }),
}));

vi.mock("../src/widget.ts", () => ({
  showCommitterOverlay: vi.fn(async () => ({
    overlayPromise: Promise.resolve(),
    ctrl: { invalidate: vi.fn() },
  })),
}));

const exec = promisify(execFile);
let cwd: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd });
  return stdout;
}

function respond(answer: string): void {
  vi.mocked(executeSideCall).mockResolvedValue({
    ok: true,
    answer,
    stopReason: "stop",
    assistantMessage: {
      role: "assistant",
      content: [{ type: "text", text: answer }],
      api: "openai-completions",
      provider: "test",
      model: "test",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 0,
    },
  });
}

async function runCommit(args = ""): Promise<void> {
  const ctx = { cwd, hasUI: true } as ExtensionCommandContext;
  await handleCommit(args, ctx);
  const progress = vi.mocked(showCommitterOverlay).mock.calls[0]![1];
  expect(progress.errorMessage).toBeUndefined();
  expect(progress.phase).toBe("done");
}

beforeEach(async () => {
  vi.clearAllMocks();
  cwd = await mkdtemp(join(tmpdir(), "committer-test-"));
  await git("init", "--quiet");
  await git("config", "user.name", "Committer Test");
  await git("config", "user.email", "committer@example.com");
  await git("config", "commit.gpgsign", "false");
  await git("config", "core.hooksPath", join(cwd, "no-hooks"));
  await git("config", "diff.renames", "true");
  await writeFile(join(cwd, "old.txt"), "tracked content\n");
  await git("add", "--", "old.txt");
  await git("commit", "--quiet", "-m", "test: seed repository");
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("/commit deletions", () => {
  test.each(["", "--single"])("commits a deleted file with args %j", async (args) => {
    await rm(join(cwd, "old.txt"));
    const message = "refactor: remove old file";
    respond(args ? message : JSON.stringify([{ files: ["old.txt"], message }]));

    await runCommit(args);

    expect(await git("status", "--porcelain")).toBe("");
    expect(await git("ls-tree", "--name-only", "HEAD")).toBe("");
  });

  test.each(["true", "false"])("commits the deleted source with diff.renames=%s in grouped mode", async (renames) => {
    await git("config", "diff.renames", renames);
    await rm(join(cwd, "old.txt"));
    await writeFile(join(cwd, "new.txt"), "tracked content\n");
    respond(JSON.stringify([{ files: ["old.txt", "new.txt"], message: "refactor: rename old file" }]));

    await runCommit();

    expect(await git("status", "--porcelain")).toBe("");
    expect(await git("ls-tree", "--name-only", "HEAD")).toBe("new.txt\n");
  });

  test.each(["old file.txt", "旧文件.txt", 'old "file".txt', "old\nfile.txt"])(
    "commits a deleted path without Git quoting: %j",
    async (file) => {
      await git("mv", "--", "old.txt", file);
      await git("commit", "--quiet", "-m", "test: seed special filename");
      await rm(join(cwd, file));
      respond(JSON.stringify([{ files: [file], message: "refactor: remove old file" }]));

      await runCommit();

      expect(await git("status", "--porcelain")).toBe("");
      expect(await git("ls-tree", "--name-only", "HEAD")).toBe("");
      expect(await git("log", "-1", "--format=%s")).toBe("refactor: remove old file\n");
    },
  );

  test("commits deletions across separate groups", async () => {
    await rm(join(cwd, "old.txt"));
    await writeFile(join(cwd, "new.txt"), "tracked content\n");
    respond(
      JSON.stringify([
        { files: ["new.txt"], message: "refactor: add replacement file" },
        { files: ["old.txt"], message: "refactor: remove old file" },
      ]),
    );

    await runCommit();

    expect(await git("status", "--porcelain")).toBe("");
    expect(await git("ls-tree", "--name-only", "HEAD")).toBe("new.txt\n");
    expect(await git("log", "-2", "--format=%s")).toBe("refactor: remove old file\nrefactor: add replacement file\n");
  });
});
