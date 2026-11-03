import type { TextContent } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolResultEvent,
  ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { isReadToolResult } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { InjectionCache } from "./cache.ts";
import { clearMappingsCache, loadConfigPath, loadInlineEntry, loadMappings, registerConfig } from "./config.ts";
import { injectDirectoryContext } from "./injection.ts";
import { resolveMirrorRoot } from "./mirror.ts";
import {
  buildDebugRecord,
  buildInjectedEntryData,
  clearStatus,
  clearWidget,
  type InjectedEntryData,
  type InjectedEntryFile,
  type InjectedFileMeta,
  type ThemeFn,
  updateStatus,
  updateWidget,
} from "./reporter.ts";
import { getSessionKey } from "./session-key.ts";
import {
  DEFAULT_FILE_NAMES,
  DEFAULT_MAX_BYTES_PER_FILE,
  DEFAULT_MAX_BYTES_PER_READ,
  type InjectedFileInfo,
  type InjectionResult,
} from "./types.ts";

const FLAG_DISABLE = "no-agents-mirror";
const COMMAND = "agents-mirror";
const ENTRY_TYPE_DEBUG = "agents-mirror:debug";
const ENTRY_TYPE_INJECTED = "agents-mirror:injected";

type CommandArgKind = "reload" | "toggle" | "unknown";

