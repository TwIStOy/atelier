import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile, contentHash } from "./atomic.ts";
import { PAGE_TYPES, type PageType } from "./bootstrap.ts";
import { splitFrontmatter } from "./frontmatter.ts";
import { buildRegistry, type PageRegistryEntry, type RegistryDoc } from "./meta.ts";
import { vaultLayout } from "./paths.ts";

export type { PageType } from "./bootstrap.ts";

export interface EnsurePageInput {
  type: PageType;
  title: string;
  aliases?: string[];
  sources?: string[];
  slug?: string;
}

export interface EnsurePageResult {
  created: boolean;
  type: PageType;
  id: string;
  path: string;
  relPath: string;
  title: string;
  aliases: string[];
  sources: string[];
  matchedOn: "title" | "alias" | null;
  matchedId?: string;
}

interface ResolvedMatch {
  page: PageRegistryEntry;
  matchedOn: "title" | "alias";
}

export function ensurePage(vaultRoot: string, input: EnsurePageInput): EnsurePageResult {
  const type = normalizeType(input.type);
  const title = normalizeTitle(input.title);
  const aliases = cleanStrings(input.aliases);
  const sources = cleanStrings(input.sources);

  const layout = vaultLayout(vaultRoot);
  const registry = buildRegistry(vaultRoot);

  const matched = resolveExisting(registry, type, title, aliases);
  if (matched) {
    return resultFromExisting(vaultRoot, type, matched);
  }

  const typeDir = typeDirectory(layout, type);
  const slug = deriveSlug(title, input.slug);
  const filePath = allocatePagePath(typeDir, slug);
  const template = readTemplate(layout, type);
  const fields = { title, aliases, sources };
  const rendered = instantiateTemplate(template, fields);
  atomicWriteFile(filePath, rendered);

  return resultFromCreated(vaultRoot, layout, type, filePath, fields);
}

function normalizeType(type: unknown): PageType {
  if (typeof type === "string" && (PAGE_TYPES as readonly string[]).includes(type)) {
    return type as PageType;
  }
  throw new Error(`wiki_ensure_page: type must be one of ${PAGE_TYPES.join(", ")}`);
}

function normalizeTitle(title: unknown): string {
  if (typeof title !== "string") {
    throw new Error("wiki_ensure_page: title must be a non-empty string");
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error("wiki_ensure_page: title must be a non-empty string");
  }
  return trimmed;
}

