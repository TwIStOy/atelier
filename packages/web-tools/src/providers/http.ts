import { throwIfApiError } from "./errors.ts";

export function throwIfMissingApiKey(envVar: string, apiKey: string): void {
  if (!apiKey) {
    throw new Error(`${envVar} is not set. Use /config to set the API key, or export the env var.`);
  }
}

export async function requestJson<T>(
  providerName: string,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) {
    throwIfApiError(providerName, res.status, await res.text());
  }
  return (await res.json()) as T;
}

export function requireContent(label: string, url: string, text: string | null | undefined): string {
  if (!text) {
    throw new Error(`${label} Fetch API error: no content returned for ${url}`);
  }
  return text;
}
