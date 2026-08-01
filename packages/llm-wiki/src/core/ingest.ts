import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { appendJsonl, atomicWriteFile } from "./atomic.ts";
import { PAGE_TYPES, type PageType } from "./bootstrap.ts";
import { parseFrontmatter, splitFrontmatter } from "./frontmatter.ts";
import { MANIFEST_FILENAME, readManifest, type SourcePacketManifest, writeManifest } from "./manifest.ts";
import { buildRegistry, type RegistryDoc, rebuildMeta } from "./meta.ts";
import { ensurePage } from "./page.ts";
import { vaultLayout } from "./paths.ts";
import { appendReviewItem, listReviewItems, REVIEW_ACTIONS, type ReviewAction } from "./review.ts";
import { resolveNow } from "./time.ts";

const ANALYSIS_FENCE = /```wiki-analysis[^\n]*\n([\s\S]*?)\n```/;
const PAGE_FENCE = /```wiki-page:([a-zA-Z]+)[^\n]*\n([\s\S]*?)\n```/g;
const OVERVIEW_FENCE = /```wiki-overview[^\n]*\n([\s\S]*?)\n```/;

export interface AnalysisConcept {
  title: string;
  note?: string;
}

export interface AnalysisEntity {
  title: string;
  kind?: string;
  note?: string;
}

export interface AnalysisSynthesis {
  title: string;
  note?: string;
}

export interface AnalysisContradiction {
  against: string;
  note?: string;
}

export interface AnalysisReviewItem {
  kind: string;
  title: string;
  action: ReviewAction;
  note?: string;
  query?: string;
}

export interface AnalysisResult {
  summary: string;
  entities: AnalysisEntity[];
  concepts: AnalysisConcept[];
  syntheses: AnalysisSynthesis[];
  contradictions: AnalysisContradiction[];
  links: string[];
  review: AnalysisReviewItem[];
}

export interface PageSpec {
  type: PageType;
  title: string;
  body: string;
  sources: string[];
}

export interface GenerationResult {
  pages: PageSpec[];
  overview?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function safeParseYaml(text: string): Record<string, unknown> {
  try {
    const parsed = parseYaml(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const trimmed = entry.trim();
      if (trimmed.length > 0) out.push(trimmed);
    }
  }
  return out;
}

function coerceAction(value: unknown): ReviewAction {
  if (typeof value === "string" && (REVIEW_ACTIONS as readonly string[]).includes(value)) {
    return value as ReviewAction;
  }
  return "skip";
}

function coerceAnalysisReviewItem(raw: unknown): AnalysisReviewItem | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const title = asString(record.title);
  const kind = asString(record.kind);
  if (!title || !kind) return null;
  const item: AnalysisReviewItem = { kind, title, action: coerceAction(record.action) };
  const note = asString(record.note);
  if (note) item.note = note;
  const query = asString(record.query);
  if (query) item.query = query;
  return item;
}

function coerceAnalysisList<T>(value: unknown, coerce: (raw: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    const item = coerce(entry);
    if (item) out.push(item);
  }
  return out;
}

