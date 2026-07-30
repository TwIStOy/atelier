import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isReadToolResult } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
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
  type InjectedFileMeta,
  updateStatus,
  updateWidget,
} from "./reporter.ts";
import { getSessionKey } from "./session-key.ts";
import { DEFAULT_FILE_NAMES, DEFAULT_MAX_BYTES_PER_FILE, DEFAULT_MAX_BYTES_PER_READ } from "./types.ts";

const FLAG_DISABLE = "no-agents-mirror";
const COMMAND = "agents-mirror";
const ENTRY_TYPE_DEBUG = "agents-mirror:debug";
const ENTRY_TYPE_INJECTED = "agents-mirror:injected";

export default function agentsMirror(pi: ExtensionAPI): void {
  registerConfig();

  pi.registerEntryRenderer<InjectedEntryData>(ENTRY_TYPE_INJECTED, (entry, { expanded }, theme) => {
    const data = entry.data;
    if (!data || data.files.length === 0) return undefined;
    const projectCount = data.files.filter((f) => f.source === "project").length;
    const mirrorCount = data.files.length - projectCount;
    const parts: string[] = [];
    if (projectCount > 0) parts.push(`${projectCount} project`);
    if (mirrorCount > 0) parts.push(`${mirrorCount} mirror`);
    const box = new Box();
    box.addChild(
      new Text(
        theme.fg("dim", `  \u21B3 agents-mirror \u00B7 injected ${data.files.length} (${parts.join(", ")})`),
        0,
        0,
      ),
    );
    if (expanded) {
      for (const f of data.files) {
        const tag = f.source === "mirror" ? " [mirror]" : "";
        const trunc = f.truncated ? " (truncated)" : "";
        box.addChild(new Text(theme.fg("dim", `      ${f.display}${tag}${trunc}`), 0, 0));
      }
    }
    return box;
  });

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
    if (!isReadToolResult(event) || event.isError) return undefined;
    const filePath = event.input.path;
    if (typeof filePath !== "string" || filePath.length === 0) return undefined;
    const hasText = event.content.some((block) => block.type === "text");
    if (!hasText) return undefined;

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

    const errorsRecorded = errorsPerSession.has(sessionKey);
    const hasErrors = errorsRecorded || result.errors.length > 0;
    if (result.errors.length > 0) errorsPerSession.add(sessionKey);

    if (!result.injectedText) {
      updateStatus(ctx, cache, sessionKey, hasErrors);
      return undefined;
    }

    let metaMap = filesPerSession.get(sessionKey);
    if (!metaMap) {
      metaMap = new Map();
      filesPerSession.set(sessionKey, metaMap);
    }
    for (const file of result.injectedFiles) {
      metaMap.set(file.absolutePath, {
        absolutePath: file.absolutePath,
        source: file.source,
        truncated: file.truncated,
      });
    }

    updateStatus(ctx, cache, sessionKey, hasErrors);
    if (widgetVisible) updateWidget(ctx, true, [...metaMap.values()]);

    if (loadInlineEntry()) {
      pi.appendEntry<InjectedEntryData>(
        ENTRY_TYPE_INJECTED,
        buildInjectedEntryData({ readPath: filePath, files: result.injectedFiles, cwd: ctx.cwd, mirrorRoot }),
      );
    }

    const textBlock: TextContent = { type: "text", text: result.injectedText };
    return { content: [...event.content, textBlock] };
  });

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
      const trimmed = (args ?? "").trim().toLowerCase();
      if (trimmed === "reload") {
        clearMappingsCache();
        resolvedMirror = null;
        const sessionKey = getSessionKey(ctx);
        const files = [...(filesPerSession.get(sessionKey)?.values() ?? [])];
        ctx.ui.notify("agents-mirror mapping cache reloaded.", "info");
        if (widgetVisible) updateWidget(ctx, true, files);
        return;
      }
      if (trimmed !== "") {
        ctx.ui.notify(`Unknown argument: ${args}. Usage: /${COMMAND} [reload]`, "warning");
        return;
      }
      widgetVisible = !widgetVisible;
      const sessionKey = getSessionKey(ctx);
      const files = [...(filesPerSession.get(sessionKey)?.values() ?? [])];
      updateWidget(ctx, widgetVisible, files);
      pi.appendEntry(ENTRY_TYPE_DEBUG, buildDebugRecord({ cache, sessionKey, files }));
      ctx.ui.notify(
        widgetVisible ? "Agents Mirror context widget shown" : "Agents Mirror context widget hidden",
        "info",
      );
    },
  });
}
