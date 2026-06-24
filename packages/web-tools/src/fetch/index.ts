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
import type { FetchResponse } from "../providers/types.ts";

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

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const { url, raw = false } = params;
      parseAndAssertHttpUrl(url);

      onUpdate?.({
        content: [{ type: "text", text: `Fetching: ${url}...` }],
        details: { url } as FetchDetails,
      });

      const { providers } = instantiateProviders();

      let fetchResponse: FetchResponse | undefined;

      // Level 1: URL interceptor chain
      if (getInterceptors().length === 0) {
        buildInterceptors();
      }
      for (const interceptor of getInterceptors()) {
        const intercepted = await interceptor.intercept(url, {
          raw,
          signal,
        });
        if (intercepted) {
          fetchResponse = intercepted;
          break;
        }
      }

      // Level 2: Provider native fetch (with fallback chain)
      let usedProviderName: string | undefined;
      if (!fetchResponse) {
        for (const { name, provider } of providers) {
          if (!("fetch" in provider)) continue;
          try {
            fetchResponse = await provider.fetch(url, raw, signal);
            if (fetchResponse) {
              usedProviderName = name;
              break;
            }
          } catch (err: unknown) {
            if (!isRateLimitError(err)) throw err;
          }
        }
      }

      // Level 3: Generic HTML pipeline
      if (!fetchResponse) {
        fetchResponse = await fetchViaGenericHtml(url, raw, signal);
      }

      const { text: bodyText, title, contentType, contentLength } = fetchResponse;

      const truncation = truncateHead(bodyText, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      const details: FetchDetails = {
        url,
        title,
        contentType,
        contentLength,
        backend: usedProviderName,
      };

      let output = truncation.content;
      if (truncation.truncated) {
        const tempFile = await spillFullContentToTempFile(bodyText);
        details.truncation = truncation;
        details.fullOutputPath = tempFile;
        output += formatTruncationFooter(truncation, tempFile);
      }

      return {
        content: [
          {
            type: "text",
            text: formatFetchHeader(url, title, contentType) + output,
          },
        ],
        details,
      };
    },
  });
}
