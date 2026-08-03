import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createLogger, executeSideCall, isExtensionDisabled } from "@htwang-contrib/common";
import {
  type FetchResponse,
  type FullProvider,
  instantiateProviders,
  isRateLimitError,
  PROVIDERS,
  resolveApiKey,
  type SearchProvider,
} from "@htwang-contrib/web-tools";
import { Type } from "typebox";
import { runCaptureSession } from "./capture-session.ts";
import { loadLlmWikiConfig, registerLlmWikiConfigItems, resolveIngestModel, setCachedModelOptions } from "./config.ts";
import { classifyPathOperation } from "./core/guardrail.ts";
import { type IngestBatchResult, ingestBatch, type SideCaller } from "./core/ingest.ts";
import { applyLintFixes, type LintFixResult, type LintReport, lintVault, writeLintReport } from "./core/lint.ts";
import { rebuildMeta } from "./core/meta.ts";
import { type CaptureInput, type CaptureResult, captureSource, type UrlFetcher } from "./core/packet.ts";
import { type EnsurePageResult, ensurePage } from "./core/page.ts";
import { vaultLayout } from "./core/paths.ts";
import { type RecallHit, type RecallResult, recallAcross, recallVault } from "./core/recall.ts";
import {
  type DeepResearchBatchResult,
  type DeepResearchSearcher,
  deepResearchBatch,
  type ItemResearchOutcome,
} from "./core/research.ts";
import {
  listReviewItems,
  REVIEW_ACTIONS,
  type ReviewAction,
  type ReviewFilterStatus,
  type ReviewItem,
  resolveReviewItem,
} from "./core/review.ts";
import { renderSessionStartNotice, renderStatusSummary, type WikiStatus, wikiStatus } from "./core/status.ts";
import { resolveVaults } from "./core/vault.ts";
import { runIngestSession } from "./ingest-session.ts";
import { runLintSession } from "./lint-session.ts";
import { runResearchSession } from "./research-session.ts";

const logger = createLogger("llm-wiki");

const SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));
const PROMPTS_DIR = fileURLToPath(new URL("../prompts", import.meta.url));

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

function searchCapableProviderNames(): string[] {
  return PROVIDERS.filter((p) => p.roles.includes("search"))
    .map((p) => p.envVar)
    .filter((v): v is string => Boolean(v));
}

function usableSearchProviders(): Array<{ name: string; provider: SearchProvider | FullProvider }> {
  const { providers } = instantiateProviders();
  return providers.filter(({ name }) => Boolean(resolveApiKey(name)));
}

function noSearchProviderMessage(): string {
  return `wiki_deep_research: no search provider is configured. Set one of: ${searchCapableProviderNames().join(
    ", ",
  )} (via /config or the matching env var).`;
}

function hasUsableSearchProvider(): boolean {
  return usableSearchProviders().length > 0;
}

