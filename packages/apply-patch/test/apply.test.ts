import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ApplyPatchError,
  applyPatch,
  applyPatchDetailed,
  PatchApplicationError,
  resolvePatchPath,
  writeFileAtomic,
} from "../src/apply.ts";
import { replaceChunks } from "../src/patch.ts";

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

describe("applyPatch", () => {
  it("applies file updates", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "sample.txt"), "before\n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: sample.txt
@@
-before
+after
*** End Patch`;

    await applyPatch(directory, patch);

    expect(await readFile(path.join(directory, "sample.txt"), "utf-8")).toBe("after\n");
  });

  it("applies multi-operation patches", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "modify.txt"), "line1\nline2\n", "utf-8");
    await writeFile(path.join(directory, "delete.txt"), "obsolete\n", "utf-8");
    const patch = `*** Begin Patch
*** Add File: nested/new.txt
+created
*** Delete File: delete.txt
*** Update File: modify.txt
@@
-line2
+changed
*** End Patch`;

    const summaries = await applyPatch(directory, patch);

    expect(summaries).toEqual(["add: nested/new.txt", "delete: delete.txt", "update: modify.txt"]);
    expect(await readFile(path.join(directory, "nested", "new.txt"), "utf-8")).toBe("created\n");
    expect(await readFile(path.join(directory, "modify.txt"), "utf-8")).toBe("line1\nchanged\n");
    await expect(readFile(path.join(directory, "delete.txt"), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("applies contextual chunks in order", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "multi.txt"), "alpha\none\nbeta\ntwo\n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: multi.txt
@@ alpha
-one
+ONE
@@ beta
-two
+TWO
*** End Patch`;

    await applyPatch(directory, patch);

    expect(await readFile(path.join(directory, "multi.txt"), "utf-8")).toBe("alpha\nONE\nbeta\nTWO\n");
  });

  it("narrows stacked contexts before replacing", async () => {
    const directory = await createTempDirectory();
    await writeFile(
      path.join(directory, "stacked.txt"),
      "class Alpha {\n  method() {\n    x = 1\n  }\n}\nclass Beta {\n  method() {\n    x = 1\n  }\n}\n",
      "utf-8",
    );
    const patch = `*** Begin Patch
*** Update File: stacked.txt
@@ class Beta {
@@   method() {
-    x = 1
+    x = 2
*** End Patch`;

    await applyPatch(directory, patch);

    expect(await readFile(path.join(directory, "stacked.txt"), "utf-8")).toBe(
      "class Alpha {\n  method() {\n    x = 1\n  }\n}\nclass Beta {\n  method() {\n    x = 2\n  }\n}\n",
    );
  });

  it("only matches the file ending with end-of-file markers", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "eof.txt"), "target\nkeep\ntarget\n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: eof.txt
