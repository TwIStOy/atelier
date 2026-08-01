import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLogger, isExtensionDisabled } from "@htwang-contrib/common";
import {
  type FetchResponse,
  type FullProvider,
  instantiateProviders,
  isRateLimitError,
  PROVIDERS,
  resolveApiKey,
} from "@htwang-contrib/web-tools";
import { Type } from "typebox";
import { type BootstrapResult, bootstrapVault } from "./core/bootstrap.ts";
import { classifyPathOperation } from "./core/guardrail.ts";
import { rebuildMeta } from "./core/meta.ts";
import { type CaptureInput, type CaptureResult, captureSource, type UrlFetcher } from "./core/packet.ts";
import { VAULT_DIR_NAME, vaultLayout } from "./core/paths.ts";
import { resolveVaults } from "./core/vault.ts";

const logger = createLogger("llm-wiki");

function fetchCapableProviderNames(): string[] {
  return PROVIDERS.filter((p) => p.roles.includes("fetch"))
    .map((p) => p.envVar)
    .filter((v): v is string => Boolean(v));
}

function createWebToolsUrlFetcher(): UrlFetcher {
  return {
    async fetch(url, signal) {
      const { providers } = instantiateProviders();
      const usable = providers.filter(
        (entry): entry is { name: string; provider: FullProvider } =>
          "fetch" in entry.provider && Boolean(resolveApiKey(entry.name)),
      );
      if (usable.length === 0) {
        throw new Error(
          `wiki_capture: no URL fetch provider is configured. Set one of: ${fetchCapableProviderNames().join(", ")} (via /config or the matching env var).`,
        );
      }
      for (const { name, provider } of usable) {
        try {
          const res: FetchResponse = await provider.fetch(url, false, signal);
          logger.debug(`fetched ${url} via ${name}`);
          return {
            text: res.text,
            ...(res.title !== undefined ? { title: res.title } : {}),
            ...(res.contentType !== undefined ? { contentType: res.contentType } : {}),
          };
        } catch (err) {
          if (isRateLimitError(err)) continue;
          throw err;
        }
      }
      throw new Error(`wiki_capture: every configured fetch provider was rate-limited for ${url}`);
    },
  };
}

interface CaptureParams {
  sourceType: "url" | "text" | "file";
  url?: string;
  text?: string;
  originPath?: string;
  title?: string;
}

function toCaptureInput(params: CaptureParams): CaptureInput {
  const title = params.title?.trim() || undefined;
  switch (params.sourceType) {
    case "url": {
      if (!params.url?.trim()) throw new Error("wiki_capture: `url` is required when sourceType=url");
      return { sourceType: "url", url: params.url.trim(), ...(title ? { title } : {}) };
    }
    case "text": {
      if (params.text === undefined || params.text.length === 0) {
        throw new Error("wiki_capture: `text` is required when sourceType=text");
      }
      return { sourceType: "text", text: params.text, ...(title ? { title } : {}) };
    }
    case "file": {
      if (!params.originPath?.trim()) throw new Error("wiki_capture: `originPath` is required when sourceType=file");
      return { sourceType: "file", originPath: params.originPath.trim(), ...(title ? { title } : {}) };
    }
    default:
      throw new Error(`wiki_capture: unsupported sourceType "${String(params.sourceType)}"`);
  }
}

function targetVaultRoot(cwd: string): string {
  const { projectVault, personalVault } = resolveVaults({ cwd });
  return projectVault ?? personalVault;
}

function activeVaultRoots(cwd: string): string[] {
  const { projectVault, personalVault } = resolveVaults({ cwd });
  return [projectVault, personalVault].filter((v): v is string => v !== null);
}

const touchedVaults = new Set<string>();

function registerWikiCaptureTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_capture",
    label: "Wiki Capture",
    description:
      "Capture a Raw Source into an immutable Source Packet in the LLM Wiki vault " +
      "(raw/sources/SRC-YYYY-MM-DD-NNN/ with manifest.json + original/ + extracted.md). " +
      "Three source types: `url` (fetched via the configured web-tools provider, e.g. Jina/Firecrawl), " +
      "`text` (pasted markdown/text), or `file` (a local .md/.txt path). " +
      "Re-capturing the same path/url/text is idempotent — it returns the existing packet. " +
      "PDF/Office/EPUB are not supported.",
    promptSnippet: "Capture a URL, pasted text, or local file into the wiki as an immutable Source Packet",
    parameters: Type.Object({
      sourceType: Type.Union([Type.Literal("url"), Type.Literal("text"), Type.Literal("file")], {
        description: "Source type: url | text | file.",
      }),
      url: Type.Optional(Type.String({ description: "Required when sourceType=url." })),
      text: Type.Optional(Type.String({ description: "Required when sourceType=text (pasted content)." })),
      originPath: Type.Optional(
        Type.String({
          description: "Required when sourceType=file. Absolute or cwd-relative path to a local .md/.txt file.",
        }),
      ),
      title: Type.Optional(Type.String({ description: "Optional human-readable title." })),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = toCaptureInput(params);
      const vaultRoot = targetVaultRoot(ctx.cwd);
      const sourcesDir = vaultLayout(vaultRoot).sourcesRoot;

      const result: CaptureResult = await captureSource(input, {
        sourcesDir,
        signal,
        ...(input.sourceType === "url" ? { urlFetcher: createWebToolsUrlFetcher() } : {}),
      });

      const summary = formatSummary(result, vaultRoot);
      onUpdate?.({
        content: [{ type: "text", text: summary }],
        details: { packetId: result.manifest.id, vaultRoot, created: result.created },
      });

      return {
        content: [{ type: "text", text: summary }],
        details: {
          packetId: result.manifest.id,
          packetDir: result.packetDir,
          vaultRoot,
          sourceType: result.manifest.origin.sourceType,
          created: result.created,
          contentHash: result.manifest.contentHash,
        },
      };
    },
  });
}

function registerWikiRebuildMetaTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_rebuild_meta",
    label: "Wiki Rebuild Meta",
    description:
      "Rebuild all derived LLM Wiki metadata for the active vault (project vault if present, otherwise the personal vault). " +
      "Regenerates meta/registry.json, meta/backlinks.json, meta/index.md, and meta/log.md (from events.jsonl) from raw/** + wiki/**. " +
      "Derived metadata is also rebuilt automatically at the end of any turn that directly edits wiki/**.",
    promptSnippet: "Rebuild derived LLM Wiki metadata (registry, backlinks, index, log) for the active vault",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, onUpdate, ctx) {
      const vaultRoot = targetVaultRoot(ctx.cwd);
      const result = rebuildMeta(vaultRoot);
      const summary = formatRebuildSummary(result);
      onUpdate?.({ content: [{ type: "text", text: summary }], details: result });
      return { content: [{ type: "text", text: summary }], details: result };
    },
  });
}

function formatRebuildSummary(result: ReturnType<typeof rebuildMeta>): string {
  return [
    `Rebuilt metadata for ${result.vault}`,
    `- pages: ${result.pages}`,
    `- sources: ${result.sources}`,
    `- backlinked pages: ${result.backlinks}`,
    `- events rendered to log: ${result.events}`,
    `- written: ${result.written.join(", ")}`,
  ].join("\n");
}

function rebuildTouchedVaults(): void {
  if (touchedVaults.size === 0) return;
  const vaults = [...touchedVaults];
  touchedVaults.clear();
  for (const vault of vaults) {
    try {
      const result = rebuildMeta(vault);
      logger.debug(`auto-rebuilt meta for ${vault}: ${result.pages} pages, ${result.sources} sources`);
    } catch (err) {
      logger.warn(`auto-rebuild of ${vault} failed: ${String(err)}`);
    }
  }
}

function formatSummary(result: CaptureResult, vaultRoot: string): string {
  const { manifest, created } = result;
  const verb = created ? "Captured" : "Already captured (deduped, no new packet)";
  const rel = (p: string): string => {
    const root = `${vaultRoot}/`;
    return p.startsWith(root) ? p.slice(root.length) : p;
  };
  const lines = [
    `${verb}: ${manifest.id} [${manifest.origin.sourceType}]`,
    `vault: ${vaultRoot}`,
    `packet: ${rel(result.packetDir)}`,
    `contentHash: ${manifest.contentHash}`,
  ];
  if (manifest.origin.sourceType === "url") lines.push(`url: ${manifest.origin.url}`);
  if (manifest.origin.sourceType === "file") lines.push(`originPath: ${manifest.origin.originPath}`);
  return lines.join("\n");
}

type BootstrapScope = "project" | "personal";