function createWebToolsSearcher(): DeepResearchSearcher {
  return {
    async search(query, maxResults, signal) {
      const usable = usableSearchProviders();
      if (usable.length === 0) throw new Error(noSearchProviderMessage());
      let lastError: Error | undefined;
      for (const { name, provider } of usable) {
        try {
          const response = await provider.search(query, maxResults, signal);
          logger.debug(`searched "${query}" via ${name}`);
          return response.results;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (!isRateLimitError(err)) break;
        }
      }
      throw lastError ?? new Error(`wiki_deep_research: search failed for "${query}"`);
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

function activeVaultOnDisk(cwd: string): string | null {
  const { projectVault, personalVault } = resolveVaults({ cwd });
  if (projectVault && fs.existsSync(projectVault)) return projectVault;
  if (personalVault && fs.existsSync(personalVault)) return personalVault;
  return null;
}

const touchedVaults = new Set<string>();

export function registerWikiCaptureTool(pi: ExtensionAPI): void {
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

function createSideCaller(
  model: NonNullable<ExtensionContext["model"]>,
  modelRegistry: ExtensionContext["modelRegistry"],
): SideCaller {
  return {
    async call({ systemPrompt, userText }, signal) {
      const messages: Message[] = [{ role: "user", content: userText, timestamp: Date.now() } as UserMessage];
      const result = await executeSideCall({
        model,
        modelRegistry,
        systemPrompt,
        messages,
        signal,
        commandName: "wiki_ingest",
      });
      if (result.ok) return { ok: true, text: result.answer };
      if ("aborted" in result) return { ok: false, error: "aborted" };
      return { ok: false, error: result.error };
    },
  };
}

type RunIngestOutcome = IngestBatchResult | { error: string };

async function runIngest(args: {
  ctx: ExtensionContext;
  signal?: AbortSignal;
  packetId?: string;
}): Promise<RunIngestOutcome> {
  const vaultRoot = targetVaultRoot(args.ctx.cwd);
  const model = resolveIngestModel(args.ctx);
  if (!model) {
    return {
      error: "wiki_ingest: no model available — set a session model, or configure the Wiki Ingest Model in /config.",
    };
  }
  const caller = createSideCaller(model, args.ctx.modelRegistry);
  const signal = args.signal ?? new AbortController().signal;
  const { ingestMaxAttempts } = loadLlmWikiConfig();
  return ingestBatch(vaultRoot, {
    caller,
    signal,
    maxAttempts: ingestMaxAttempts,
    ...(args.packetId ? { packetId: args.packetId } : {}),
  });
}

function formatIngestSummary(result: IngestBatchResult, vaultRoot: string): string {
  const lines = [
    `Ingest batch: ${result.ingested} ingested, ${result.failed} failed, ${result.skipped} skipped (${result.processed} processed)`,
    `vault: ${vaultRoot}`,
  ];
  for (const outcome of result.outcomes) {
    const details: string[] = [];
    if (outcome.pagesCreated > 0) details.push(`${outcome.pagesCreated} page(s) created`);
    if (outcome.pagesExisted > 0) details.push(`${outcome.pagesExisted} existed`);
    if (outcome.reviewFiled > 0) details.push(`${outcome.reviewFiled} review item(s)`);
    const extra = details.length > 0 ? ` — ${details.join(", ")}` : "";
    const reason = outcome.reason ? ` — ${outcome.reason}` : "";
    lines.push(`- ${outcome.packetId}: ${outcome.status}${reason}${extra}`);
  }
  return lines.join("\n");
}

export function registerWikiIngestTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_ingest",
    label: "Wiki Ingest",
    description:
      "Batch-ingest pending Source Packets in the active LLM Wiki vault into typed, cited Wiki Pages. " +
      "For each pending packet, runs two side-calls (analysis, then generation) and writes the Source page plus any related concept/entity/synthesis pages, files review items, updates the manifest ingest state, and rebuilds metadata. " +
      "Idempotent and re-entrant: already-ingested packets are skipped; a packet that fails stays pending and is retried on the next call. " +
      "Optional `packetId` (SRC-YYYY-MM-DD-NNN) restricts the run to one packet. Interactive ingest is skill-guided (call wiki_capture / wiki_ensure_page directly).",
    promptSnippet: "Analyze pending Source Packets and generate cited Wiki Pages (batch, side-calls)",
    parameters: Type.Object({
      packetId: Type.Optional(
        Type.String({
          description: "Optional Source Packet id (SRC-YYYY-MM-DD-NNN) to ingest. Omit to ingest every pending packet.",
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const result = await runIngest({ ctx, signal, ...(params.packetId ? { packetId: params.packetId } : {}) });
      if ("error" in result) {
        return { content: [{ type: "text", text: result.error }], details: { error: result.error } };
      }
      const vaultRoot = targetVaultRoot(ctx.cwd);
      const summary = formatIngestSummary(result, vaultRoot);
      onUpdate?.({ content: [{ type: "text", text: summary }], details: result });
      return { content: [{ type: "text", text: summary }], details: { ...result, vaultRoot } };
    },
  });
}

function registerWikiIngestCommand(pi: ExtensionAPI): void {
  pi.registerCommand("wiki-ingest", {
    description:
      "Run batch wiki ingest in an isolated side-call: spawns a child session that registers ONLY the wiki_ingest tool (so the ingest tool never lives in the main conversation), analyzes + generates Wiki Pages for every pending Source Packet, and reports the summary. Optional arg: a specific packet id. Interactive ingest is skill-guided.",
    async handler(args, ctx) {
      const packetId = args.trim() || undefined;
      ctx.ui.notify("/wiki-ingest: starting side-call\u2026", "info");
      ctx.ui.setWorkingMessage(packetId ? `ingesting ${packetId}\u2026` : "ingesting pending sources\u2026");
      try {
        const result = await runIngestSession(ctx, { ...(packetId ? { packetId } : {}) }, undefined, (n) =>
          ctx.ui.notify(`/wiki-ingest: ${n} tool call(s)\u2026`, "info"),
        );
        ctx.ui.notify(
          result.isError ? (result.errorMessage ?? "wiki ingest failed") : result.text,
          result.isError ? "error" : "info",
        );
        logger.info(`wiki ingest side-call: ${result.toolCalls} tool call(s), session ${result.subSessionFile ?? "?"}`);
        deliverSideCallToAgent(pi, ctx, "/wiki-ingest", result);
      } finally {
        ctx.ui.setWorkingMessage(undefined);
      }
    },
  });
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

interface ReviewToolParams {
  action: "list" | "resolve";
  status?: ReviewFilterStatus;
  itemId?: string;
  decision?: ReviewAction;
  note?: string;
}

function resolveActiveVault(cwd: string): { vaultRoot: string; scope: string } {
  const { projectVault, personalVault } = resolveVaults({ cwd });
  if (projectVault) return { vaultRoot: projectVault, scope: "project vault" };
  return { vaultRoot: personalVault, scope: "personal vault" };
}

export function registerWikiReviewTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_review",
    label: "Wiki Review",
    description:
      "List and resolve items in the LLM Wiki Review Queue (meta/review.jsonl) for the active vault " +
      "(project vault if present, otherwise the personal vault). During ingest the agent files items needing human judgment " +
      "(one per claim/gap, with a suggested action); this tool reads them back and records a decision.\n" +
      "- action=list: returns open items by default. Pass status=all to include resolved entries, or status=resolved for only resolved.\n" +
      "- action=resolve: marks one item resolved with one of three constrained decisions: `create_page` | `deep_research` | `skip`. " +
      "Recording a decision only updates the queue; the actual page creation / web research is performed in-session by the agent " +
      "(guided by the bundled skill). Resolved items no longer appear in the default open list.",
    promptSnippet: "List or resolve the LLM Wiki Review Queue (actions: create_page/deep_research/skip)",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("resolve")], {
        description: "Operation: list (read items) | resolve (record a decision on one item).",
      }),
      status: Type.Optional(
        Type.Union([Type.Literal("open"), Type.Literal("resolved"), Type.Literal("all")], {
          description: "list only. Status filter. Defaults to open.",
        }),
      ),
      itemId: Type.Optional(Type.String({ description: "resolve only. The review item id (REV-...) to resolve." })),
      decision: Type.Optional(
        Type.Union([Type.Literal("create_page"), Type.Literal("deep_research"), Type.Literal("skip")], {
          description: "resolve only. The decision to record. One of create_page | deep_research | skip.",
        }),
      ),
      note: Type.Optional(
        Type.String({
          description: "resolve only. Optional free-text note recording what was done (e.g. created page path).",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const { vaultRoot, scope } = resolveActiveVault(ctx.cwd);
      const p = params as ReviewToolParams;

      if (p.action === "list") {
        const status: ReviewFilterStatus = p.status ?? "open";
        const items = listReviewItems(vaultRoot, { status });
        const summary = formatReviewListSummary(scope, items, status);
        const details = { vaultRoot, scope, status, count: items.length, items };
        onUpdate?.({ content: [{ type: "text", text: summary }], details });
        return { content: [{ type: "text", text: summary }], details };
      }

      const itemId = requireReviewString(p.itemId, "itemId");
      if (p.decision === undefined) {
        throw new Error(
          `wiki_review: \`decision\` is required when action=resolve (one of ${REVIEW_ACTIONS.join(", ")})`,
        );
      }
      const resolved = resolveReviewItem(vaultRoot, itemId, p.decision, {
        ...(p.note !== undefined && p.note.length > 0 ? { note: p.note } : {}),
      });
      const remaining = listReviewItems(vaultRoot, { status: "open" }).length;
      const summary = formatReviewResolveSummary(scope, vaultRoot, resolved, remaining);
      const details = { vaultRoot, scope, resolved, remainingOpen: remaining };
      onUpdate?.({ content: [{ type: "text", text: summary }], details });
      return { content: [{ type: "text", text: summary }], details };
    },
  });
}

function requireReviewString(value: string | undefined, field: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`wiki_review: \`${field}\` is required when action=resolve`);
  }
  return value.trim();
}

function formatReviewListSummary(scope: string, items: ReviewItem[], status: ReviewFilterStatus): string {
  const label = status === "all" ? "all" : status;
  if (items.length === 0) {
    return `Review queue (${scope}): no ${label} items.`;
  }
  const lines = [`Review queue (${scope}): ${items.length} ${label} item${items.length === 1 ? "" : "s"}`];
  for (const item of items) {
    const flag = item.status === "resolved" ? `[resolved=${item.resolvedAction ?? "?"}]` : `[${item.action}]`;
    lines.push(`- ${item.id} ${flag} ${item.title} (${item.kind})`);
    lines.push(`  packet: ${item.packetId}`);
    if (item.query) lines.push(`  search: ${item.query}`);
    if (item.note) lines.push(`  note: ${item.note}`);
  }
  return lines.join("\n");
}

function formatReviewResolveSummary(scope: string, vaultRoot: string, resolved: ReviewItem, remaining: number): string {
  const lines = [
    `Resolved ${resolved.id} as ${resolved.resolvedAction} (${scope})`,
    `vault: ${vaultRoot}`,
    `remaining open: ${remaining}`,
  ];
  if (resolved.resolutionNote) lines.push(`note: ${resolved.resolutionNote}`);
  return lines.join("\n");
}

const REVIEW_CHOICE_STOP = "Stop";
const REVIEW_CHOICES: ReadonlyArray<readonly [string, ReviewAction]> = [
  ["Create page", "create_page"],
  ["Deep research", "deep_research"],
  ["Skip", "skip"],
];

function registerWikiReviewCommand(pi: ExtensionAPI): void {
  pi.registerCommand("wiki-review", {
    description:
      "Walk pending LLM Wiki Review Queue items one by one and record a decision " +
      "(create_page / deep_research / skip) for the active vault.",
    async handler(_args, ctx) {
      const { vaultRoot, scope } = resolveActiveVault(ctx.cwd);
      const open = listReviewItems(vaultRoot, { status: "open" });

      if (open.length === 0) {
        ctx.ui.notify(`No open review items (${scope}).`, "info");
        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify(formatReviewListSummary(scope, open, "open"), "info");
        ctx.ui.notify("Run /wiki-review in an interactive terminal to resolve items.", "info");
        return;
      }

      const optionLabels = [...REVIEW_CHOICES.map(([label]) => label), REVIEW_CHOICE_STOP];
      let resolvedCount = 0;

      for (let i = 0; i < open.length; i++) {
        const entry = open[i]!;
        const choice = await ctx.ui.select(formatReviewItemPrompt(scope, entry, i + 1, open.length), [...optionLabels]);
        if (choice === undefined || choice === REVIEW_CHOICE_STOP) {
          ctx.ui.notify(`Stopped. ${open.length - i} item(s) still open (${resolvedCount} resolved).`, "info");
          return;
        }
        const action = REVIEW_CHOICES.find(([label]) => label === choice)?.[1];
        if (!action) {
          ctx.ui.notify("Unrecognized choice; stopping.", "warning");
          return;
        }

        const note = await promptReviewNote(ctx, entry.id, action);
        resolveReviewItem(vaultRoot, entry.id, action, note !== undefined ? { note } : {});
        resolvedCount += 1;
        ctx.ui.notify(`Resolved ${entry.id} as ${action} (${resolvedCount}/${open.length}).`, "info");
      }

      ctx.ui.notify(`All open review items resolved (${resolvedCount}).`, "info");
    },
  });
}

async function promptReviewNote(
  ctx: ExtensionContext,
  itemId: string,
  action: ReviewAction,
): Promise<string | undefined> {
  if (action === "skip") return undefined;
  const entered = await ctx.ui.input(
    `Optional note for ${itemId} (${action}) — e.g. created page path or research plan:`,
    "",
  );
  const trimmed = entered?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function formatReviewItemPrompt(scope: string, entry: ReviewItem, position: number, total: number): string {
  const lines = [
    `Review queue (${scope}) — item ${position}/${total}`,
    entry.id,
    `Title: ${entry.title}`,
    `Kind: ${entry.kind}`,
    `Suggested action: ${entry.action}`,
    `Packet: ${entry.packetId}`,
  ];
  if (entry.query) lines.push(`Search: ${entry.query}`);
  if (entry.note) lines.push(`Note: ${entry.note}`);
  lines.push("Choose an action:");
  return lines.join("\n");
}

type RunDeepResearchOutcome = DeepResearchBatchResult | { error: string };

async function runDeepResearch(args: {
  ctx: ExtensionContext;
  signal?: AbortSignal;
  reviewItemId?: string;
  maxResults?: number;
}): Promise<RunDeepResearchOutcome> {
  const model = resolveIngestModel(args.ctx);
  if (!model) {
    return {
      error:
        "wiki_deep_research: no model available — set a session model, or configure the Wiki Ingest Model in /config.",
    };
  }
  if (!hasUsableSearchProvider()) {
    return { error: noSearchProviderMessage() };
  }

  const vaultRoot = targetVaultRoot(args.ctx.cwd);
  const config = loadLlmWikiConfig();
  const perCall = typeof args.maxResults === "number" && args.maxResults > 0 ? Math.floor(args.maxResults) : undefined;
  const maxResults = perCall ?? config.deepResearchMaxResults;
  const sourcesDir = vaultLayout(vaultRoot).sourcesRoot;
  const urlFetcher = createWebToolsUrlFetcher();

  return deepResearchBatch(vaultRoot, {
    searcher: createWebToolsSearcher(),
    capturer: {
      async captureUrl(url, signal) {
        return captureSource({ sourceType: "url", url }, { sourcesDir, urlFetcher, signal });
      },
    },
    ingester: {
      async ingest(signal) {
        const result = await runIngest({ ctx: args.ctx, signal });
        if ("error" in result) throw new Error(result.error);
        return result;
      },
    },
    signal: args.signal,
    maxResults,
    ...(args.reviewItemId ? { itemId: args.reviewItemId } : {}),
  });
}

function formatDeepResearchItemLine(outcome: ItemResearchOutcome): string {
  const parts = [
    `searched ${outcome.searched}`,
    `captured ${outcome.captured}`,
    `existed ${outcome.existed}`,
    `ingested ${outcome.ingested}`,
  ];
  let line = `- ${outcome.itemId} [${outcome.status}] ${parts.join(", ")}`;
  if (outcome.note) line += ` — ${outcome.note}`;
  return line;
}

function formatDeepResearchSummary(result: DeepResearchBatchResult): string {
  const lines = [
    `Deep research: ${result.resolved} resolved, ${result.leftOpen} left open, ${result.skipped} skipped (${result.processed} item(s))`,
    `vault: ${result.vaultRoot}`,
  ];
  for (const outcome of result.outcomes) lines.push(formatDeepResearchItemLine(outcome));
  return lines.join("\n");
}

export function registerWikiDeepResearchTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_deep_research",
    label: "Wiki Deep Research",
    description:
      "Run the Deep Research pipeline for the active LLM Wiki vault: for each open `deep_research` Review Queue item with a pre-built query, search the web (via the configured web-tools provider chain), capture each result URL into a Source Packet (idempotent by URL), batch-ingest the new packets into cited Wiki Pages, and resolve the item when at least one packet ingests. " +
      "Re-entrant: re-running skips already-captured URLs and already-ingested packets and continues the unfinished ones. " +
      "Best-effort: an item is left open when every packet fails to ingest; items with no query are skipped (recorded, never blocking). " +
      "Optional `reviewItemId` restricts the run to one item; optional `maxResults` overrides the configured top-N (default 5). `/wiki-review` stays a decision-only ledger — this tool performs the research.",
    promptSnippet: "Auto-close open deep_research review items: web search -> capture -> ingest -> resolve",
    parameters: Type.Object({
      reviewItemId: Type.Optional(
        Type.String({
          description:
            "Optional Review Queue item id (REV-...) to research. Omit to process every open deep_research item in the active vault.",
        }),
      ),
      maxResults: Type.Optional(
        Type.Integer({
          description: "Optional top-N web results to capture per item (overrides the configured default of 5).",
          minimum: 1,
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const result = await runDeepResearch({
        ctx,
        signal,
        ...(typeof params.reviewItemId === "string" && params.reviewItemId.trim().length > 0
          ? { reviewItemId: params.reviewItemId.trim() }
          : {}),
        ...(typeof params.maxResults === "number" ? { maxResults: params.maxResults } : {}),
      });
      if ("error" in result) {
        return { content: [{ type: "text", text: result.error }], details: { error: result.error } };
      }
      const summary = formatDeepResearchSummary(result);
      onUpdate?.({ content: [{ type: "text", text: summary }], details: result });
      return { content: [{ type: "text", text: summary }], details: result };
    },
  });
}

function registerWikiResearchCommand(pi: ExtensionAPI): void {
  pi.registerCommand("wiki-research", {
    description:
      "Run the Deep Research pipeline in an isolated side-call for every open deep_research Review Queue item in the active vault (search -> capture -> ingest -> resolve). Optional arg: a specific review item id.",
    async handler(args, ctx) {
      const reviewItemId = args.trim() || undefined;
      ctx.ui.notify("/wiki-research: starting side-call\u2026", "info");
      ctx.ui.setWorkingMessage(
        reviewItemId ? `researching ${reviewItemId}\u2026` : "researching deep_research items\u2026",
      );
      try {
        const result = await runResearchSession(ctx, { ...(reviewItemId ? { reviewItemId } : {}) }, undefined, (n) =>
          ctx.ui.notify(`/wiki-research: ${n} tool call(s)\u2026`, "info"),
        );
        ctx.ui.notify(
          result.isError ? (result.errorMessage ?? "wiki research failed") : result.text,
          result.isError ? "error" : "info",
        );
        logger.info(
          `wiki research side-call: ${result.toolCalls} tool call(s), session ${result.subSessionFile ?? "?"}`,
        );
        deliverSideCallToAgent(pi, ctx, "/wiki-research", result);
      } finally {
        ctx.ui.setWorkingMessage(undefined);
      }
    },
  });
}

function emitSessionStartNotice(ctx: ExtensionContext): void {
  if (!loadLlmWikiConfig().sessionStartNotice) return;
  const vault = activeVaultOnDisk(ctx.cwd);
  if (!vault) return;
  const status = wikiStatus(vault);
  ctx.ui.notify(renderSessionStartNotice(status), "info");
}

interface LintRun {
  report: LintReport;
  reportPath: string;
  fixResult: LintFixResult | null;
  summary: string;
}

async function runLint(vaultRoot: string, fix: boolean): Promise<LintRun> {
  const initial = lintVault(vaultRoot);
  let fixResult: LintFixResult | null = null;
  if (fix) fixResult = await applyLintFixes(vaultRoot, initial);
  const report = fixResult?.report ?? initial;
  const reportPath = writeLintReport(vaultRoot, report);
  return { report, reportPath, fixResult, summary: formatLintSummary(report, reportPath, fixResult) };
}

function formatLintSummary(report: LintReport, reportPath: string, fixResult: LintFixResult | null): string {
  const lines = [
    `Linted ${report.vault}: ${report.summary.total} issues (${report.summary.errors} errors, ${report.summary.warnings} warnings)`,
    `report: ${reportPath}`,
  ];
  for (const [kind, count] of Object.entries(report.summary.byKind)) {
    if (count > 0) lines.push(`- ${kind}: ${count}`);
  }
  if (fixResult) {
    const captured = fixResult.captured.map((c) => c.relPath).join(", ");
    lines.push(
      `fix: captured ${fixResult.captured.length} inbox file(s)${captured ? ` (${captured})` : ""}, ${fixResult.remaining} issue(s) remaining`,
    );
  }
  return lines.join("\n");
}

export function registerWikiLintTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_lint",
    label: "Wiki Lint",
    description:
      "Run mechanical health checks on the active LLM Wiki vault (project if present, otherwise the personal vault) and write `meta/lint-report.md`. " +
      "Checks: orphan pages (no incoming wikilinks), broken wikilinks, duplicate aliases across pages, coverage gaps (pages citing unknown Source Packets + ingested packets cited by no page), and Inbox drift (uncaptured files + modified originals). " +
      "Pass `fix: true` to auto-capture uncaptured Inbox files (the only safe, deterministic repair); structural findings are report-only and need human judgment.",
    promptSnippet:
      "Health-check the wiki and write meta/lint-report.md (orphans, broken links, dup aliases, coverage gaps, inbox drift)",
    parameters: Type.Object({
      fix: Type.Optional(
        Type.Boolean({
          description: "If true, apply safe fixes — capture uncaptured Inbox files into Source Packets. Default false.",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const vaultRoot = targetVaultRoot(ctx.cwd);
      const run = await runLint(vaultRoot, params.fix === true);
      const details = { summary: run.report.summary, reportPath: run.reportPath, fixResult: run.fixResult };
      onUpdate?.({ content: [{ type: "text", text: run.summary }], details });
      return { content: [{ type: "text", text: run.summary }], details };
    },
  });
}

function registerWikiStatusTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wiki_status",
    label: "Wiki Status",
    description:
      "Report the state of the active LLM Wiki vault (project if present, otherwise the personal vault): page/source counts, pages by Page Type, pending ingests, unresolved review-queue items, Inbox drift counts, and recent events from `meta/events.jsonl`.",
    promptSnippet: "Report wiki status (counts, pending ingest/review, inbox drift, recent events)",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, onUpdate, ctx) {
      const vaultRoot = targetVaultRoot(ctx.cwd);
      const status: WikiStatus = wikiStatus(vaultRoot);
      const summary = renderStatusSummary(status);
      onUpdate?.({ content: [{ type: "text", text: summary }], details: status });
      return { content: [{ type: "text", text: summary }], details: status };
    },
  });
}

