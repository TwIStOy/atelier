import { describe, expect, it } from "vitest";
import {
  APPLY_PATCH_LARK_GRAMMAR,
  countPatchChanges,
  extractPatchedPaths,
  PatchParseError,
  parseNonEmptyPatch,
  parsePatch,
} from "../src/patch.ts";

describe("parsePatch", () => {
  it("parses add, delete, and update hunks", () => {
    const patch = `*** Begin Patch
*** Add File: nested/new.txt
+created
*** Delete File: gone.txt
*** Update File: src/app.ts
@@
-old
+new
*** End Patch`;

    expect(parsePatch(patch)).toEqual([
      { type: "add", filePath: "nested/new.txt", content: "created\n" },
      { type: "delete", filePath: "gone.txt" },
      {
        type: "update",
        filePath: "src/app.ts",
        chunks: [{ changeContexts: [], oldLines: ["old"], newLines: ["new"], isEndOfFile: false }],
      },
    ]);
  });

  it("parses move-only update hunks", () => {
    const patch = `*** Begin Patch
*** Update File: old.ts
*** Move to: new.ts
*** End Patch`;

    expect(parsePatch(patch)).toEqual([{ type: "update", filePath: "old.ts", movePath: "new.ts", chunks: [] }]);
  });

  it("parses stacked change contexts", () => {
    const patch = `*** Begin Patch
*** Update File: a.ts
@@ class Beta {
@@   method() {
-    x = 1
+    x = 2
*** End Patch`;

    expect(parsePatch(patch)).toEqual([
      {
        type: "update",
        filePath: "a.ts",
        chunks: [
          {
            changeContexts: ["class Beta {", "  method() {"],
            oldLines: ["    x = 1"],
            newLines: ["    x = 2"],
            isEndOfFile: false,
          },
        ],
      },
    ]);
  });

  it("parses end-of-file markers", () => {
    const patch = `*** Begin Patch
*** Update File: a.ts
@@
-target
+done
*** End of File
*** End Patch`;

    expect(parsePatch(patch)[0]).toMatchObject({
      type: "update",
      chunks: [{ oldLines: ["target"], newLines: ["done"], isEndOfFile: true }],
    });
  });

  it("strips heredoc wrappers", () => {
    const patch = `<<'EOF'
*** Begin Patch
*** Add File: heredoc.txt
+ok
*** End Patch
EOF`;

    expect(parsePatch(patch)).toEqual([{ type: "add", filePath: "heredoc.txt", content: "ok\n" }]);
  });

  it("rejects missing envelope", () => {
    expect(() => parsePatch("not a patch")).toThrow(PatchParseError);
  });

  it("rejects invalid hunk headers", () => {
    const patch = `*** Begin Patch
*** Frobnicate File: foo
*** End Patch`;

    expect(() => parsePatch(patch)).toThrow("is not a valid hunk header");
  });

  it("rejects empty patches via parseNonEmptyPatch", () => {
    const patch = `*** Begin Patch
*** End Patch`;

    expect(() => parseNonEmptyPatch(patch)).toThrow(PatchParseError);
  });
});

describe("extractPatchedPaths", () => {
  it("returns touched files including move targets", () => {
    const patch = `*** Begin Patch
*** Update File: src/app.ts
@@
-old
+new
*** Add File: src/new.ts
+content
*** Update File: src/old.ts
*** Move to: src/moved.ts
*** End Patch`;

    expect(extractPatchedPaths(patch)).toEqual(["src/app.ts", "src/new.ts", "src/old.ts", "src/moved.ts"]);
  });

  it("extracts from partial patch text while streaming", () => {
    expect(extractPatchedPaths("*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old")).toEqual(["src/a.ts"]);
  });
});

describe("countPatchChanges", () => {
  it("counts added and removed lines excluding context", () => {
    const patch = `*** Begin Patch
*** Update File: a.ts
@@ alpha
 context
-one
+two lines
+another
*** End Patch`;

    expect(countPatchChanges(parsePatch(patch))).toEqual({ added: 2, removed: 1 });
  });

  it("counts add file content lines", () => {
    const patch = `*** Begin Patch
*** Add File: a.ts
+one
+two
*** End Patch`;

    expect(countPatchChanges(parsePatch(patch))).toEqual({ added: 2, removed: 0 });
  });
});

describe("APPLY_PATCH_LARK_GRAMMAR", () => {
  it("is a lark grammar for the codex patch envelope", () => {
    expect(APPLY_PATCH_LARK_GRAMMAR).toContain('"*** Begin Patch"');
    expect(APPLY_PATCH_LARK_GRAMMAR).toContain('"*** End Patch"');
    expect(APPLY_PATCH_LARK_GRAMMAR).toContain("%import common.LF");
  });
});
