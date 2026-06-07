import { mcpInit, mcpCall } from "@htwang-contrib/common";

const ZAI_SEARCH_MCP_URL = "https://api.z.ai/api/mcp/web_search_prime/mcp";
const ZAI_READER_MCP_URL = "https://api.z.ai/api/mcp/web_reader/mcp";

const ZAI_SEARCH_CLIENT = { name: "pi-zai-search", version: "0.1.0" };
const ZAI_READER_CLIENT = { name: "pi-zai-reader", version: "0.1.0" };

export interface WebSearchResult {
  title: string;
  link: string;
  content: string;
  refer: string;
}

export async function zaiWebSearch(
  query: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ results: WebSearchResult[]; raw: string }> {
  const session = await mcpInit(
    ZAI_SEARCH_MCP_URL,
    apiKey,
    signal,
    ZAI_SEARCH_CLIENT,
  );
  const result = (await mcpCall(
    ZAI_SEARCH_MCP_URL,
    session,
    apiKey,
    "tools/call",
    {
      name: "web_search_prime",
      arguments: { search_query: query },
    },
    2,
    signal,
  )) as { content?: Array<{ text?: string }> };

  const content = result?.content?.[0]?.text;
  if (!content) return { results: [], raw: "No results found." };

  let parsed: unknown = content;
  for (let i = 0; i < 3; i++) {
    if (typeof parsed !== "string") break;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }

  if (!Array.isArray(parsed)) {
    const text = typeof parsed === "string" ? parsed : "No results found.";
    return { results: [], raw: text };
  }

  const results = parsed as WebSearchResult[];
  if (!results.length) return { results: [], raw: "No results found." };

  const parts: string[] = [];
  for (let i = 0; i < Math.min(results.length, 8); i++) {
    const r = results[i]!;
    parts.push(`${i + 1}. **${r.title}**\n   ${r.link}\n   ${r.content}`);
  }
  return { results, raw: parts.join("\n\n") };
}

interface WebReadResult {
  title?: string;
  url?: string;
  content?: string;
  metadata?: Record<string, string>;
}

export async function zaiWebRead(
  url: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ title: string; content: string; raw: string }> {
  const session = await mcpInit(
    ZAI_READER_MCP_URL,
    apiKey,
    signal,
    ZAI_READER_CLIENT,
  );
  const result = (await mcpCall(
    ZAI_READER_MCP_URL,
    session,
    apiKey,
    "tools/call",
    {
      name: "webReader",
      arguments: { url },
    },
    2,
    signal,
  )) as { content?: Array<{ text?: string }> };

  const text = result?.content?.[0]?.text;
  if (!text) return { title: "", content: "", raw: "No content returned." };

  let parsed: unknown = text;
  for (let i = 0; i < 3; i++) {
    if (typeof parsed !== "string") break;
    try {
      parsed = JSON.parse(parsed);
    } catch {
      break;
    }
  }

  if (typeof parsed === "string") {
    return { title: "", content: parsed, raw: parsed };
  }

  const data = parsed as WebReadResult;
  const title = data.title ?? "";
  const body = data.content ?? JSON.stringify(parsed, null, 2);
  const raw = title ? `# ${title}\n\n${body}` : body;
  return { title, content: body, raw };
}