function deliverSideCallToAgent(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  label: string,
  result: { isError: boolean; text: string; errorMessage?: string },
): void {
  const note = result.isError
    ? `[llm-wiki] ${label} side-call failed: ${result.errorMessage ?? "unknown error"}`
    : `[llm-wiki] ${label} side-call finished.\n${result.text}`;
  if (ctx.isIdle()) {
    pi.sendUserMessage(note);
  } else {
    ctx.ui.notify(note, result.isError ? "error" : "info");
  }
}

function registerWikiCaptureCommand(pi: ExtensionAPI): void {
  pi.registerCommand("wiki-capture", {
    description:
      "Capture a source into the LLM Wiki via an isolated side-call: spawns a child session that registers ONLY the wiki_capture tool (so the capture tool never lives in the main conversation), captures the source into an immutable Source Packet, and reports the packet id. Argument: a URL, a local .md/.txt path, or pasted text.",
    async handler(args, ctx) {
      const source = args.trim();
      if (!source) {
        ctx.ui.notify("Usage: /wiki-capture <url | file path | text>", "warning");
        return;
      }
      ctx.ui.notify("/wiki-capture: starting side-call\u2026", "info");
      ctx.ui.setWorkingMessage("capturing source\u2026");
      try {
        const result = await runCaptureSession(ctx, { source }, undefined, (n) =>
          ctx.ui.notify(`/wiki-capture: ${n} tool call(s)\u2026`, "info"),
        );
        ctx.ui.notify(
          result.isError ? (result.errorMessage ?? "wiki capture failed") : result.text,
          result.isError ? "error" : "info",
        );
        logger.info(
          `wiki capture side-call: ${result.toolCalls} tool call(s), session ${result.subSessionFile ?? "?"}`,
        );
      } finally {
        ctx.ui.setWorkingMessage(undefined);
      }
    },
  });
}