function cleanStrings(values: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (trimmed.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function resolveExisting(
  registry: RegistryDoc,
  type: PageType,
  title: string,
  aliases: string[],
): ResolvedMatch | null {
  const nameIndex = buildSameTypeNameIndex(registry, type);

  const titleKey = title.toLowerCase();
  const byTitle = nameIndex.get(titleKey);
  if (byTitle) return { page: byTitle, matchedOn: "title" };

  for (const alias of aliases) {
    const hit = nameIndex.get(alias.toLowerCase());
    if (hit) return { page: hit, matchedOn: "alias" };
  }
  return null;
}

function buildSameTypeNameIndex(registry: RegistryDoc, type: PageType): Map<string, PageRegistryEntry> {
  const index = new Map<string, PageRegistryEntry>();
  for (const page of registry.pages) {
    if (page.type !== type) continue;
    registerName(index, page, page.title);
    for (const alias of page.aliases) registerName(index, page, alias);
  }
  return index;
}

function registerName(index: Map<string, PageRegistryEntry>, page: PageRegistryEntry, name: string | null): void {
  if (name === null) return;
  const key = name.trim().toLowerCase();
  if (key.length === 0) return;
  if (!index.has(key)) index.set(key, page);
}

function typeDirectory(layout: ReturnType<typeof vaultLayout>, type: PageType): string {
  switch (type) {
    case "source":
      return layout.wikiSources;
    case "concept":
      return layout.wikiConcepts;
    case "entity":
      return layout.wikiEntities;
    case "synthesis":
      return layout.wikiSyntheses;
    case "analysis":
      return layout.wikiAnalyses;
    default: {
      const exhaustive: never = type;
      throw new Error(`wiki_ensure_page: unknown page type ${String(exhaustive)}`);
    }
  }
}

function deriveSlug(title: string, explicit: string | undefined): string {
  const source = explicit !== undefined && explicit.trim().length > 0 ? explicit.trim() : title;
  const base = slugify(source);
  if (base.length > 0) return base;
  return `page-${contentHash(title).slice(0, 8)}`;
}

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function allocatePagePath(typeDir: string, slug: string): string {
  const ext = ".md";
  const first = path.join(typeDir, `${slug}${ext}`);
  if (!fs.existsSync(first)) return first;
  for (let n = 2; ; n++) {
    const candidate = path.join(typeDir, `${slug}-${n}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

function readTemplate(layout: ReturnType<typeof vaultLayout>, type: PageType): string {
  const templatePath = path.join(layout.templates, `${type}.md`);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`wiki_ensure_page: template not found at templates/${type}.md — run wiki bootstrap first`);
  }
  return fs.readFileSync(templatePath, "utf8");
}

interface TemplateFields {
  title: string;
  aliases: string[];
  sources: string[];
}

function instantiateTemplate(rawTemplate: string, fields: TemplateFields): string {
  const { frontmatter, body } = splitFrontmatter(rawTemplate);
  const lines = (frontmatter ?? "").split(/\r?\n/);
  const patched: string[] = [];
  let sawTitle = false;
  let sawAliases = false;
  let sawSources = false;

  for (const line of lines) {
    if (/^title:\s*$/.test(line) || /^title:\s+.*/.test(line)) {
      patched.push(`title: ${yamlScalar(fields.title)}`);
      sawTitle = true;
    } else if (/^aliases:\s*.*/.test(line)) {
      patched.push(`aliases: ${yamlFlowSeq(fields.aliases)}`);
      sawAliases = true;
    } else if (/^sources:\s*.*/.test(line)) {
      patched.push(`sources: ${yamlFlowSeq(fields.sources)}`);
      sawSources = true;
    } else {
      patched.push(line);
    }
  }

  if (!sawTitle) patched.push(`title: ${yamlScalar(fields.title)}`);
  if (!sawAliases) patched.push(`aliases: ${yamlFlowSeq(fields.aliases)}`);
  if (!sawSources) patched.push(`sources: ${yamlFlowSeq(fields.sources)}`);

  const renderedBody = body.split("<title>").join(fields.title);
  return `---\n${patched.join("\n")}\n---\n${renderedBody}`;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function yamlFlowSeq(items: string[]): string {
  if (items.length === 0) return "[]";
  return `[${items.map(yamlScalar).join(", ")}]`;
}

function resultFromExisting(vaultRoot: string, type: PageType, matched: ResolvedMatch): EnsurePageResult {
  const absPath = path.join(vaultRoot, matched.page.path);
  return {
    created: false,
    type,
    id: matched.page.id,
    path: absPath,
    relPath: matched.page.path,
    title: matched.page.title ?? path.basename(matched.page.id),
    aliases: matched.page.aliases,
    sources: matched.page.sources,
    matchedOn: matched.matchedOn,
    matchedId: matched.page.id,
  };
}

function resultFromCreated(
  vaultRoot: string,
  layout: ReturnType<typeof vaultLayout>,
  type: PageType,
  filePath: string,
  fields: TemplateFields,
): EnsurePageResult {
  const relPath = toPosix(path.relative(vaultRoot, filePath));
  const id = toPosix(path.relative(layout.wiki, filePath)).replace(/\.md$/i, "");
  return {
    created: true,
    type,
    id,
    path: filePath,
    relPath,
    title: fields.title,
    aliases: fields.aliases,
    sources: fields.sources,
    matchedOn: null,
  };
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
