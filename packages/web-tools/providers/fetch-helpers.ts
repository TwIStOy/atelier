import type { FetchResponse } from "./types.ts";

const USER_AGENT = "Mozilla/5.0 (compatible; rpiv-pi/1.0)";
const FETCH_ACCEPT_HEADER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5";
const BINARY_CONTENT_TYPE_PREFIXES = ["image/", "video/", "audio/"];
const HTML_CONTENT_TYPE_TOKEN = "text/html";
const SUPPORTED_HTTP_PROTOCOLS = new Set(["http:", "https:"]);

const SCRIPT_BLOCK_REGEX = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK_REGEX = /<style[\s\S]*?<\/style>/gi;
const NOSCRIPT_BLOCK_REGEX = /<noscript[\s\S]*?<\/noscript>/gi;
const BLOCK_CLOSER_REGEX =
  /<\/(p|div|h[1-6]|li|tr|br|blockquote|pre|section|article|header|footer|nav|details|summary)>/gi;
const SELF_CLOSING_BR_REGEX = /<br\s*\/?>/gi;
const ANY_REMAINING_TAG_REGEX = /<[^>]+>/g;
const TITLE_TAG_REGEX = /<title[^>]*>([\s\S]*?)<\/title>/i;
const NUMERIC_HTML_ENTITY_REGEX = /&#(\d+);/g;
const HORIZONTAL_WHITESPACE_RUN = /[ \t]+/g;
const BLANK_LINE_RUN = /\n{3,}/g;

function stripNonContentBlocks(html: string): string {
  return html
    .replace(SCRIPT_BLOCK_REGEX, "")
    .replace(STYLE_BLOCK_REGEX, "")
    .replace(NOSCRIPT_BLOCK_REGEX, "");
}

function convertBlockTagsToNewlines(text: string): string {
  return text
    .replace(BLOCK_CLOSER_REGEX, "\n")
    .replace(SELF_CLOSING_BR_REGEX, "\n");
}

function stripRemainingTags(text: string): string {
  return text.replace(ANY_REMAINING_TAG_REGEX, " ");
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(NUMERIC_HTML_ENTITY_REGEX, (_, code) =>
      String.fromCharCode(Number(code)),
    );
}

function collapseWhitespace(text: string): string {
  return text
    .replace(HORIZONTAL_WHITESPACE_RUN, " ")
    .replace(BLANK_LINE_RUN, "\n\n");
}

export function htmlToText(html: string): string {
  let text = stripNonContentBlocks(html);
  text = convertBlockTagsToNewlines(text);
  text = stripRemainingTags(text);
  text = decodeHtmlEntities(text);
  text = collapseWhitespace(text);
  return text.trim();
}

export function extractTitle(html: string): string | undefined {
  const match = html.match(TITLE_TAG_REGEX);
  if (!match) return undefined;
  return match[1].replace(ANY_REMAINING_TAG_REGEX, "").trim() || undefined;
}

export function isHtmlContentType(contentType: string): boolean {
  return contentType.includes(HTML_CONTENT_TYPE_TOKEN);
}

export function assertTextContentType(contentType: string): void {
  if (
    BINARY_CONTENT_TYPE_PREFIXES.some((prefix) => contentType.includes(prefix))
  ) {
    throw new Error(
      `Unsupported content type: ${contentType}. web_fetch supports text pages only.`,
    );
  }
}

export function isPrivateOrLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (
    h === "::1" ||
    h === "::" ||
    h.startsWith("fe80:") ||
    h.startsWith("fc") ||
    h.startsWith("fd")
  )
    return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function parseAndAssertHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (!SUPPORTED_HTTP_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `Unsupported URL protocol: ${parsed.protocol}. Only http and https are supported.`,
    );
  }
  if (isPrivateOrLoopbackHostname(parsed.hostname)) {
    throw new Error(
      `Refusing to fetch private/loopback address: ${parsed.hostname}`,
    );
  }
  return parsed;
}

export function buildFetchRequestInit(
  signal: AbortSignal | undefined,
): RequestInit {
  return {
    signal,
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, Accept: FETCH_ACCEPT_HEADER },
  };
}

export async function fetchUrlOrThrow(
  url: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const res = await fetch(url, buildFetchRequestInit(signal));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return res;
}

export async function extractBodyAsText(
  res: Response,
  contentType: string,
  raw: boolean,
): Promise<{ text: string; title?: string }> {
  const body = await res.text();
  if (!raw && isHtmlContentType(contentType)) {
    return { text: htmlToText(body), title: extractTitle(body) };
  }
  return { text: body };
}

export async function fetchViaGenericHtml(
  url: string,
  raw: boolean,
  signal?: AbortSignal,
): Promise<FetchResponse> {
  const res = await fetchUrlOrThrow(url, signal);
  const contentType = res.headers.get("content-type") ?? "";
  assertTextContentType(contentType);
  const { text, title } = await extractBodyAsText(res, contentType, raw);
  const contentLengthHeader = res.headers.get("content-length");
  return {
    text,
    title,
    contentType: contentType || undefined,
    contentLength: contentLengthHeader
      ? Number(contentLengthHeader)
      : undefined,
  };
}
