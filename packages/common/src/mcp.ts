interface McpSession {
  sessionId: string;
}

export type { McpSession };

export interface McpClientInfo {
  name: string;
  version: string;
}

export async function mcpInit(
  url: string,
  apiKey: string,
  signal?: AbortSignal,
  clientInfo?: McpClientInfo,
): Promise<McpSession> {
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: clientInfo ?? { name: "pi-mcp-client", version: "0.1.0" },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`MCP init ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const sessionId = res.headers.get("Mcp-Session-Id");
  if (!sessionId) throw new Error("MCP: no session ID returned");
  return { sessionId };
}

function parseMcpSsePayload(text: string): unknown {
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data:")) {
      const json = JSON.parse(line.slice(5).trim());
      if (json.error) throw new Error(`MCP: ${json.error.message}`);
      return json.result;
    }
  }
  throw new Error("MCP: no data in response");
}

export async function mcpCall<T = unknown>(
  url: string,
  session: McpSession,
  apiKey: string,
  method: string,
  params: Record<string, unknown>,
  id: number,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json, text/event-stream",
      "Mcp-Session-Id": session.sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!res.ok) {
    throw new Error(`MCP ${method} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return parseMcpSsePayload(await res.text()) as T;
}
