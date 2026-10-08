import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type ApplyPatchProgress, type ApplyPatchResult, applyParsedPatchDetailed } from "./apply.ts";
import { APPLY_PATCH_LARK_GRAMMAR, type ParsedPatch, parseNonEmptyPatch, parsePatch } from "./patch.ts";
import { type ApplyPatchPreview, type ApplyPatchToolDetails, createPatchPreview } from "./preview.ts";

export const APPLY_PATCH_DESCRIPTION =
  "Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.";

const APPLY_PATCH_PARAMS = Type.Object({
  input: Type.String({
    description: "The entire contents of the apply_patch command",
  }),
});

type ApplyPatchParams = {
  input: string;
};

export function normalizeApplyPatchArguments(args: unknown): ApplyPatchParams {
  if (typeof args === "string") {
    return { input: args };
  }

  if (args && typeof args === "object" && "input" in args) {
    const input = (args as { input?: unknown }).input;
    if (typeof input === "string") {
      return { input };
    }
  }

  return { input: "" };
}

function pendingText(progress: ApplyPatchProgress | undefined): string {
  return progress ? `Applying patch (${progress.applied + progress.failed}/${progress.total})...` : "Applying patch...";
}

function failureText(result: ApplyPatchResult): string {
  const failureLines = result.failures.map(
    (failure) => `- ${failure.filePath} (${failure.operation}): ${failure.message}`,
  );
  const mustReadFiles = result.recoveryInstructions.mustReadFiles;
  const mustReadText = mustReadFiles.join(" and ");
  return [
    result.hasPartialSuccess ? "apply_patch partially failed." : "apply_patch failed.",
    "Failed:",
    ...failureLines,
    mustReadFiles.length > 0 ? `Recovery: MUST read ${mustReadText} before retrying.` : "",
    result.appliedFiles.length > 0
      ? "Earlier file actions in this patch were already applied."
      : "No file actions were applied.",
    result.recoveryInstructions.mustNotReadFiles.length > 0
      ? "Recovery: MUST NOT reread other files from this patch unless a specific dependency requires it."
      : "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function createApplyPatchTool(): ToolDefinition<typeof APPLY_PATCH_PARAMS, ApplyPatchToolDetails> {
  return {
    name: "apply_patch",
    label: "ApplyPatch",
    description: APPLY_PATCH_DESCRIPTION,
    parameters: APPLY_PATCH_PARAMS,
    prepareArguments: normalizeApplyPatchArguments,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    promptSnippet: "Apply Codex-format file patches with apply_patch",
    promptGuidelines: [
      "Use apply_patch for file edits instead of mutating files through bash, Python scripts, heredocs, or shell redirection.",
      "After apply_patch succeeds, do not re-read the edited files just to confirm the patch applied.",
    ],
    constrainedSampling: {
      type: "grammar",
      variants: { openai_lark: APPLY_PATCH_LARK_GRAMMAR },
    },
    async execute(_toolCallId, params, _signal, onUpdate, ctx): Promise<AgentToolResult<ApplyPatchToolDetails>> {
      const normalizedParams = normalizeApplyPatchArguments(params);
      if (!normalizedParams.input) {
        throw new Error("input is required");
      }

      let parsedHunks: ParsedPatch[] | undefined;
      try {
        parsedHunks = parseNonEmptyPatch(normalizedParams.input);
      } catch {
        // Keep invalid patch text flowing; the apply step reports the parse error.
      }

      let preview: ApplyPatchPreview | undefined;
      try {
        const hunks = parsedHunks ?? parsePatch(normalizedParams.input);
        if (hunks.length > 0) {
          preview = await createPatchPreview(ctx.cwd, hunks);
        }
      } catch {
        // Missing files or context mismatches surface through the apply result.
      }

      const totalOperations = parsedHunks?.length ?? 0;
      const initialProgress = totalOperations > 0 ? { applied: 0, failed: 0, total: totalOperations } : undefined;
      onUpdate?.({
        content: [{ type: "text", text: pendingText(initialProgress) }],
        details: { preview, ...(initialProgress ? { progress: initialProgress } : {}) },
      });

      const result = await applyParsedPatchDetailed(
        ctx.cwd,
        parsedHunks ?? parseNonEmptyPatch(normalizedParams.input),
        (progress) => {
          onUpdate?.({
            content: [{ type: "text", text: pendingText(progress) }],
            details: { preview, progress },
          });
        },
      );

      if (result.failures.length > 0) {
        return {
          content: [{ type: "text", text: failureText(result) }],
          details: { ...(preview ? { preview } : {}), result },
        };
      }

      return {
        content: [{ type: "text", text: result.summaries.join("\n") }],
        details: { ...(preview ? { preview } : {}), result },
      };
    },
  };
}
