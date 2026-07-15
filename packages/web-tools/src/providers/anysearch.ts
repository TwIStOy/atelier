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

function parseSearchMarkdown(text: string): SearchResult[] {
  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    const list = parseListResponse(text);
    if (list.length > 0) {
      return list.map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        snippet: r.snippet ?? "",
      }));
    }
  }

  const results: SearchResult[] = [];
  const blocks = text.split(/^### \d+\./m).slice(1);

  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const titleLine = lines[0]?.trim() ?? "";
    const title = titleLine.replace(/^\s*[-*]\s*/, "").trim();

    const urlLine = lines.slice(1, 4).find((l) => /^\s*[-*]\s*\*?\*?URL\*?\*?:/i.test(l));
    let url = "";
    let snippet = "";

    if (urlLine) {
      const urlMatch = urlLine.match(/:\s*(.+)$/);
      if (urlMatch) {
        url = urlMatch[1].trim().replace(/[)\]]+$/, "");
      }
    }

    const snippetLines = lines
      .slice(1)
      .filter((l) => !/^\s*[-*]\s*\*?\*?URL\*?\*?:/i.test(l))
      .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
      .filter(Boolean);
    snippet = snippetLines.join(" ").trim();

    if (!url && title) {
      const extracted = extractUrlFromMarkdownTitle(titleLine);
      if (extracted) {
        url = extracted;
      }
    }

    if (title || url) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function extractTitleFromMarkdown(text: string): string | undefined {
  const match = text.match(/^#\s+(.+)$/m);
  if (!match) return undefined;
  return match[1].trim();
}

export class AnySearchProvider implements FullProvider {
  readonly name = "anysearch";
  readonly label = "AnySearch";
  readonly envVar = "ANYSEARCH_API_KEY";

  constructor(private readonly apiKey: string) {}

  private async callMcp(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(ANYSEARCH_ENDPOINT, {
      method: "POST",
      headers,
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

    if (data.error) {
      throw new ProviderError(this.name, 500, data.error.message ?? JSON.stringify(data.error));
    }

    const content = data.result?.content ?? [];
    const textItem = content.find((c) => c.type === "text");
    return textItem?.text ?? "";
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