function coerceNamedList(value: unknown): Array<{ title: string; note?: string; kind?: string }> {
  return coerceAnalysisList(value, (raw): { title: string; note?: string; kind?: string } | null => {
    if (raw === null || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    const title = asString(record.title);
    if (!title) return null;
    const out: { title: string; note?: string; kind?: string } = { title };
    const note = asString(record.note);
    if (note) out.note = note;
    const kind = asString(record.kind);
    if (kind) out.kind = kind;
    return out;
  });
}

function coerceContradictions(value: unknown): AnalysisContradiction[] {
  return coerceAnalysisList(value, (raw): AnalysisContradiction | null => {
    if (raw === null || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    const against = asString(record.against);
    if (!against) return null;
    const out: AnalysisContradiction = { against };
    const note = asString(record.note);
    if (note) out.note = note;
    return out;
  });
}

export function parseAnalysis(text: string): AnalysisResult | null {
  const match = ANALYSIS_FENCE.exec(text);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(match[1] ?? "");
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const summary = asString(record.summary) ?? "";
  const entities = coerceNamedList(record.entities).map((e) => {
    const out: AnalysisEntity = { title: e.title };
    if (e.note) out.note = e.note;
    if (e.kind) out.kind = e.kind;
    return out;
  });
  const concepts = coerceNamedList(record.concepts).map((c) => {
    const out: AnalysisConcept = { title: c.title };
    if (c.note) out.note = c.note;
    return out;
  });
  const syntheses = coerceNamedList(record.syntheses).map((s) => {
    const out: AnalysisSynthesis = { title: s.title };
    if (s.note) out.note = s.note;
    return out;
  });
  const contradictions = coerceContradictions(record.contradictions);
  const links = asStringArray(record.links);
  const review = coerceAnalysisList(record.review, coerceAnalysisReviewItem);

  return { summary, entities, concepts, syntheses, contradictions, links, review };
}

function isPageType(value: unknown): value is PageType {
  return typeof value === "string" && (PAGE_TYPES as readonly string[]).includes(value);
}

export function parseGeneration(text: string): GenerationResult | null {
  const pages: PageSpec[] = [];
  let matched = false;
  for (const match of text.matchAll(PAGE_FENCE)) {
    matched = true;
    const declaredType = match[1];
    const body = match[2] ?? "";
    const spec = buildPageSpec(body, declaredType);
    if (spec) pages.push(spec);
  }
  if (!matched) return null;

  const overviewMatch = OVERVIEW_FENCE.exec(text);
  const overview = overviewMatch ? (overviewMatch[1] ?? "") : undefined;

  return overview !== undefined ? { pages, overview } : { pages };
}

function buildPageSpec(rawPage: string, declaredType: string | undefined): PageSpec | null {
  const { fm, body } = parseFrontmatter(rawPage);
  const type = (fm?.type ?? declaredType) as unknown;
  if (!isPageType(type)) return null;
  const title = fm?.title?.trim();
  if (!title) return null;
  const sources = fm?.sources ?? [];
  return { type, title, body, sources };
}

export interface SideCallInput {
  systemPrompt: string;
  userText: string;
}

export type SideCallOutcome = { ok: true; text: string } | { ok: false; error: string };

export interface SideCaller {
  call(input: SideCallInput, signal: AbortSignal): Promise<SideCallOutcome>;
}

export interface PacketIngestOutcome {
  packetId: string;
  status: "ingested" | "skipped" | "failed";
  reason?: string;
  pagesCreated: number;
  pagesExisted: number;
  reviewFiled: number;
}

export interface IngestBatchResult {
  processed: number;
  ingested: number;
  skipped: number;
  failed: number;
  outcomes: PacketIngestOutcome[];
}

export const DEFAULT_INGEST_MAX_ATTEMPTS = 3;

export interface IngestBatchOptions {
  caller: SideCaller;
  signal?: AbortSignal;
  now?: Date | (() => Date);
  packetId?: string;
  maxAttempts?: number;
}

export function listPendingPackets(vaultRoot: string): SourcePacketManifest[] {
  const sourcesRoot = vaultLayout(vaultRoot).sourcesRoot;
  if (!fs.existsSync(sourcesRoot)) return [];
  const out: SourcePacketManifest[] = [];
  for (const name of fs.readdirSync(sourcesRoot).sort()) {
    if (!name.startsWith("SRC-")) continue;
    const dir = path.join(sourcesRoot, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    if (!fs.existsSync(path.join(dir, MANIFEST_FILENAME))) continue;
    let manifest: SourcePacketManifest;
    try {
      manifest = readManifest(dir);
    } catch {
      continue;
    }
    if (manifest.ingest.status === "pending") out.push(manifest);
  }
  return out;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function readExtractedText(packetDir: string): string {
  return fs.readFileSync(path.join(packetDir, "extracted.md"), "utf8");
}

function readPurpose(vaultRoot: string): string {
  const file = vaultLayout(vaultRoot).purpose;
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function renderWikiDigest(registry: RegistryDoc): string {
  const lines: string[] = [];
  const pageCount = registry.pages.length;
  const sourceCount = registry.sources.length;
  lines.push(`Existing wiki: ${pageCount} pages, ${sourceCount} sources.`);
  if (pageCount > 0) {
    lines.push("", "Pages:");
    const cap = registry.pages.slice(0, 200);
    for (const page of cap) {
      const title = page.title ?? page.id;
      lines.push(`- [[${page.id}]] (${page.type ?? "untyped"}) ${title}`);
    }
    if (pageCount > cap.length) lines.push(`... and ${pageCount - cap.length} more.`);
  }
  return lines.join("\n");
}

function buildExistingDigest(vaultRoot: string): string {
  try {
    return renderWikiDigest(buildRegistry(vaultRoot));
  } catch {
    return "Existing wiki: (unavailable)";
  }
}

const ANALYSIS_SYSTEM_PROMPT = [
  "You are the ANALYSIS step of an LLM Wiki ingest. STEP: analysis.",
  "",
  "Read ONE Raw Source (provided below) and produce a structured analysis that the",
  "generation step will turn into Wiki Pages. You are also given the vault Purpose and a",
  "digest of the existing wiki, so you can relate this source to existing pages and flag",
  "contradictions against them.",
  "",
  "Output EXACTLY ONE fenced code block tagged `wiki-analysis` containing a single JSON",
  "object with this shape (omit no key; use empty arrays when empty):",
  "{",
  '  "summary": "one-paragraph digest of what THIS source says",',
  '  "entities": [{ "title": "...", "kind": "person|org|product|paper", "note": "..." }],',
  '  "concepts": [{ "title": "...", "note": "..." }],',
  '  "syntheses": [{ "title": "...", "note": "..." }],',
  '  "contradictions": [{ "against": "existing page id or source", "note": "..." }],',
  '  "links": ["existing-page-id", ...],',
  '  "review": [{ "kind": "...", "title": "...", "action": "create_page|deep_research|skip", "note": "...", "query": "prebuilt search query" }]',
  "}",
  "",
  "Rules:",
  '- `links` are EXISTING wiki page ids this source relates to (e.g. "concepts/foo").',
  "- `review` items are things needing human judgment. `action` MUST be one of",
  '  "create_page", "deep_research", "skip".',
  "- Emit the JSON inside the fence only. No prose outside the fence.",
].join("\n");

function buildAnalysisUser(opts: { purpose: string; digest: string; packetId: string; extracted: string }): string {
  return [
    "## Vault Purpose",
    "",
    opts.purpose.trim() || "(no purpose.md)",
    "",
    "## Existing wiki digest",
    "",
    opts.digest,
    "",
    `## Raw Source (packet ${opts.packetId})`,
    "",
    opts.extracted,
  ].join("\n");
}

const GENERATION_SYSTEM_PROMPT = [
  "You are the GENERATION step of an LLM Wiki ingest. STEP: generation.",
  "",
  "Turn the analysis into Wiki Page content. You are given the analysis, the raw source",
  "text, and the vault Purpose.",
  "",
  "Output ONE fenced block per page. The FIRST block MUST be a `source` page digesting",
  "THIS ONE Raw Source. Then emit one block per related concept/entity/synthesis page to",
  "create or update.",
  "",
  "Each block opens with a fence tagged `wiki-page:<type>` where <type> is one of:",
  `${PAGE_TYPES.join(", ")}. The block body is a full markdown page: YAML frontmatter`,
  "(keys: type, title, sources[]) then the page body. Cite the source in the body with a",
  "wikilink of the form [[sources/SRC-...]].",
  "",
  "Optionally emit one `wiki-overview` block containing the full, updated wiki/overview.md.",
  "",
  "Emit only the fenced blocks. No prose outside them.",
].join("\n");

function buildGenerationUser(opts: {
  purpose: string;
  packetId: string;
  extracted: string;
  analysis: AnalysisResult;
}): string {
  return [
    "## Vault Purpose",
    "",
    opts.purpose.trim() || "(no purpose.md)",
    "",
    `## Analysis for packet ${opts.packetId}`,
    "",
    "```wiki-analysis",
    JSON.stringify(opts.analysis, null, 2),
    "```",
    "",
    "## Raw Source",
    "",
    opts.extracted,
  ].join("\n");
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function yamlSeq(items: string[]): string {
  if (items.length === 0) return "[]";
  return `[${items.map(yamlScalar).join(", ")}]`;
}

function composePageContent(type: PageType, title: string, sources: string[], body: string): string {
  const frontmatter = [
    "---",
    `type: ${type}`,
    `title: ${yamlScalar(title)}`,
    "aliases: []",
    `sources: ${yamlSeq(sources)}`,
    "---",
    "",
  ].join("\n");
  return `${frontmatter}${body.trim()}
`;
}

interface AppliedPage {
  created: boolean;
  id: string;
}

function applyPageSpec(vaultRoot: string, spec: PageSpec, packetId: string): AppliedPage {
  const sources = uniqueStrings([...spec.sources, packetId]);
  const ensured = ensurePage(vaultRoot, { type: spec.type, title: spec.title, sources });
  if (ensured.created) {
    const content = composePageContent(spec.type, ensured.title, sources, spec.body);
    atomicWriteFile(ensured.path, content);
  } else {
    unionSourcesIntoPage(ensured.path, sources);
  }
  return { created: ensured.created, id: ensured.id };
}

function unionSourcesIntoPage(filePath: string, sources: string[]): void {
  const content = fs.readFileSync(filePath, "utf8");
  const { frontmatter, body } = splitFrontmatter(content);
  const parsed = frontmatter === null ? {} : safeParseYaml(frontmatter);
  const merged = uniqueStrings([...asStringArray(parsed.sources), ...sources]);
  const serialized = stringifyYaml({ ...parsed, sources: merged }).trimEnd();
  atomicWriteFile(filePath, `---\n${serialized}\n---\n${body}`);
}

function fileAnalysisReviewItems(vaultRoot: string, packetId: string, analysis: AnalysisResult, now: Date): number {
  const seen = new Set(
    listReviewItems(vaultRoot)
      .filter((item) => item.packetId === packetId)
      .map((item) => reviewDedupKey(item.kind, item.title, item.action)),
  );
  let count = 0;
  for (const item of analysis.review) {
    const key = reviewDedupKey(item.kind, item.title, item.action);
    if (seen.has(key)) continue;
    seen.add(key);
    appendReviewItem(
      vaultRoot,
      {
        packetId,
        kind: item.kind,
        title: item.title,
        action: item.action,
        ...(item.note !== undefined ? { note: item.note } : {}),
        ...(item.query !== undefined ? { query: item.query } : {}),
      },
      { now },
    );
    count += 1;
  }
  return count;
}

function reviewDedupKey(kind: string, title: string, action: ReviewAction): string {
  return `${action}\u0000${kind}\u0000${title}`;
}

function applyOverview(
  vaultRoot: string,
  modelOverview: string | undefined,
  packetId: string,
  analysisSummary: string,
): void {
  const file = vaultLayout(vaultRoot).wikiOverview;
  if (modelOverview !== undefined) {
    atomicWriteFile(file, `${modelOverview.trim()}\n`);
    return;
  }
  const entry = `- [[sources/${packetId}]] — ${truncateOverviewSummary(analysisSummary)}`;
  if (!fs.existsSync(file)) {
    atomicWriteFile(file, `# Wiki Overview\n\n${entry}\n`);
    return;
  }
  const existing = fs.readFileSync(file, "utf8");
  atomicWriteFile(file, `${existing.trimEnd()}\n${entry}\n`);
}

function truncateOverviewSummary(summary: string): string {
  const collapsed = summary.replace(/\s+/g, " ").trim();
  return collapsed.length <= 120 ? collapsed : `${collapsed.slice(0, 117)}...`;
}

type StepOutcome<T> = { ok: true; value: T } | { ok: false; reason: string };
type StepValidator<T> = (text: string) => StepOutcome<T>;

async function attemptStepWithRetry<T>(
  caller: SideCaller,
  build: () => SideCallInput,
  validate: StepValidator<T>,
  label: string,
  maxAttempts: number,
  signal: AbortSignal,
): Promise<StepOutcome<T>> {
  let lastReason = `${label} was not attempted`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal.aborted) return { ok: false, reason: `${label} aborted` };
    const res = await caller.call(build(), signal);
    if (!res.ok) {
      lastReason = `${label} side-call failed: ${res.error}`;
      continue;
    }
    const validated = validate(res.text);
    if (!validated.ok) {
      lastReason = validated.reason;
      continue;
    }
    return { ok: true, value: validated.value };
  }
  return { ok: false, reason: `${lastReason} (after ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"})` };
}

function validateAnalysis(text: string): StepOutcome<AnalysisResult> {
  const analysis = parseAnalysis(text);
  return analysis
    ? { ok: true, value: analysis }
    : { ok: false, reason: "analysis produced no usable wiki-analysis block" };
}

function validateGeneration(text: string): StepOutcome<GenerationResult> {
  const generation = parseGeneration(text);
  if (!generation) return { ok: false, reason: "generation produced no source page" };
  if (!generation.pages.some((p) => p.type === "source")) {
    return { ok: false, reason: "generation produced no source page" };
  }
  return { ok: true, value: generation };
}

async function ingestOnePacket(
  vaultRoot: string,
  manifest: SourcePacketManifest,
  opts: IngestBatchOptions,
  maxAttempts: number,
  now: Date,
  signal: AbortSignal,
): Promise<PacketIngestOutcome> {
  const packetId = manifest.id;
  const purpose = readPurpose(vaultRoot);
  const digest = buildExistingDigest(vaultRoot);
  const extracted = readExtractedText(manifest.packetDir);

  const analysisInput = (): SideCallInput => ({
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    userText: buildAnalysisUser({ purpose, digest, packetId, extracted }),
  });
  const analysisStep = await attemptStepWithRetry(
    opts.caller,
    analysisInput,
    validateAnalysis,
    "analysis",
    maxAttempts,
    signal,
  );
  if (!analysisStep.ok) {
    return outcomeFailed(packetId, analysisStep.reason);
  }
  const analysis = analysisStep.value;

  const generationInput = (): SideCallInput => ({
    systemPrompt: GENERATION_SYSTEM_PROMPT,
    userText: buildGenerationUser({ purpose, packetId, extracted, analysis }),
  });
  const generationStep = await attemptStepWithRetry(
    opts.caller,
    generationInput,
    validateGeneration,
    "generation",
    maxAttempts,
    signal,
  );
  if (!generationStep.ok) {
    return outcomeFailed(packetId, generationStep.reason);
  }
  const generation = generationStep.value;

  let pagesCreated = 0;
  let pagesExisted = 0;
  for (const spec of generation.pages) {
    const applied = applyPageSpec(vaultRoot, spec, packetId);
    if (applied.created) pagesCreated += 1;
    else pagesExisted += 1;
  }
  applyOverview(vaultRoot, generation.overview, packetId, analysis.summary);
  const reviewFiled = fileAnalysisReviewItems(vaultRoot, packetId, analysis, now);

  const updated: SourcePacketManifest = {
    ...manifest,
    ingest: { status: "ingested", ingestedAt: now.toISOString() },
  };
  writeManifest(manifest.packetDir, updated);

  return { packetId, status: "ingested", pagesCreated, pagesExisted, reviewFiled };
}

function outcomeFailed(packetId: string, reason: string): PacketIngestOutcome {
  return { packetId, status: "failed", reason, pagesCreated: 0, pagesExisted: 0, reviewFiled: 0 };
}

export async function ingestBatch(vaultRoot: string, opts: IngestBatchOptions): Promise<IngestBatchResult> {
  const now = resolveNow(opts.now);
  const signal = opts.signal ?? new AbortController().signal;
  const maxAttempts = Math.max(1, Math.floor(opts.maxAttempts ?? DEFAULT_INGEST_MAX_ATTEMPTS));

  let pending = listPendingPackets(vaultRoot);
  if (opts.packetId !== undefined) {
    pending = pending.filter((m) => m.id === opts.packetId);
  }

  const outcomes: PacketIngestOutcome[] = [];
  for (const manifest of pending) {
    const outcome = await ingestOnePacket(vaultRoot, manifest, opts, maxAttempts, now, signal);
    outcomes.push(outcome);
  }

  if (outcomes.some((o) => o.status === "ingested")) {
    rebuildMetaAndLog(vaultRoot, now, outcomes);
  }

  const ingested = outcomes.filter((o) => o.status === "ingested").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;
  return { processed: outcomes.length, ingested, skipped, failed, outcomes };
}

function rebuildMetaAndLog(vaultRoot: string, now: Date, outcomes: PacketIngestOutcome[]): void {
  rebuildMeta(vaultRoot, { now: () => now });
  const ingested = outcomes.filter((o) => o.status === "ingested").length;
  appendJsonl(vaultLayout(vaultRoot).events, {
    ts: now.toISOString(),
    kind: "ingest",
    summary: `batch ingest: ${ingested} packet(s) ingested`,
  });
}