@@
-target
+done
*** End of File
*** End Patch`;

    await applyPatch(directory, patch);

    expect(await readFile(path.join(directory, "eof.txt"), "utf-8")).toBe("target\nkeep\ndone\n");
  });

  it("matches fuzzy context like codex", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "fuzzy.txt"), "name = “old”  \n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: fuzzy.txt
@@
-name = "old"
+name = "new"
*** End Patch`;

    await applyPatch(directory, patch);

    expect(await readFile(path.join(directory, "fuzzy.txt"), "utf-8")).toBe('name = "new"\n');
  });

  it("applies absolute workspace paths including moves", async () => {
    const directory = await createTempDirectory();
    const absoluteAddPath = path.join(directory, "absolute-add.txt");
    const absoluteDeletePath = path.join(directory, "absolute-delete.txt");
    const absoluteUpdatePath = path.join(directory, "absolute-update.txt");
    const absoluteMoveSourcePath = path.join(directory, "absolute-move-source.txt");
    const absoluteMoveDestinationPath = path.join(directory, "nested", "absolute-move-destination.txt");
    await writeFile(absoluteDeletePath, "delete me\n", "utf-8");
    await writeFile(absoluteUpdatePath, "before\n", "utf-8");
    await writeFile(absoluteMoveSourcePath, "move me\n", "utf-8");
    const patch = `*** Begin Patch
*** Add File: ${absoluteAddPath}
+created
*** Delete File: ${absoluteDeletePath}
*** Update File: ${absoluteUpdatePath}
@@
-before
+after
*** Update File: ${absoluteMoveSourcePath}
*** Move to: ${absoluteMoveDestinationPath}
@@
-move me
+moved
*** End Patch`;

    await applyPatch(directory, patch);

    expect(await readFile(absoluteAddPath, "utf-8")).toBe("created\n");
    await expect(readFile(absoluteDeletePath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(absoluteUpdatePath, "utf-8")).toBe("after\n");
    await expect(readFile(absoluteMoveSourcePath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(absoluteMoveDestinationPath, "utf-8")).toBe("moved\n");
  });

  it("moves files without changing content", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "old.txt"), "no trailing newline", "utf-8");
    const patch = `*** Begin Patch
*** Update File: old.txt
*** Move to: new.txt
*** End Patch`;

    await applyPatch(directory, patch);

    await expect(readFile(path.join(directory, "old.txt"), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(directory, "new.txt"), "utf-8")).toBe("no trailing newline");
  });

  it("applies parent-escaping and symlinked paths outside cwd", async () => {
    const directory = await createTempDirectory();
    const outsidePath = path.join(path.dirname(directory), `${path.basename(directory)}-outside.ts`);
    const linkedDirectory = await createTempDirectory();
    await symlink(linkedDirectory, path.join(directory, "link"), "dir");
    tempDirectories.push(outsidePath);
    const patch = `*** Begin Patch
*** Add File: ${path.relative(directory, outsidePath)}
+outside
*** Add File: link/outside.txt
+linked
*** End Patch`;

    await applyPatch(directory, patch);

    expect(await readFile(outsidePath, "utf-8")).toBe("outside\n");
    expect(await readFile(path.join(linkedDirectory, "outside.txt"), "utf-8")).toBe("linked\n");
  });

  it("reports context mismatches with expected lines", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "modify.txt"), "line1\nline2\n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: modify.txt
@@
-missing
+changed
*** End Patch`;

    await expect(applyPatch(directory, patch)).rejects.toThrow("Failed to find expected lines in modify.txt");
  });

  it("fails fast with a typed error carrying the partial result", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "broken.txt"), "line\n", "utf-8");
    await writeFile(path.join(directory, "later.txt"), "before\n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: broken.txt
@@
-missing
+changed
*** Update File: later.txt
@@
-before
+after
*** End Patch`;

    const error = await applyPatch(directory, patch).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApplyPatchError);
    const applyError = error as ApplyPatchError;
    expect(applyError.result.failures[0]?.filePath).toBe("broken.txt");
    expect(applyError.result.recoveryInstructions.mustReadFiles).toEqual(["broken.txt"]);
    expect(await readFile(path.join(directory, "later.txt"), "utf-8")).toBe("before\n");
  });
});

