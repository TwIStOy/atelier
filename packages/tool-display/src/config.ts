import type { ExtensionConfigSchema } from "@htwang-contrib/common";
import { readConfig, registerConfigItems, updateConfig } from "@htwang-contrib/common";

export interface ToolDisplayConfig {
  previewLines: number;
  diffMode: "auto" | "unified" | "side-by-side";
  splitDiffMinWidth: number;
  editStyle: "single-line" | "two-line";
  applyPatchStyle: "single-line" | "two-line";
  writeStyle: "single-line" | "two-line";
  readStyle: "single-line" | "two-line";
  memoryStyle: "single-line" | "two-line";
  groupToolVerbs: boolean;
  groupMaxVisible: number;
  mcpToolCalls: boolean;
}

const CONFIG_NAME = "tool-display";

const CONFIG_SCHEMA: ExtensionConfigSchema<ToolDisplayConfig> = {
  defaults: {
    previewLines: 3,
    diffMode: "auto",
    splitDiffMinWidth: 100,
    editStyle: "single-line",
    applyPatchStyle: "single-line",
    writeStyle: "single-line",
    readStyle: "two-line",
    memoryStyle: "single-line",
    groupToolVerbs: true,
    groupMaxVisible: 10,
    mcpToolCalls: true,
  },
};

export function loadConfig(): ToolDisplayConfig {
  return readConfig(CONFIG_NAME, CONFIG_SCHEMA);
}

export function saveConfig(patch: Partial<ToolDisplayConfig>): ToolDisplayConfig {
  return updateConfig(CONFIG_NAME, CONFIG_SCHEMA, patch);
}

export function registerToolDisplayConfigItems(): void {
  registerConfigItems(CONFIG_NAME, [
    {
      key: "previewLines",
      type: "number",
      label: "Preview Lines",
      value: () => loadConfig().previewLines,
      description: "Number of output lines shown in collapsed tool call view (default 3)",
      extensionLabel: "Tool Display",
      order: 0,
      min: 1,
      max: 50,
    },
    {
      key: "diffMode",
      type: "select",
      label: "Diff Mode",
      value: () => loadConfig().diffMode,
      description:
        'How edit diffs are rendered: "auto" picks side-by-side when terminal is wide enough, otherwise unified',
      extensionLabel: "Tool Display",
      order: 1,
      options: [
        { label: "Auto", value: "auto" },
        { label: "Side-by-side", value: "side-by-side" },
        { label: "Unified", value: "unified" },
      ],
    },
    {
      key: "splitDiffMinWidth",
      type: "number",
      label: "Split Diff Min Width",
      value: () => loadConfig().splitDiffMinWidth,
      description: 'Minimum terminal width to use side-by-side diff when diff mode is "auto" (default 100)',
      extensionLabel: "Tool Display",
      order: 2,
      min: 40,
      max: 400,
    },
    {
      key: "editStyle",
      type: "select",
      label: "Edit Style",
      value: () => loadConfig().editStyle,
      description:
        'How the edit tool is rendered when collapsed: "single-line" puts the diff stats inline on the header, "two-line" keeps the legacy "└ diff +N -M" body row',
      extensionLabel: "Tool Display",
      order: 3,
      options: [
        { label: "Single-line", value: "single-line" },
        { label: "Two-line", value: "two-line" },
      ],
    },
    {
      key: "applyPatchStyle",
      type: "select",
      label: "ApplyPatch Style",
      value: () => loadConfig().applyPatchStyle,
      description:
        'How the apply_patch tool is rendered when collapsed: "single-line" puts the patch stats inline on the header, "two-line" keeps the "└ patch +N -M" body row',
      extensionLabel: "Tool Display",
      order: 4,
      options: [
        { label: "Single-line", value: "single-line" },
        { label: "Two-line", value: "two-line" },
      ],
    },
    {
      key: "writeStyle",
      type: "select",
      label: "Write Style",
      value: () => loadConfig().writeStyle,
      description:
        'How the write tool is rendered when collapsed: "single-line" puts the line-count stat inline on the header, "two-line" keeps the legacy "└ N lines" body row',
      extensionLabel: "Tool Display",
      order: 5,
      options: [
        { label: "Single-line", value: "single-line" },
        { label: "Two-line", value: "two-line" },
      ],
    },
    {
      key: "readStyle",
      type: "select",
      label: "Read Style",
      value: () => loadConfig().readStyle,
      description:
        'How the read tool is rendered when collapsed: "single-line" appends "· N lines" inline on the header, "two-line" keeps the legacy "└ N lines" body row',
      extensionLabel: "Tool Display",
      order: 6,
      options: [
        { label: "Two-line", value: "two-line" },
        { label: "Single-line", value: "single-line" },
      ],
    },
    {
      key: "memoryStyle",
      type: "select",
      label: "Memory Style",
      value: () => loadConfig().memoryStyle,
      description:
        'How memory tools are rendered when collapsed: "single-line" appends the result summary inline on the header, "two-line" keeps the legacy "└ ..." body row',
      extensionLabel: "Tool Display",
      order: 7,
      options: [
        { label: "Single-line", value: "single-line" },
        { label: "Two-line", value: "two-line" },
      ],
    },
    {
      key: "groupToolVerbs",
      type: "boolean",
      label: "Group Tool Calls",
      value: () => loadConfig().groupToolVerbs,
      description:
        "Fold consecutive read-only tool calls (grep/glob/ls/read, plus names with a registered Aggregate Rule) into one aggregate summary row",
      extensionLabel: "Tool Display",
      order: 8,
    },
    {
      key: "groupMaxVisible",
      type: "number",
      label: "Group Max Visible",
      value: () => loadConfig().groupMaxVisible,
      description:
        "Hide older collapsed tool calls behind a truncation header when a dense run exceeds this many entries (0 disables truncation)",
      extensionLabel: "Tool Display",
      order: 9,
      min: 0,
      max: 100,
    },
    {
      key: "mcpToolCalls",
      type: "boolean",
      label: "Render MCP Tool Calls",
      value: () => loadConfig().mcpToolCalls,
      description:
        "Take over rendering of pi-mcp-adapter tool calls (mcp proxy and direct server tools) instead of the adapter's own renderers",
      extensionLabel: "Tool Display",
      order: 10,
    },
  ]);
}