export default function agentsMirror(pi: ExtensionAPI): void {
  if (isExtensionDisabled("agents-mirror")) return;
  registerConfig();

  pi.registerEntryRenderer<InjectedEntryData>(ENTRY_TYPE_INJECTED, (entry, { expanded }, theme) =>
    renderInjectedEntry(entry.data, expanded, theme),
  );

  pi.registerFlag(FLAG_DISABLE, {
    description: "Disable agents-mirror context injection.",
    type: "boolean",
    default: false,
  });

  const cache = new InjectionCache();
  const filesPerSession = new Map<string, Map<string, InjectedFileMeta>>();
  const errorsPerSession = new Set<string>();
  let widgetVisible = false;
  let disabled = false;
  let resolvedMirror: { cwd: string; root: string | null } | null = null;

  function resolveMirrorForCwd(cwd: string): string | null {
    if (resolvedMirror && resolvedMirror.cwd === cwd) return resolvedMirror.root;
    const mappings = loadMappings(loadConfigPath());
    const root = resolveMirrorRoot(mappings, cwd);
    resolvedMirror = { cwd, root };
    return root;
  }

  pi.on("session_start", async (_event, ctx) => {
    disabled = pi.getFlag(FLAG_DISABLE) === true;
    resolvedMirror = null;
    if (disabled) {
      clearStatus(ctx);
      clearWidget(ctx);
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (disabled) return undefined;
    const filePath = injectionPath(event);
    if (!filePath) return undefined;
    return recordInjection(filePath, event, ctx);
  });

  async function recordInjection(
    filePath: string,
    event: ToolResultEvent,
    ctx: ExtensionContext,
  ): Promise<ToolResultEventResult | undefined> {
    const sessionKey = getSessionKey(ctx);
    const mirrorRoot = resolveMirrorForCwd(ctx.cwd);

    const result = await injectDirectoryContext({
      filePath,
      projectRoot: ctx.cwd,
      mirrorRoot,
      cache,
      sessionKey,
      fileNames: DEFAULT_FILE_NAMES,
      maxBytesPerFile: DEFAULT_MAX_BYTES_PER_FILE,
      maxBytesPerRead: DEFAULT_MAX_BYTES_PER_READ,
    });

    const hasErrors = noteSessionErrors(sessionKey, result);

    if (!result.injectedText) {
      updateStatus(ctx, cache, sessionKey, hasErrors);
      return undefined;
    }

    const metaMap = mergeInjectedFiles(sessionKey, result.injectedFiles);

    updateStatus(ctx, cache, sessionKey, hasErrors);
    if (widgetVisible) updateWidget(ctx, true, [...metaMap.values()]);

    appendInjectedEntry(filePath, ctx, result.injectedFiles, mirrorRoot);

    const textBlock: TextContent = { type: "text", text: result.injectedText };
    return { content: [...event.content, textBlock] };
  }

  function noteSessionErrors(sessionKey: string, result: InjectionResult): boolean {
    const hasErrors = errorsPerSession.has(sessionKey) || result.errors.length > 0;
    if (result.errors.length > 0) errorsPerSession.add(sessionKey);
    return hasErrors;
  }

  function mergeInjectedFiles(sessionKey: string, files: InjectedFileInfo[]): Map<string, InjectedFileMeta> {
    let metaMap = filesPerSession.get(sessionKey);
    if (!metaMap) {
      metaMap = new Map();
      filesPerSession.set(sessionKey, metaMap);
    }
    for (const file of files) {
      metaMap.set(file.absolutePath, {
        absolutePath: file.absolutePath,
        source: file.source,
        truncated: file.truncated,
      });
    }
    return metaMap;
  }

  function appendInjectedEntry(
    readPath: string,
    ctx: ExtensionContext,
    files: InjectedFileInfo[],
    mirrorRoot: string | null,
  ): void {
    if (!loadInlineEntry()) return;
    pi.appendEntry<InjectedEntryData>(
      ENTRY_TYPE_INJECTED,
      buildInjectedEntryData({ readPath, files, cwd: ctx.cwd, mirrorRoot }),
    );
  }

  pi.on("session_compact", async (_event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    cache.clearSession(sessionKey);
    filesPerSession.delete(sessionKey);
    errorsPerSession.delete(sessionKey);
    updateStatus(ctx, cache, sessionKey, false);
    if (widgetVisible) updateWidget(ctx, true, []);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionKey = getSessionKey(ctx);
    cache.clearSession(sessionKey);
    filesPerSession.delete(sessionKey);
    errorsPerSession.delete(sessionKey);
  });

  pi.registerCommand(COMMAND, {
    description: "Toggle the agents-mirror context widget. Args: reload",
    handler: async (args, ctx) => {
      if (disabled) {
        ctx.ui.notify("agents-mirror is disabled via --no-agents-mirror", "info");
        return;
      }
      const kind = classifyCommandArg(args);
      if (kind === "reload") {
        reloadMappings(ctx);
        return;
      }
      if (kind === "unknown") {
        ctx.ui.notify(`Unknown argument: ${args}. Usage: /${COMMAND} [reload]`, "warning");
        return;
      }
      toggleWidget(ctx);
    },
  });

  function classifyCommandArg(args: string): CommandArgKind {
    const trimmed = (args ?? "").trim().toLowerCase();
    if (trimmed === "reload") return "reload";
    if (trimmed !== "") return "unknown";
    return "toggle";
  }

  function reloadMappings(ctx: ExtensionCommandContext): void {
    clearMappingsCache();
    resolvedMirror = null;
    const sessionKey = getSessionKey(ctx);
    const files = sessionFiles(sessionKey);
    ctx.ui.notify("agents-mirror mapping cache reloaded.", "info");
    if (widgetVisible) updateWidget(ctx, true, files);
  }

  function toggleWidget(ctx: ExtensionCommandContext): void {
    widgetVisible = !widgetVisible;
    const sessionKey = getSessionKey(ctx);
    const files = sessionFiles(sessionKey);
    updateWidget(ctx, widgetVisible, files);
    pi.appendEntry(ENTRY_TYPE_DEBUG, buildDebugRecord({ cache, sessionKey, files }));
    ctx.ui.notify(widgetVisible ? "Agents Mirror context widget shown" : "Agents Mirror context widget hidden", "info");
  }

  function sessionFiles(sessionKey: string): InjectedFileMeta[] {
    return [...(filesPerSession.get(sessionKey)?.values() ?? [])];
  }
}

function injectionPath(event: ToolResultEvent): string | null {
  if (event.isError || !hasTextContent(event.content)) return null;
  return readToolPath(event);
}

function hasTextContent(content: ToolResultEvent["content"]): boolean {
  return content.some((block) => block.type === "text");
}

function readToolPath(event: ToolResultEvent): string | null {
  if (!isReadToolResult(event)) return null;
  const filePath = event.input.path;
  if (typeof filePath !== "string" || filePath.length === 0) return null;
  return filePath;
}

function renderInjectedEntry(data: InjectedEntryData | undefined, expanded: boolean, theme: ThemeFn): Box | undefined {
  if (!data || data.files.length === 0) return undefined;
  const box = new Box();
  box.addChild(new Text(theme.fg("dim", injectedEntrySummary(data.files)), 0, 0));
  if (expanded) addInjectedEntryFiles(box, data.files, theme);
  return box;
}

function injectedEntrySummary(files: InjectedEntryFile[]): string {
  const projectCount = files.filter((f) => f.source === "project").length;
  const mirrorCount = files.length - projectCount;
  const parts: string[] = [];
  if (projectCount > 0) parts.push(`${projectCount} project`);
  if (mirrorCount > 0) parts.push(`${mirrorCount} mirror`);
  return `  \u21B3 agents-mirror \u00B7 injected ${files.length} (${parts.join(", ")})`;
}

function addInjectedEntryFiles(box: Box, files: InjectedEntryFile[], theme: ThemeFn): void {
  for (const f of files) {
    const tag = f.source === "mirror" ? " [mirror]" : "";
    const trunc = f.truncated ? " (truncated)" : "";
    box.addChild(new Text(theme.fg("dim", `      ${f.display}${tag}${trunc}`), 0, 0));
  }
}
