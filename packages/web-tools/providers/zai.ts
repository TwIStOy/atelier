import { mcpCall, mcpInit } from "@htwang-contrib/common";
import { ProviderError } from "./errors.ts";
import type { FetchResponse, FullProvider, SearchResponse, SearchResult } from "./types.ts";

const ZAI_SEARCH_MCP_URL = "https://api.z.ai/api/mcp/web_search_prime/mcp";
const ZAI_READER_MCP_URL = "https://api.z.ai/api/mcp/web_reader/mcp";

const ZAI_SEARCH_CLIENT = { name: "pi-zai-search", version: "0.1.0" };
const ZAI_READER_CLIENT = { name: "pi-zai-reader", version: "0.1.0" };

const ZAI_RATE_LIMIT_CODES = new Set(["1113", "1302", "1303", "1304", "1308", "1310", "1313"]);

interface ZaiWebSearchResult {
  title: string;
  link: string;
  content: string;
  refer: string;
}

interface ZaiWebReadResult {
  title?: string;
  url?: string;
  content?: string;
  metadata?: Record<string, string>;
}

function unwrapMcpText(raw: unknown): unknown {
  let parsed = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof parsed !== "string") break;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }
  return parsed;
}

function rewriteMcpError(name: string, err: unknown): never {
  if (err instanceof ProviderError) throw err;
  const msg = err instanceof Error ? err.message : String(err);
  const codeMatch = msg.match(/"code"\s*:\s*"(\d+)"/);
  if (codeMatch && ZAI_RATE_LIMIT_CODES.has(codeMatch[1]!)) {
    throw new ProviderError(name, 429, msg, { isRateLimit: true });
  }
  throw new ProviderError(name, 500, msg);
}

export class ZaiProvider implements FullProvider {
  readonly name = "zai";
  readonly label = "Z.AI";
  readonly envVar = "ZAI_API_KEY";

  constructor(private readonly apiKey: string) {}

  async search(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.envVar} is not set. Use /config to set the API key, or export the env var.`);
    }

    let text: string | undefined;
    try {
      const session = await mcpInit(ZAI_SEARCH_MCP_URL, this.apiKey, signal, ZAI_SEARCH_CLIENT);
      const result = (await mcpCall(
        ZAI_SEARCH_MCP_URL,
        session,
        this.apiKey,
        "tools/call",
        { name: "web_search_prime", arguments: { search_query: query } },
        2,
        signal,
      )) as { content?: Array<{ text?: string }> };
      text = result?.content?.[0]?.text;
    } catch (err: unknown) {
      rewriteMcpError(this.name, err);
    }

    if (!text) return { query, results: [] };

    const parsed = unwrapMcpText(text);
    if (!Array.isArray(parsed)) return { query, results: [] };

    const raw = parsed as ZaiWebSearchResult[];
    const results: SearchResult[] = raw.slice(0, maxResults).map((r) => ({
      title: r.title ?? "",
      url: r.link ?? "",
      snippet: r.content ?? "",
    }));

    return { query, results };
  }

  async fetch(url: string, _raw: boolean, signal?: AbortSignal): Promise<FetchResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.envVar} is not set. Use /config to set the API key, or export the env var.`);
    }

    let text: string | undefined;
    try {
      const session = await mcpInit(ZAI_READER_MCP_URL, this.apiKey, signal, ZAI_READER_CLIENT);
      const result = (await mcpCall(
        ZAI_READER_MCP_URL,
        session,
        this.apiKey,
        "tools/call",
        { name: "webReader", arguments: { url } },
        2,
        signal,
      )) as { content?: Array<{ text?: string }> };
      text = result?.content?.[0]?.text;
    } catch (err: unknown) {
      rewriteMcpError(this.name, err);
    }

    if (!text) {
      throw new Error(`Z.AI Fetch error: no content returned for ${url}`);
    }

    const parsed = unwrapMcpText(text);

    if (typeof parsed === "string") {
      return { text: parsed, contentType: "text/plain" };
    }

    const data = parsed as ZaiWebReadResult;
    return {
      text: data.content ?? JSON.stringify(parsed, null, 2),
      title: data.title || undefined,
      contentType: "text/plain",
    };
  }
}
