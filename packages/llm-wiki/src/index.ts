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
import { classifyPathOperation } from "./core/guardrail.ts";
import { rebuildMeta } from "./core/meta.ts";
import { type CaptureInput, type CaptureResult, captureSource, type UrlFetcher } from "./core/packet.ts";
import { type EnsurePageResult, ensurePage } from "./core/page.ts";
import { vaultLayout } from "./core/paths.ts";
import { type RecallHit, type RecallResult, recallAcross, recallVault } from "./core/recall.ts";
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

function registerWikiEnsurePageTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_ensure_page",
    label: "Wiki Ensure Page",
    description:
      "Resolve-or-create a typed Wiki Page in the active LLM Wiki vault (project vault if present, otherwise the personal vault). " +
      "Resolves first: if a page of the SAME type already claims the title or an alias (case-insensitive), returns that existing page without creating a duplicate. " +
      "Otherwise instantiates the template for the given Page Type (templates/<type>.md), filling type/title/aliases/sources into the frontmatter, and writes it under wiki/<type>s/<slug>.md. " +
      "Page Types: source | concept | entity | synthesis | analysis. " +
      "`sources` are Source Packet ids (SRC-YYYY-MM-DD-NNN). `slug` optionally overrides the filename (defaults to a kebab slug derived from title).",
    promptSnippet: "Get-or-create a typed Wiki Page, deduping by title/alias within the type",
    parameters: Type.Object({
      type: Type.Union(
        [
          Type.Literal("source"),
          Type.Literal("concept"),
          Type.Literal("entity"),
          Type.Literal("synthesis"),
          Type.Literal("analysis"),
        ],
        { description: "Page Type: source | concept | entity | synthesis | analysis." },
      ),
      title: Type.String({ description: "Human-readable page title (required)." }),
      aliases: Type.Optional(
        Type.Array(Type.String(), { description: "Alternative names; resolved for dedup within the same type." }),
      ),
      sources: Type.Optional(
        Type.Array(Type.String(), {
          description: "Source Packet ids (SRC-YYYY-MM-DD-NNN) the page draws on.",
        }),
      ),
      slug: Type.Optional(
        Type.String({
          description: "Optional filename slug override (kebab-case). Defaults to a slug derived from title.",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const vaultRoot = targetVaultRoot(ctx.cwd);
      const result: EnsurePageResult = ensurePage(vaultRoot, params);

      if (result.created) touchedVaults.add(vaultRoot);

      const summary = formatEnsureSummary(result, vaultRoot);
      onUpdate?.({ content: [{ type: "text", text: summary }], details: { ...result, vaultRoot } });

      return {
        content: [{ type: "text", text: summary }],
        details: { ...result, vaultRoot },
      };
    },
  });
}

function registerWikiSearchTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_search",
    label: "Wiki Search",
    description:
      "Keyword-search the registry of ONE LLM Wiki vault (the active vault: project vault if present, otherwise the personal vault). " +
      "Matches page title, aliases, headings, id, and excerpt; ranks by field-weighted score. " +
      "Does NOT do graph expansion or cross-vault merge — use `wiki_recall` for that. " +
      "Returns ranked hits with score and matched fields.",
    promptSnippet: "Keyword-search pages in the active LLM Wiki vault",
    parameters: Type.Object({
      query: Type.String({ description: "Search query (tokenized on whitespace/punctuation)." }),
      limit: Type.Optional(
        Type.Integer({
          description: "Max hits to return (default 20).",
          minimum: 1,
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const vaultRoot = targetVaultRoot(ctx.cwd);
      const query = typeof params.query === "string" ? params.query : "";
      const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : undefined;
      const result = recallVault(vaultRoot, query, { ...(limit ? { limit } : {}) });
      const keywordHits: RecallResult = {
        query: result.query,
        vaults: result.vaults,
        hits: result.hits
          .filter((h) => h.matchedBy.includes("keyword"))
          .map((h) => ({ ...h, matchedBy: ["keyword"], signals: undefined, viaSeeds: undefined })),
      };
      const summary = formatSearchSummary(keywordHits, vaultRoot);
      onUpdate?.({ content: [{ type: "text", text: summary }], details: keywordHits });
      return { content: [{ type: "text", text: summary }], details: keywordHits };
    },
  });
}

function registerWikiRecallTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_recall",
    label: "Wiki Recall",
    description:
      "Layered Recall over the LLM Wiki: keyword search + four-signal Graph Relevance expansion (direct link x3, source overlap x4, Adamic-Adar x1.5, type affinity x1), " +
      "merged across BOTH the project vault (if present) and the personal vault. " +
      "Graph expansion surfaces pages the keyword search missed but that are related via wikilinks, shared sources, common neighbours, or page type. " +
      "Cross-vault duplicates (same page id) are collapsed into one entry listing every vault they were found in (primary = highest score). " +
      "Each hit is annotated with which vault(s) it came from and why it matched (keyword | graph).",
    promptSnippet: "Recall relevant pages across both LLM Wiki vaults with graph expansion",
    parameters: Type.Object({
      query: Type.String({ description: "Recall query (tokenized on whitespace/punctuation)." }),
      limit: Type.Optional(
        Type.Integer({
          description: "Max hits to return across the merged set (default 20).",
          minimum: 1,
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const roots = activeVaultRoots(ctx.cwd);
      const query = typeof params.query === "string" ? params.query : "";
      const limit = typeof params.limit === "number" && params.limit > 0 ? params.limit : undefined;
      const result = await recallAcross(roots, query, { ...(limit ? { limit } : {}) });
      const summary = formatRecallSummary(result);
      onUpdate?.({ content: [{ type: "text", text: summary }], details: result });
      return { content: [{ type: "text", text: summary }], details: result };
    },
  });
}

function formatSearchSummary(result: RecallResult, vaultRoot: string): string {
  const header = `Searched "${result.query}" in ${vaultRoot} — ${result.hits.length} hit(s)`;
  if (result.hits.length === 0) return header;
  const lines = [header];
  for (const hit of result.hits) lines.push(formatHitLine(hit));
  return lines.join("\n");
}

function formatRecallSummary(result: RecallResult): string {
  const header = `Recalled "${result.query}" across ${result.vaults.length} vault(s): ${result.vaults.join(", ")} — ${result.hits.length} hit(s)`;
  if (result.hits.length === 0) return header;
  const lines = [header];
  for (const hit of result.hits) lines.push(formatHitLine(hit));
  return lines.join("\n");
}

function formatHitLine(hit: RecallHit): string {
  const title = hit.title ?? hit.id;
  const type = hit.type ?? "untyped";
  const matched = hit.matchedBy.join("+");
  const vault = hit.vaults && hit.vaults.length > 1 ? `vaults: ${hit.vaults.join(", ")}` : `vault: ${hit.vault}`;
  const line = `- [[${hit.id}]] — ${title} (${type}) [score ${hit.score}, ${matched}] (${vault})`;
  const extras: string[] = [];
  if (hit.signals) {
    const parts = Object.entries(hit.signals)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([k, v]) => `${k}=${Number.isInteger(v) ? String(v) : v.toFixed(2)}`);
    if (parts.length > 0) extras.push(`signals: ${parts.join(", ")}`);
  }
  if (hit.matchedFields && hit.matchedFields.length > 0) {
    extras.push(`fields: ${hit.matchedFields.join(", ")}`);
  }
  if (hit.viaSeeds && hit.viaSeeds.length > 0) {
    extras.push(`via: ${hit.viaSeeds.join(", ")}`);
  }
  const out = [line];
  if (extras.length > 0) out.push(`  ${extras.join("; ")}`);
  if (hit.excerpt.length > 0) out.push(`  > ${hit.excerpt}`);
  return out.join("\n");
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

function formatEnsureSummary(result: EnsurePageResult, vaultRoot: string): string {
  const verb = result.created ? `Created ${result.type} page` : `Already exists (resolved by ${result.matchedOn})`;
  const lines = [`${verb}: ${result.id}`, `vault: ${vaultRoot}`, `path: ${result.relPath}`, `title: ${result.title}`];
  if (result.aliases.length > 0) lines.push(`aliases: ${result.aliases.join(", ")}`);
  if (result.sources.length > 0) lines.push(`sources: ${result.sources.join(", ")}`);
  return lines.join("\n");
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
  registerWikiRebuildMetaTool(pi);
  registerWikiEnsurePageTool(pi);
  registerWikiSearchTool(pi);
  registerWikiRecallTool(pi);
}