function registerWikiSlashCommands(pi: ExtensionAPI): void {
  pi.registerCommand("wiki-lint", {
    description:
      "Run wiki lint in an isolated side-call and write meta/lint-report.md. Append --fix to auto-capture uncaptured inbox files.",
    async handler(args, ctx) {
      const fix = /\b--fix\b/.test(args);
      ctx.ui.notify("/wiki-lint: starting side-call\u2026", "info");
      ctx.ui.setWorkingMessage(fix ? "linting + fixing\u2026" : "linting\u2026");
      try {
        const result = await runLintSession(ctx, { fix }, undefined, (n) =>
          ctx.ui.notify(`/wiki-lint: ${n} tool call(s)\u2026`, "info"),
        );
        ctx.ui.notify(
          result.isError ? (result.errorMessage ?? "wiki lint failed") : result.text,
          result.isError ? "error" : "info",
        );
        logger.info(`wiki lint side-call: ${result.toolCalls} tool call(s), session ${result.subSessionFile ?? "?"}`);
        deliverSideCallToAgent(pi, ctx, "/wiki-lint", result);
      } finally {
        ctx.ui.setWorkingMessage(undefined);
      }
    },
  });

  pi.registerCommand("wiki-status", {
    description: "Print the active vault's wiki status (counts, pending ingest/review, inbox drift, recent events).",
    async handler(_args, ctx) {
      const vaultRoot = targetVaultRoot(ctx.cwd);
      ctx.ui.notify(renderStatusSummary(wikiStatus(vaultRoot)), "info");
    },
  });
}

export default function initLlmWiki(pi: ExtensionAPI): void {
  if (isExtensionDisabled("llm-wiki")) return;
  logger.info("extension loaded");

  registerLlmWikiConfigItems();

  pi.on("resources_discover", () => ({ skillPaths: [SKILLS_DIR], promptPaths: [PROMPTS_DIR] }));
  pi.on("session_start", (_event, ctx) => {
    touchedVaults.clear();
    setCachedModelOptions(
      ctx.modelRegistry.getAvailable().map((m) => ({
        label: `${m.provider}/${m.id}`,
        value: `${m.provider}/${m.id}`,
      })),
    );
    try {
      emitSessionStartNotice(ctx);
    } catch (err) {
      logger.debug(`session-start notice failed: ${String(err)}`);
    }
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

  registerWikiCaptureCommand(pi);
  registerWikiRebuildMetaTool(pi);
  registerWikiEnsurePageTool(pi);
  registerWikiSearchTool(pi);
  registerWikiRecallTool(pi);
  registerWikiIngestCommand(pi);
  registerWikiResearchCommand(pi);
  registerWikiReviewCommand(pi);
  registerWikiStatusTool(pi);
  registerWikiSlashCommands(pi);
}