function bootstrapRoot(cwd: string, scope: BootstrapScope): string {
  if (scope === "personal") return resolveVaults({ cwd }).personalVault;
  return path.join(cwd, VAULT_DIR_NAME);
}

function formatBootstrapSummary(result: BootstrapResult, scope: BootstrapScope): string {
  const verb = result.created ? "Initialized vault" : "Vault already initialized";
  const lines = [`${verb}: ${result.root} [scope: ${scope}]`];
  if (result.created) lines.push(`created: ${result.createdFiles.length} files`);
  if (result.topic) lines.push(`topic: ${result.topic}`);
  return lines.join("\n");
}

function registerWikiBootstrapTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_bootstrap",
    label: "Wiki Bootstrap",
    description:
      "Initialize an LLM Wiki vault: creates config.json, WIKI_SCHEMA.md (Schema), purpose.md (Purpose), " +
      "the five Page Type templates (source/concept/entity/synthesis/analysis), inbox/, the wiki/ page-type " +
      "directories, raw/sources/, and meta/. Idempotent — re-running creates only what is missing and never " +
      "overwrites existing files. An optional `topic` is backfilled into purpose.md. Use scope=project (default) " +
      "for <cwd>/.llm-wiki or scope=personal for the personal vault.",
    promptSnippet: "Create the vault skeleton (Schema, Purpose, templates, directories) for an LLM Wiki",
    parameters: Type.Object({
      topic: Type.Optional(
        Type.String({ description: "Optional directional topic, written into purpose.md's Topic section." }),
      ),
      scope: Type.Optional(
        Type.Union([Type.Literal("project"), Type.Literal("personal")], {
          description: "Which vault to bootstrap: project (<cwd>/.llm-wiki, default) or personal (~/.llm-wiki).",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const scope: BootstrapScope = params.scope === "personal" ? "personal" : "project";
      const topic = typeof params.topic === "string" ? params.topic.trim() : undefined;
      const root = bootstrapRoot(ctx.cwd, scope);
      const result = bootstrapVault(root, { ...(topic ? { topic } : {}) });
      const summary = formatBootstrapSummary(result, scope);
      onUpdate?.({
        content: [{ type: "text", text: summary }],
        details: { vaultRoot: root, scope, created: result.created, topic: result.topic },
      });
      return {
        content: [{ type: "text", text: summary }],
        details: {
          vaultRoot: root,
          scope,
          created: result.created,
          createdFiles: result.createdFiles,
          ...(result.topic ? { topic: result.topic } : {}),
        },
      };
    },
  });
}

function registerWikiInitCommand(pi: ExtensionAPI): void {
  pi.registerCommand("wiki-init", {
    description:
      "Bootstrap the project LLM Wiki vault at <cwd>/.llm-wiki (config, Schema, Purpose, templates, dirs). " +
      "Optional <topic> is backfilled into purpose.md. Idempotent — safe to re-run.",
    async handler(args, ctx) {
      const topic = (args ?? "").trim();
      const root = path.join(ctx.cwd, VAULT_DIR_NAME);
      const result = bootstrapVault(root, { ...(topic ? { topic } : {}) });
      const head = result.created
        ? `Initialized project wiki at ${root} (${result.createdFiles.length} files created)`
        : `Project wiki already initialized at ${root}`;
      const tail = topic ? `; topic set to "${topic}"` : "";
      ctx.ui.notify(`${head}${tail}`, "info");
    },
  });
}

export default function initLlmWiki(pi: ExtensionAPI): void {
  if (isExtensionDisabled("llm-wiki")) return;
  logger.info("extension loaded");

  pi.on("session_start", () => {
    touchedVaults.clear();
  });

  pi.on("tool_call", (event, ctx) => {
    const decision = classifyPathOperation(event.toolName, event.input, {
      cwd: ctx.cwd,
      vaultRoots: activeVaultRoots(ctx.cwd),
    });
    if (decision.block) {
      const reason = decision.reason ?? "wiki guardrail blocked this operation";
      ctx.ui.notify(reason, "warning");
      return { block: true, reason };
    }
    if (decision.wikiTouched && decision.touchedVault) {
      touchedVaults.add(decision.touchedVault);
    }
    return undefined;
  });

  pi.on("turn_end", () => {
    rebuildTouchedVaults();
  });

  registerWikiCaptureTool(pi);
  registerWikiBootstrapTool(pi);
  registerWikiRebuildMetaTool(pi);
  registerWikiInitCommand(pi);
}
