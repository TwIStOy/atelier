import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";

vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-ai")>();
  return {
    ...actual,
    completeSimple: vi.fn(),
  };
});

import { completeSimple } from "@earendil-works/pi-ai";
import { executeSideCall } from "./side-call.ts";

const model = { provider: "test", id: "m1" } as unknown as Parameters<typeof executeSideCall>[0]["model"];

function makeAuthResponse(
  overrides: Partial<{
    ok: boolean;
    apiKey: string;
    headers: Record<string, string>;
    error: string;
  }> = {},
) {
  return vi.fn(async () => ({
    ok: overrides.ok ?? true,
    apiKey: overrides.apiKey ?? "key-123",
    headers: overrides.headers ?? {},
    error: overrides.error ?? undefined,
  }));
}

function makeResponse(input: { text?: string; stopReason?: string; errorMessage?: string }): AssistantMessage {
  return {
    role: "assistant",
    content: input.text ? [{ type: "text", text: input.text }] : [],
    timestamp: Date.now(),
    stopReason: (input.stopReason ?? "done") as AssistantMessage["stopReason"],
    errorMessage: input.errorMessage,
  } as unknown as AssistantMessage;
}

describe("executeSideCall", () => {
  test("returns ok with answer text on success", async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce(makeResponse({ text: "forty-two" }) as never);
    const result = await executeSideCall({
      model,
      modelRegistry: {
        getApiKeyAndHeaders: makeAuthResponse(),
      } as unknown as import("@earendil-works/pi-coding-agent").ModelRegistry,
      systemPrompt: "sys",
      messages: [],
      signal: new AbortController().signal,
      commandName: "/btw",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected");
    expect(result.answer).toBe("forty-two");
  });

  test("returns error when getApiKeyAndHeaders is not ok", async () => {
    const result = await executeSideCall({
      model,
      modelRegistry: {
        getApiKeyAndHeaders: makeAuthResponse({
          ok: false,
          error: "bad creds",
        }),
      } as unknown as import("@earendil-works/pi-coding-agent").ModelRegistry,
      systemPrompt: "sys",
      messages: [],
      signal: new AbortController().signal,
      commandName: "/btw",
    });
    expect(result.ok).toBe(false);
    if (result.ok || "aborted" in result) throw new Error("unexpected");
    expect(result.error).toContain("misconfigured");
    expect(result.error).toContain("bad creds");
  });

  test("returns error when apiKey is empty", async () => {
    const result = await executeSideCall({
      model,
      modelRegistry: {
        getApiKeyAndHeaders: makeAuthResponse({ apiKey: "" }),
      } as unknown as import("@earendil-works/pi-coding-agent").ModelRegistry,
      systemPrompt: "sys",
      messages: [],
      signal: new AbortController().signal,
      commandName: "/btw",
    });
    expect(result.ok).toBe(false);
    if (result.ok || "aborted" in result) throw new Error("unexpected");
    expect(result.error).toContain("no API key");
  });

  test("returns aborted when stopReason is aborted", async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce(makeResponse({ stopReason: "aborted" }) as never);
    const result = await executeSideCall({
      model,
      modelRegistry: {
        getApiKeyAndHeaders: makeAuthResponse(),
      } as unknown as import("@earendil-works/pi-coding-agent").ModelRegistry,
      systemPrompt: "sys",
      messages: [],
      signal: new AbortController().signal,
      commandName: "/btw",
    });
    expect(result).toMatchObject({ ok: false, aborted: true });
  });

  test("returns error when stopReason is error", async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce(
      makeResponse({
        stopReason: "error",
        errorMessage: "remote 500",
      }) as never,
    );
    const result = await executeSideCall({
      model,
      modelRegistry: {
        getApiKeyAndHeaders: makeAuthResponse(),
      } as unknown as import("@earendil-works/pi-coding-agent").ModelRegistry,
      systemPrompt: "sys",
      messages: [],
      signal: new AbortController().signal,
      commandName: "/btw",
    });
    expect(result.ok).toBe(false);
    if (result.ok || "aborted" in result) throw new Error("unexpected");
    expect(result.error).toContain("remote 500");
  });

  test("returns error when response has no text content", async () => {
    vi.mocked(completeSimple).mockResolvedValueOnce(makeResponse({ stopReason: "done" }) as never);
    const result = await executeSideCall({
      model,
      modelRegistry: {
        getApiKeyAndHeaders: makeAuthResponse(),
      } as unknown as import("@earendil-works/pi-coding-agent").ModelRegistry,
      systemPrompt: "sys",
      messages: [],
      signal: new AbortController().signal,
      commandName: "/btw",
    });
    expect(result.ok).toBe(false);
    if (result.ok || "aborted" in result) throw new Error("unexpected");
    expect(result.error).toContain("no text content");
  });

  test("maps aborted signal to aborted result on thrown error", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.mocked(completeSimple).mockRejectedValueOnce(new Error("abort"));
    const result = await executeSideCall({
      model,
      modelRegistry: {
        getApiKeyAndHeaders: makeAuthResponse(),
      } as unknown as import("@earendil-works/pi-coding-agent").ModelRegistry,
      systemPrompt: "sys",
      messages: [],
      signal: controller.signal,
      commandName: "/btw",
    });
    expect(result).toMatchObject({ ok: false, aborted: true });
  });

  test("wraps unknown throws as error result", async () => {
    vi.mocked(completeSimple).mockRejectedValueOnce(new Error("boom"));
    const result = await executeSideCall({
      model,
      modelRegistry: {
        getApiKeyAndHeaders: makeAuthResponse(),
      } as unknown as import("@earendil-works/pi-coding-agent").ModelRegistry,
      systemPrompt: "sys",
      messages: [],
      signal: new AbortController().signal,
      commandName: "/btw",
    });
    expect(result.ok).toBe(false);
    if (result.ok || "aborted" in result) throw new Error("unexpected");
    expect(result.error).toContain("call threw");
    expect(result.error).toContain("boom");
  });

  test("prefixes error messages with commandName", async () => {
    vi.mocked(completeSimple).mockRejectedValueOnce(new Error("boom"));
    const result = await executeSideCall({
      model,
      modelRegistry: {
        getApiKeyAndHeaders: makeAuthResponse(),
      } as unknown as import("@earendil-works/pi-coding-agent").ModelRegistry,
      systemPrompt: "sys",
      messages: [],
      signal: new AbortController().signal,
      commandName: "/mycommand",
    });
    expect(result.ok).toBe(false);
    if (result.ok || "aborted" in result) throw new Error("unexpected");
    expect(result.error).toContain("/mycommand");
  });
});
