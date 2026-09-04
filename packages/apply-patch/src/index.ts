import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { createApplyPatchTool } from "./tool.ts";

const GPT_APPLY_PATCH_PROVIDERS = new Set(["openai", "openai-codex", "azure-openai-responses", "github-copilot"]);
const GPT_APPLY_PATCH_APIS = new Set(["openai-responses", "openai-codex-responses"]);
const STANDARD_EDIT_TOOL_NAMES = ["edit", "write"] as const;

type ToolsetApi = Pick<ExtensionAPI, "on" | "getActiveTools" | "setActiveTools">;

export function isOpenAIGptModel(
  model: (Pick<Model<string>, "provider" | "id"> & Partial<Pick<Model<string>, "api">>) | undefined,
): boolean {
  if (!model?.id.startsWith("gpt-")) {
    return false;
  }

  return (
    GPT_APPLY_PATCH_PROVIDERS.has(model.provider) || (model.api !== undefined && GPT_APPLY_PATCH_APIS.has(model.api))
  );
}

function withoutExtensionManagedEditTools(toolNames: string[]): string[] {
  return toolNames.filter(
    (toolName) =>
      toolName !== "apply_patch" && !STANDARD_EDIT_TOOL_NAMES.some((editToolName) => editToolName === toolName),
  );
}

export function syncToolset(
  pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
  model: Model<string> | undefined,
) {
  const currentToolNames = pi.getActiveTools();
  if (isOpenAIGptModel(model)) {
    pi.setActiveTools([...withoutExtensionManagedEditTools(currentToolNames), "apply_patch"]);
    return;
  }

  pi.setActiveTools([...withoutExtensionManagedEditTools(currentToolNames), ...STANDARD_EDIT_TOOL_NAMES]);
}

export function registerApplyPatchExtension(pi: ToolsetApi): void {
  pi.on("session_start", async (_event, ctx) => {
    syncToolset(pi, ctx.model);
  });

  pi.on("model_select", async (event) => {
    syncToolset(pi, event.model);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    syncToolset(pi, ctx.model);
  });
}

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("apply-patch")) return;
  pi.registerTool(createApplyPatchTool());
  registerApplyPatchExtension(pi);
}
