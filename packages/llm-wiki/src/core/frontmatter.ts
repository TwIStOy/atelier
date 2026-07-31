import { parse as parseYaml } from "yaml";

export interface PageFrontmatter {
  title?: string;
  type?: string;
  aliases: string[];
  sources: string[];
}

const FRONTMATTER_FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(markdown: string): { frontmatter: string | null; body: string } {
  const match = FRONTMATTER_FENCE.exec(markdown);
  if (!match) return { frontmatter: null, body: markdown };
  return { frontmatter: match[1] ?? "", body: markdown.slice(match[0].length) };
}

export function parseFrontmatter(markdown: string): { fm: PageFrontmatter | null; body: string } {
  const { frontmatter, body } = splitFrontmatter(markdown);
  if (frontmatter === null) return { fm: null, body };

  let raw: unknown;
  try {
    raw = parseYaml(frontmatter);
  } catch {
    return { fm: null, body };
  }
  return { fm: normalizeFrontmatter(raw), body };
}

function normalizeFrontmatter(raw: unknown): PageFrontmatter | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const fm: PageFrontmatter = {
    aliases: asStringArray(record.aliases),
    sources: asStringArray(record.sources),
  };
  const title = asString(record.title);
  if (title !== undefined) fm.title = title;
  const type = asString(record.type);
  if (type !== undefined) fm.type = type;
  return fm;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") out.push(entry);
  }
  return out;
}
