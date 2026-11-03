import { ProviderError, throwIfApiError } from "./errors.ts";
import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.ts";

const ANYSEARCH_ENDPOINT = "https://api.anysearch.com/mcp";

interface McpContent {
  type?: string;
  text?: string;
}

interface McpResult {
  content?: McpContent[];
}

interface McpResponse {
  error?: { message?: string };
  result?: McpResult;
}

interface AnySearchSearchResult {
  title?: string;
  url?: string;
  snippet?: string;
}

function parseListResponse(text: string): AnySearchSearchResult[] {
  let parsed: unknown = text;
  for (let i = 0; i < 3; i++) {
    if (typeof parsed !== "string") break;
    try {
      parsed = JSON.parse(parsed as string);
    } catch {
      break;
    }
  }
  if (Array.isArray(parsed)) return parsed as AnySearchSearchResult[];
  return [];
}

function extractUrlFromMarkdownTitle(line: string): string | undefined {
  const mdLink = line.match(/\]\((https?:[^)]+)\)\s*$/);
  if (mdLink) return mdLink[1];
  const rawUrl = line.match(/(https?:\/\/[^\s)]+)/);
  return rawUrl?.[1];
}

function fromJsonList(list: AnySearchSearchResult[]): SearchResult[] {
  return list.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.snippet ?? "",
  }));
}

function parseJsonSearchResults(text: string): SearchResult[] {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return [];
  return fromJsonList(parseListResponse(text));
}

function firstLine(lines: string[]): string {
  return lines[0]?.trim() ?? "";
}

function findUrlLine(lines: string[]): string | undefined {
  return lines.slice(1, 4).find((l) => /^\s*[-*]\s*\*?\*?URL\*?\*?:/i.test(l));
}

function urlLineValue(urlLine: string | undefined): string {
  const urlMatch = urlLine?.match(/:\s*(.+)$/);
  if (!urlMatch) return "";
  return urlMatch[1].trim().replace(/[)\]]+$/, "");
}

function resolveBlockUrl(urlLine: string | undefined, title: string, titleLine: string): string {
  const url = urlLineValue(urlLine);
  if (url || !title) return url;
  return extractUrlFromMarkdownTitle(titleLine) ?? url;
}

function parseBlockSnippet(lines: string[]): string {
  const snippetLines = lines
    .slice(1)
    .filter((l) => !/^\s*[-*]\s*\*?\*?URL\*?\*?:/i.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter(Boolean);
  return snippetLines.join(" ").trim();
}

function parseMarkdownBlock(block: string): SearchResult | null {
  const lines = block.split(/\r?\n/);
  const titleLine = firstLine(lines);
  const title = titleLine.replace(/^\s*[-*]\s*/, "").trim();
  const url = resolveBlockUrl(findUrlLine(lines), title, titleLine);
  if (!title && !url) return null;
  return { title, url, snippet: parseBlockSnippet(lines) };
}

function parseMarkdownSearchBlocks(text: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = text.split(/^### \d+\./m).slice(1);

  for (const block of blocks) {
    const parsed = parseMarkdownBlock(block);
    if (parsed) results.push(parsed);
  }

  return results;
}

function parseSearchMarkdown(text: string): SearchResult[] {
  const jsonResults = parseJsonSearchResults(text);
  if (jsonResults.length > 0) return jsonResults;
  return parseMarkdownSearchBlocks(text);
}

function extractTitleFromMarkdown(text: string): string | undefined {
  const match = text.match(/^#\s+(.+)$/m);
  if (!match) return undefined;
  return match[1].trim();
}

function anysearchHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function throwIfMcpError(name: string, data: McpResponse): void {
  if (data.error) {
    throw new ProviderError(name, 500, data.error.message ?? JSON.stringify(data.error));
  }
}

function findMcpTextItem(content: McpContent[] | undefined): McpContent | undefined {
  return content?.find((c) => c.type === "text");
}

function extractMcpText(data: McpResponse): string {
  const textItem = findMcpTextItem(data.result?.content);
  return textItem?.text ?? "";
}

export class AnySearchProvider implements FullProvider {
  readonly name = "anysearch";
  readonly label = "AnySearch";
  readonly envVar = "ANYSEARCH_API_KEY";

  constructor(private readonly apiKey: string) {}

  private async callMcp(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const res = await fetch(ANYSEARCH_ENDPOINT, {
      method: "POST",
      headers: anysearchHeaders(this.apiKey),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throwIfApiError(this.name, res.status, body);
    }

    const data = (await res.json()) as McpResponse;
    throwIfMcpError(this.name, data);
    return extractMcpText(data);
  }

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
    const text = await this.callMcp("search", { query, max_results: maxResults }, signal);
    const results = parseSearchMarkdown(text).slice(0, maxResults);
    return { query, results };
  }

  async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
    const text = await this.callMcp("extract", { url }, signal);
    if (!text) {
      throw new ProviderError(this.name, 500, `no content returned for ${url}`);
    }
    return {
      text,
      title: extractTitleFromMarkdown(text),
      contentType: "text/markdown",
    };
  }
}

export { parseSearchMarkdown as _parseSearchMarkdownForTest };
