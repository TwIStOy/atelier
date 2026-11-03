import { describe, expect, test } from "vitest";
import { ProviderError } from "../src/providers/errors.ts";
import { type SearchAttemptProvider, searchProviderChain } from "../src/search/index.ts";

const hit = { title: "Kdenlive", url: "https://kdenlive.org", snippet: "editor" };

function provider(name: string, search: SearchAttemptProvider["search"], label = name): SearchAttemptProvider {
  return { name, label, search };
}

describe("searchProviderChain", () => {
  test("tries the next provider after a non-rate-limit failure", async () => {
    const outcome = await searchProviderChain(
      [
        provider(
          "brave",
          async () => {
            throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND api.search.brave.com") });
          },
          "Brave",
        ),
        provider("tavily", async () => ({ query: "editors", results: [hit] }), "Tavily"),
      ],
      "editors",
      5,
      undefined,
    );
    expect(outcome).toEqual({
      ok: true,
      providerName: "tavily",
      response: { query: "editors", results: [hit] },
    });
  });

  test("stops at the first provider that returns, including an empty result set", async () => {
    let called = false;
    const outcome = await searchProviderChain(
      [
        provider("brave", async () => ({ query: "editors", results: [] })),
        provider("tavily", async () => {
          called = true;
          return { query: "editors", results: [hit] };
        }),
      ],
      "editors",
      5,
      undefined,
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.response.results).toEqual([]);
    expect(called).toBe(false);
  });

  test("lists every provider when the chain fails", async () => {
    const outcome = await searchProviderChain(
      [
        provider(
          "brave",
          async () => {
            throw new ProviderError("brave", 401, "invalid subscription token");
          },
          "Brave",
        ),
        provider(
          "tavily",
          async () => {
            throw new TypeError("fetch failed");
          },
          "Tavily",
        ),
      ],
      "editors",
      5,
      undefined,
    );
    expect(outcome).toEqual({
      ok: false,
      reason: "Brave: brave API error (401): invalid subscription token; Tavily: fetch failed",
    });
  });

  test("does not call the next provider after cancellation", async () => {
    const controller = new AbortController();
    let called = false;
    const pending = searchProviderChain(
      [
        provider("brave", async () => {
          controller.abort();
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          throw err;
        }),
        provider("tavily", async () => {
          called = true;
          return { query: "editors", results: [hit] };
        }),
      ],
      "editors",
      5,
      controller.signal,
    );
    await expect(pending).rejects.toThrow(/aborted/);
    expect(called).toBe(false);
  });

  test("reports that no providers were configured", async () => {
    const outcome = await searchProviderChain([], "editors", 5, undefined);
    expect(outcome).toEqual({ ok: false, reason: "all providers failed" });
  });
});