describe("applyPatchDetailed", () => {
  it("accumulates applied and failed files with recovery instructions", async () => {
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

    const result = await applyPatchDetailed(directory, patch);

    expect(result.appliedFiles).toEqual(["ok.txt"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.filePath).toBe("broken.txt");
    expect(result.hasPartialSuccess).toBe(true);
    expect(result.recoveryInstructions.mustReadFiles).toEqual(["broken.txt"]);
    expect(result.recoveryInstructions.mustNotReadFiles).toEqual(["ok.txt"]);
  });

  it("aggregates fuzz scores across hunks", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "trim-end.txt"), "keep trailing   \n", "utf-8");
    await writeFile(path.join(directory, "normalize.txt"), "name = “old”\n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: trim-end.txt
@@
-keep trailing
+keep trailing updated
*** Update File: normalize.txt
@@
-name = "old"
+name = "new"
*** End Patch`;

    const result = await applyPatchDetailed(directory, patch);

    expect(result.failures).toEqual([]);
    expect(result.details.fuzz).toBe(10001);
  });

  it("keeps applying when the progress callback throws", async () => {
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

    const result = await applyPatchDetailed(directory, patch, () => {
      throw new Error("render failed");
    });

    expect(result.failures).toEqual([]);
    expect(result.appliedFiles).toEqual(["first.txt", "second.txt"]);
  });

  it("preserves both sides of concurrent patches to one file", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "shared.txt"), "first\nsecond\n", "utf-8");
    const firstPatch = `*** Begin Patch
*** Update File: shared.txt
@@
-first
+FIRST
*** End Patch`;
    const secondPatch = `*** Begin Patch
*** Update File: shared.txt
@@
-second
+SECOND
*** End Patch`;

    await Promise.all([applyPatch(directory, firstPatch), applyPatch(directory, secondPatch)]);

    expect(await readFile(path.join(directory, "shared.txt"), "utf-8")).toBe("FIRST\nSECOND\n");
  });

  it("serializes concurrent update and move of one file", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "source.txt"), "first\nsecond\n", "utf-8");
    const updatePatch = `*** Begin Patch
*** Update File: source.txt
@@
-second
+SECOND
*** End Patch`;
    const movePatch = `*** Begin Patch
*** Update File: source.txt
*** Move to: destination.txt
@@
-first
+FIRST
*** End Patch`;

    const [updateResult, moveResult] = await Promise.all([
      applyPatchDetailed(directory, updatePatch),
      applyPatchDetailed(directory, movePatch),
    ]);

    const failureCount = updateResult.failures.length + moveResult.failures.length;
    expect(failureCount === 0 || failureCount === 1).toBe(true);
    await expect(readFile(path.join(directory, "source.txt"), "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
    const destination = await readFile(path.join(directory, "destination.txt"), "utf-8");
    if (failureCount === 0) {
      expect(destination).toBe("FIRST\nSECOND\n");
    } else {
      expect(destination).toBe("FIRST\nsecond\n");
    }
  });

  it("cleans up atomic temp files after successful writes", async () => {
    const directory = await createTempDirectory();
    await writeFile(path.join(directory, "atomic.txt"), "before\n", "utf-8");
    const patch = `*** Begin Patch
*** Update File: atomic.txt
@@
-before
+after
*** End Patch`;

    await applyPatch(directory, patch);

    expect(await readFile(path.join(directory, "atomic.txt"), "utf-8")).toBe("after\n");
    const files = await readdir(directory);
    expect(files.some((name) => name.includes(".tmp."))).toBe(false);
  });
});

describe("replaceChunks", () => {
  it("throws PatchApplicationError when context is missing", () => {
    expect(() =>
      replaceChunks("alpha\n", "a.ts", [
        { changeContexts: [], oldLines: ["missing"], newLines: ["x"], isEndOfFile: false },
      ]),
    ).toThrow(PatchApplicationError);
  });
});

describe("writeFileAtomic", () => {
  it("retries after unlink when rename hits EEXIST", async () => {
    const calls: string[] = [];
    let renameCount = 0;
    const operations = {
      async writeFile() {
        calls.push("writeFile");
      },
      async rename() {
        renameCount += 1;
        calls.push(`rename:${renameCount}`);
        if (renameCount === 1) {
          const error = new Error("exists") as Error & { code?: string };
          error.code = "EEXIST";
          throw error;
        }
      },
      async unlink() {
        calls.push("unlink");
      },
    };

    await writeFileAtomic("/tmp/target.txt", "content", operations);

    expect(calls).toEqual(["writeFile", "rename:1", "unlink", "rename:2"]);
  });
});

describe("resolvePatchPath", () => {
  it("resolves relative paths against cwd and keeps absolute paths", () => {
    expect(resolvePatchPath("/work", "src/a.ts")).toBe(path.join("/work", "src/a.ts"));
    expect(resolvePatchPath("/work", "/elsewhere/a.ts")).toBe("/elsewhere/a.ts");
  });
});
