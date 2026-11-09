import { writeFileSync as dumpFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { clearConfigItems, setConfigKey, writeConfig } from "@htwang-contrib/common/config";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MAGPIE_CONFIG_ID } from "../src/config.ts";
import { executeGenerateImage, type GenerateImageDetails, registerGenerateImageTool } from "../src/image-tool.ts";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GATEWAY = "http://100.65.0.3:3425";
const B64_JSON = "b64" + "_json";

function imageResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    created: 1_800_000_000_000,
    model: "openai/gpt-image-2",
    data: [{ [B64_JSON]: PNG_BASE64, mime_type: "image/png", revised_prompt: "a watercolour magpie" }],
    ...overrides,
  });
}

describe("generate_image", () => {
  let configDir: string;
  let workDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "pi-magpie-config-"));
    workDir = mkdtempSync(join(tmpdir(), "pi-magpie-work-"));
    vi.stubEnv("XDG_CONFIG_HOME", configDir);
    vi.stubEnv("MAGPIE_BASE_URL", "");
    vi.stubEnv("MAGPIE_API_KEY", "");
    clearConfigItems(MAGPIE_CONFIG_ID);
    writeConfig(MAGPIE_CONFIG_ID, { apiKey: "test-gateway-key" });
  });

  afterEach(() => {
    clearConfigItems(MAGPIE_CONFIG_ID);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(configDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  test("posts to /v1/images/generations, saves the file, and returns an image block", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(imageResponse());

    const result = await executeGenerateImage({ prompt: "a magpie on a branch" }, workDir, undefined, fetcher);

    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`${GATEWAY}/v1/images/generations`);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-gateway-key");
    expect(JSON.parse(String(init?.body))).toEqual({
      prompt: "a magpie on a branch",
      response_format: "b64_json",
    });

    expect(result.isError).toBeUndefined();
    expect(result.details.model).toBe("openai/gpt-image-2");
    expect(result.details.revisedPrompt).toBe("a watercolour magpie");
    expect(result.details.files).toHaveLength(1);
    const [file] = result.details.files;
    expect(file.path.startsWith(workDir)).toBe(true);
    expect(file.path.endsWith(".png")).toBe(true);
    expect(file.mimeType).toBe("image/png");
    expect(existsSync(file.path)).toBe(true);
    expect((await readFile(file.path)).toString("base64")).toBe(PNG_BASE64);

    expect(result.content[0]).toEqual({
      type: "text",
      text: expect.stringContaining(file.path),
    });
    expect(result.content[1]).toEqual({ type: "image", data: PNG_BASE64, mimeType: "image/png" });
  });

  test("sends optional fields and the model only when given", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(imageResponse());

    await executeGenerateImage(
      {
        prompt: "an app icon",
        size: "1024x1536",
        n: 1,
        quality: "high",
        background: "transparent",
        model: "group/images",
      },
      workDir,
      undefined,
      fetcher,
    );

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      prompt: "an app icon",
      response_format: "b64" + "_json",
      model: "group/images",
      size: "1024x1536",
      n: 1,
      quality: "high",
      background: "transparent",
    });
  });

  test("switches to /v1/images/edits with data URLs for reference images", async () => {
    const reference = join(workDir, "input.png");
    dumpFileSync(reference, Buffer.from(PNG_BASE64, "base64"));
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(imageResponse());

    await executeGenerateImage(
      { prompt: "make the beak blue", reference_images: [reference] },
      workDir,
      undefined,
      fetcher,
    );

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${GATEWAY}/v1/images/edits`);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      prompt: "make the beak blue",
      response_format: "b64_json",
      images: [`data:image/png;base64,${PNG_BASE64}`],
    });
  });

  test("rejects a reference file that is not an image", async () => {
    const reference = join(workDir, "notes.txt");
    dumpFileSync(reference, "not an image");
    const fetcher = vi.fn<typeof globalThis.fetch>();

    const result = await executeGenerateImage(
      { prompt: "edit", reference_images: [reference] },
      workDir,
      undefined,
      fetcher,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("not a recognized PNG") });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("saves and returns every image when n yields several", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      imageResponse({
        data: [
          { [B64_JSON]: PNG_BASE64, mime_type: "image/png" },
          { [B64_JSON]: PNG_BASE64, mime_type: "image/png" },
        ],
      }),
    );

    const result = await executeGenerateImage({ prompt: "two magpies" }, workDir, undefined, fetcher);

    expect(result.details.files).toHaveLength(2);
    expect(result.details.files[0].path).not.toBe(result.details.files[1].path);
    expect(result.content.filter((block) => block.type === "image")).toHaveLength(2);
  });

  test("downloads a URL answer when no inline data comes back", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(imageResponse({ data: [{ url: "https://vendor.invalid/img.png" }] }))
      .mockResolvedValueOnce(new Response(Buffer.from(PNG_BASE64, "base64"), { status: 200 }));

    const result = await executeGenerateImage({ prompt: "a cat" }, workDir, undefined, fetcher);

    expect(String(fetcher.mock.calls[1]?.[0])).toBe("https://vendor.invalid/img.png");
    expect(result.details.files).toHaveLength(1);
    expect(result.content[1]).toEqual({ type: "image", data: PNG_BASE64, mimeType: "image/png" });
  });

  test("maps a 401 to a key hint", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ error: { message: "no API key was sent" } }, { status: 401 }));

    const result = await executeGenerateImage({ prompt: "a cat" }, workDir, undefined, fetcher);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("/config") });
  });

  test("maps a 400 without images to magpie's message", async () => {
    const fetcher = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ error: { message: "no model to draw with" } }, { status: 400 }));

    const result = await executeGenerateImage({ prompt: "a cat" }, workDir, undefined, fetcher);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("no model to draw with") });
  });

  test("rejects a blank key before contacting the gateway", async () => {
    setConfigKey(MAGPIE_CONFIG_ID, "apiKey", "   ");
    const fetcher = vi.fn<typeof globalThis.fetch>();

    const result = await executeGenerateImage({ prompt: "a cat" }, workDir, undefined, fetcher);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("MAGPIE_API_KEY") });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("reports a timeout with the configured limit", async () => {
    setConfigKey(MAGPIE_CONFIG_ID, "imageTimeoutMs", 30);
    const fetcher = vi.fn<typeof globalThis.fetch>(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error("Expected an abort signal");
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );

    const result = await executeGenerateImage({ prompt: "a cat" }, workDir, undefined, fetcher);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("timed out") });
  });
});

const PLAIN_THEME: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
} as Theme;

function captureToolDefinition(): ToolDefinition {
  const definitions: ToolDefinition[] = [];
  const pi = {
    registerTool: (definition: ToolDefinition) => definitions.push(definition),
  } as unknown as ExtensionAPI;
  registerGenerateImageTool(pi);
  return definitions[0] as ToolDefinition;
}

function rendered(component: unknown): string {
  return (component as { render(width: number): string[] })
    .render(200)
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

describe("generate_image rendering", () => {
  test("header shows the verb, quoted prompt, and extras", () => {
    const tool = captureToolDefinition();
    const args = {
      prompt: "a magpie on a branch",
      size: "1536x1024",
      n: 2,
      reference_images: ["/tmp/a.png", "/tmp/b.png"],
      model: "group/images",
    };

    const running = tool.renderCall?.(args, PLAIN_THEME, { isPartial: true, outputPad: 0 } as never);
    expect(rendered(running)).toBe('Generating "a magpie on a branch" 1536x1024 x2 2 ref group/images');

    const done = tool.renderCall?.(args, PLAIN_THEME, { isPartial: false, outputPad: 0 } as never);
    expect(rendered(done)).toBe('Generated "a magpie on a branch" 1536x1024 x2 2 ref group/images');
  });

  test("collapsed result summarizes the saved images", () => {
    const tool = captureToolDefinition();
    const details: GenerateImageDetails = {
      model: "openai/gpt-image-2",
      files: [
        { path: "/repo/a-magpie-20260101-120000.png", mimeType: "image/png", bytes: 1234 },
        { path: "/repo/a-magpie-20260101-120001.png", mimeType: "image/png", bytes: 1234 },
      ],
    };
    const component = tool.renderResult?.(
      { content: [{ type: "text", text: "ok" }], details },
      { expanded: false, isPartial: false },
      PLAIN_THEME,
      { outputPad: 0, isError: false } as never,
    );
    expect(rendered(component)).toBe("2 images /repo/a-magpie-20260101-120000.png · 1 more");
  });

  test("expanded result lists files and the revised prompt", () => {
    const tool = captureToolDefinition();
    const details: GenerateImageDetails = {
      model: "openai/gpt-image-2",
      files: [{ path: "/repo/a-magpie-20260101-120000.png", mimeType: "image/png", bytes: 1234 }],
      revisedPrompt: "a watercolour magpie",
    };
    const component = tool.renderResult?.(
      { content: [{ type: "text", text: "ok" }], details },
      { expanded: true, isPartial: false },
      PLAIN_THEME,
      { outputPad: 0, isError: false } as never,
    );
    expect(rendered(component)).toBe(
      "saved /repo/a-magpie-20260101-120000.png (image/png, 1234 bytes)\nrevised prompt: a watercolour magpie",
    );
  });

  test("error result renders the message as a muted footer", () => {
    const tool = captureToolDefinition();
    const component = tool.renderResult?.(
      {
        content: [
          {
            type: "text",
            text: "Magpie API key is missing. Set MAGPIE_API_KEY or configure the Magpie API key in /config.",
          },
        ],
        details: { model: "", files: [], error: "missing api key" },
      },
      { expanded: false, isPartial: false },
      PLAIN_THEME,
      { outputPad: 0, isError: true } as never,
    );
    expect(rendered(component)).toBe(
      "└ Magpie API key is missing. Set MAGPIE_API_KEY or configure the Magpie API key in /config.",
    );
  });
});
