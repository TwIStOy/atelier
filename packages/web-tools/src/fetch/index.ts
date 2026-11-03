import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { instantiateProviders, isRateLimitError } from "../config.ts";
import { buildInterceptors, getInterceptors } from "../interceptors/index.ts";
import { fetchViaGenericHtml, parseAndAssertHttpUrl } from "../providers/fetch-helpers.ts";
import type { FetchResponse, FullProvider } from "../providers/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fetchToolDescription = readFileSync(join(__dirname, "prompt.txt"), "utf-8").trim();

interface FetchDetails {
  url: string;
  title?: string;
  contentType?: string;
  contentLength?: number;
  truncation?: TruncationResult;
  fullOutputPath?: string;
  backend?: string;
}

type ProviderEntries = ReturnType<typeof instantiateProviders>["providers"];

interface ProviderFetchOutcome {
  response: FetchResponse;
  providerName: string;
}

async function spillFullContentToTempFile(content: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-fetch-"));
  const tempFile = join(tempDir, "content.txt");
  await writeFile(tempFile, content, "utf8");
  return tempFile;
}

function formatTruncationFooter(truncation: TruncationResult, tempFile: string): string {
  const truncatedLines = truncation.totalLines - truncation.outputLines;
  const truncatedBytes = truncation.totalBytes - truncation.outputBytes;
  return (
    `\n\n[Content truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines` +
    ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).` +
    ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.` +
    ` Full content saved to: ${tempFile}]`
  );
}

function formatFetchHeader(url: string, title: string | undefined, contentType: string | undefined): string {
  const lines = [`**Fetched:** ${url}`];
  if (title) lines.push(`**Title:** ${title}`);
  if (contentType) lines.push(`**Content-Type:** ${contentType}`);
  return `${lines.join("\n")}\n\n`;
}

// Level 1: URL interceptor chain
async function fetchViaInterceptors(
  url: string,
  raw: boolean,
  signal: AbortSignal | undefined,
): Promise<FetchResponse | undefined> {
  if (getInterceptors().length === 0) {
    buildInterceptors();
  }
  for (const interceptor of getInterceptors()) {
    const intercepted = await interceptor.intercept(url, {
      raw,
      signal,
    });
    if (intercepted) return intercepted;
  }
  return undefined;
}

async function tryProviderFetch(
  provider: FullProvider,
  url: string,
  raw: boolean,
  signal: AbortSignal | undefined,
): Promise<FetchResponse | undefined> {
  try {
    return await provider.fetch(url, raw, signal);
  } catch (err: unknown) {
    if (!isRateLimitError(err)) throw err;
    return undefined;
  }
}

// Level 2: Provider native fetch (with fallback chain)
async function fetchViaProviders(
  url: string,
  raw: boolean,
  signal: AbortSignal | undefined,
  providers: ProviderEntries,
): Promise<ProviderFetchOutcome | undefined> {
  for (const { name, provider } of providers) {
    if ("fetch" in provider) {
      const response = await tryProviderFetch(provider, url, raw, signal);
      if (response) return { response, providerName: name };
    }
  }
  return undefined;
}

async function resolveFetchResponse(
  url: string,
  raw: boolean,
  signal: AbortSignal | undefined,
  providers: ProviderEntries,
): Promise<{ response: FetchResponse; backend?: string }> {
  const intercepted = await fetchViaInterceptors(url, raw, signal);
  if (intercepted) return { response: intercepted };

  const viaProvider = await fetchViaProviders(url, raw, signal, providers);
  if (viaProvider) return { response: viaProvider.response, backend: viaProvider.providerName };

  // Level 3: Generic HTML pipeline
  return { response: await fetchViaGenericHtml(url, raw, signal) };
}

async function applyTruncation(details: FetchDetails, bodyText: string): Promise<string> {
  const truncation = truncateHead(bodyText, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (!truncation.truncated) return truncation.content;

  const tempFile = await spillFullContentToTempFile(bodyText);
  details.truncation = truncation;
  details.fullOutputPath = tempFile;
  return truncation.content + formatTruncationFooter(truncation, tempFile);
}

const fetchParams = Type.Object({
  url: Type.String({
    description: "The URL to fetch. Must be http or https.",
  }),
  raw: Type.Optional(
    Type.Boolean({
      description: "If true, return the raw HTML instead of extracted text. Default: false.",
      default: false,
    }),
  ),
});

export function registerWebFetchTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description: fetchToolDescription,
    promptSnippet: "Fetch and read content from a specific URL",
    parameters: fetchParams,
    annotations: { readOnlyHint: true, openWorldHint: true },

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const { url, raw = false } = params;
      parseAndAssertHttpUrl(url);

      onUpdate?.({
        content: [{ type: "text", text: `Fetching: ${url}...` }],
        details: { url } as FetchDetails,
      });

      const { providers } = instantiateProviders();
      const { response, backend } = await resolveFetchResponse(url, raw, signal, providers);

      const details: FetchDetails = {
        url,
        title: response.title,
        contentType: response.contentType,
        contentLength: response.contentLength,
        backend,
      };

      const output = await applyTruncation(details, response.text);

      return {
        content: [
          {
            type: "text",
            text: formatFetchHeader(url, response.title, response.contentType) + output,
          },
        ],
        details,
      };
    },
  });
}
