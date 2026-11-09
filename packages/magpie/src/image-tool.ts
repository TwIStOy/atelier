import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { shortenPath } from "@htwang-contrib/common/format";
import { Type } from "typebox";
import { loadMagpieConfig, type MagpieEndpoint, magpieEndpoint } from "./config.ts";

const MAX_REFERENCE_IMAGES = 5;
const PROMPT_SNIPPET_CHARS = 60;
const B64_JSON = "b64" + "_json";

export interface GenerateImageDetails {
  model: string;
  files: { path: string; mimeType: string; bytes: number }[];
  revisedPrompt?: string;
  error?: string;
}

export interface GenerateImageParams {
  prompt: string;
  size?: string;
  n?: number;
  reference_images?: string[];
  quality?: "low" | "medium" | "high" | "xhigh" | "max" | "auto";
  background?: "transparent" | "opaque" | "auto";
  model?: string;
}

const imageParams = Type.Object({
  prompt: Type.String({
    description:
      "What to draw, or how to change the reference images. Be specific: subject, style, composition, colours, and any text to render exactly.",
  }),
  size: Type.Optional(
    Type.String({
      description: "WIDTHxHEIGHT (1024x1024, 1536x1024, 1024x1536) or an aspect ratio (16:9). Default: the model's.",
    }),
  ),
  n: Type.Optional(Type.Integer({ minimum: 1, maximum: 4, description: "How many images to generate (default 1)." })),
  reference_images: Type.Optional(
    Type.Array(Type.String({ description: "Image file path to edit or draw from." }), {
      maxItems: MAX_REFERENCE_IMAGES,
      description: "Images to edit or combine with the prompt, as file paths. Omit for a brand new image.",
    }),
  ),
  quality: Type.Optional(
    Type.Union(
      [
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("xhigh"),
        Type.Literal("max"),
        Type.Literal("auto"),
      ],
      { description: "Quality level, for models that take it. Default: the model's." },
    ),
  ),
  background: Type.Optional(
    Type.Union([Type.Literal("transparent"), Type.Literal("opaque"), Type.Literal("auto")], {
      description: "Background of the generated image: transparent for cutouts, opaque, or auto. Default: the model's.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "Magpie image model id (provider/model) or routing group (group/<id>). Default: the image model picked in magpie's Settings.",
    }),
  ),
});

const TOOL_DESCRIPTION = `Generate an image from a text prompt, or edit and combine existing images given as reference_images, through the Magpie gateway's image models.

Use it when the user asks for a visual: a diagram, illustration, icon, mockup, photo edit, or any image artifact. The images are saved as files in the current directory and also returned inline: a multimodal model sees them and can iterate on the result.

- Generation takes from a few seconds to a few minutes; do not give up early or fire duplicate calls.
- Write a detailed prompt: subject, style, composition, colours, and any text to render exactly.
- For edits, pass every target image in reference_images and describe the change in prompt; preserve existing transparency unless asked otherwise.
- Set background to transparent for cutouts and background removal.
- Reference the saved file path when the user needs the image in the project.`;

function sniffImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  return undefined;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return "png";
}

function promptSlug(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "image";
}

function timestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function targetPath(cwd: string, prompt: string, mimeType: string, index: number, now: Date): string {
  const base = `${promptSlug(prompt)}-${timestamp(now)}`;
  const extension = extensionForMime(mimeType);
  let candidate = join(cwd, index === 0 ? `${base}.${extension}` : `${base}-${index + 1}.${extension}`);
  for (let suffix = index + 1; existsSync(candidate); suffix += 1) {
    candidate = join(cwd, `${base}-${suffix}.${extension}`);
  }
  return candidate;
}

interface MagpieImageData {
  [key: string]: unknown;
  url?: string;
  mime_type?: string;
  revised_prompt?: string;
}

interface MagpieImagesResponse {
  model?: string;
  data?: MagpieImageData[];
  error?: { message?: string };
}

function errorMessage(payload: MagpieImagesResponse, fallback: string): string {
  return payload.error?.message?.trim() || fallback;
}

async function postImages(
  endpoint: MagpieEndpoint,
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  fetchImpl: typeof globalThis.fetch,
): Promise<{ status: number; payload: MagpieImagesResponse }> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetchImpl(new URL(path, `${endpoint.baseUrl}/`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${endpoint.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: attemptSignal,
  });
  const payload = (await response.json().catch(() => ({}))) as MagpieImagesResponse;
  return { status: response.status, payload };
}

async function fetchImageBytes(
  url: string,
  mimeType: string | undefined,
  timeoutMs: number,
  fetchImpl: typeof globalThis.fetch,
): Promise<{ data: string; mimeType: string }> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`downloading the generated image failed with HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { data: buffer.toString("base64"), mimeType: mimeType || sniffImageMime(buffer) || "image/png" };
}

async function readReferenceImage(cwd: string, path: string): Promise<string> {
  const resolved = isAbsolute(path) ? path : join(cwd, path);
  const buffer = await readFile(resolved);
  const mimeType = sniffImageMime(buffer);
  if (!mimeType) throw new Error(`reference image ${path} is not a recognized PNG, JPEG, WebP, or GIF file`);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
export async function executeGenerateImage(
  params: GenerateImageParams,
  cwd: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<{
  content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[];
  details: GenerateImageDetails;
  isError?: boolean;
}> {
  const config = loadMagpieConfig();
  const endpoint = magpieEndpoint(config);
  if (!endpoint.apiKey.trim()) {
    return {
      content: [
        {
          type: "text",
          text: "Magpie API key is missing. Set MAGPIE_API_KEY or configure the Magpie API key in /config.",
        },
      ],
      details: { model: "", files: [], error: "missing api key" },
      isError: true,
    };
  }

  try {
    const body: Record<string, unknown> = { prompt: params.prompt, response_format: B64_JSON };
    if (params.model) body.model = params.model;
    if (params.size) body.size = params.size;
    if (params.n) body.n = params.n;
    if (params.quality) body.quality = params.quality;
    if (params.background) body.background = params.background;

    let path = "images/generations";
    if (params.reference_images && params.reference_images.length > 0) {
      const dataUrls: string[] = [];
      for (const reference of params.reference_images.slice(0, MAX_REFERENCE_IMAGES)) {
        dataUrls.push(await readReferenceImage(cwd, reference));
      }
      body.images = dataUrls;
      path = "images/edits";
    }

    const { status, payload } = await postImages(endpoint, path, body, config.imageTimeoutMs, signal, fetchImpl);
    if (status === 401) {
      return {
        content: [
          { type: "text", text: `Magpie rejected the gateway key (HTTP 401). Check the Magpie API key in /config.` },
        ],
        details: { model: "", files: [], error: "401" },
        isError: true,
      };
    }
    if (status === 400 && !payload.data?.length) {
      return {
        content: [
          {
            type: "text",
            text: `Magpie refused the request: ${errorMessage(payload, "HTTP 400")}. Pick an image model in magpie Settings → Images, or pass a model parameter.`,
          },
        ],
        details: { model: "", files: [], error: errorMessage(payload, "400") },
        isError: true,
      };
    }
    if (status < 200 || status >= 300 || !payload.data?.length) {
      return {
        content: [
          {
            type: "text",
            text: `Magpie image generation failed (HTTP ${status}): ${errorMessage(payload, "no image in the answer")}`,
          },
        ],
        details: { model: payload.model ?? "", files: [], error: errorMessage(payload, `HTTP ${status}`) },
        isError: true,
      };
    }

    const now = new Date();
    const files: { path: string; mimeType: string; bytes: number }[] = [];
    const images: { type: "image"; data: string; mimeType: string }[] = [];
    const lines: string[] = [];
    for (const [index, entry] of payload.data.entries()) {
      const inline = entry[B64_JSON];
      let data = typeof inline === "string" ? inline : undefined;
      let mimeType = entry.mime_type;
      if (!data && entry.url) {
        const downloaded = await fetchImageBytes(entry.url, mimeType, config.imageTimeoutMs, fetchImpl);
        data = downloaded.data;
        mimeType = downloaded.mimeType;
      }
      if (!data) continue;
      const resolvedMime = mimeType || "image/png";
      const buffer = Buffer.from(data, "base64");
      const target = targetPath(cwd, params.prompt, resolvedMime, index, now);
      await writeFile(target, buffer);
      files.push({ path: target, mimeType: resolvedMime, bytes: buffer.byteLength });
      images.push({ type: "image", data, mimeType: resolvedMime });
      lines.push(`Saved ${target} (${resolvedMime}, ${buffer.byteLength} bytes)`);
    }
    if (images.length === 0) {
      return {
        content: [{ type: "text", text: `Magpie returned no image data (HTTP ${status})` }],
        details: { model: payload.model ?? "", files: [], error: "no image data" },
        isError: true,
      };
    }

    const details: GenerateImageDetails = { model: payload.model ?? "", files };
    const revised = payload.data.find((entry) => entry.revised_prompt)?.revised_prompt;
    if (revised) details.revisedPrompt = revised;
    const text = [`Model: ${payload.model || "magpie default"}`, ...lines, revised ? `Revised prompt: ${revised}` : ""]
      .filter((line) => line.length > 0)
      .join("\n");
    return { content: [{ type: "text", text }, ...images], details };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? `Magpie image generation timed out after ${config.imageTimeoutMs}ms. Raise Image Timeout (ms) in /config for slow image models.`
        : `Magpie image generation failed: ${error instanceof Error ? error.message : String(error)}`;
    return {
      content: [{ type: "text", text: message }],
      details: { model: "", files: [], error: message },
      isError: true,
    };
  }
}

export function registerGenerateImageTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "generate_image",
    label: "Generate Image",
    description: TOOL_DESCRIPTION,
    parameters: imageParams,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    renderShell: "self",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await executeGenerateImage(params, ctx.cwd, signal);
      return { content: result.content, details: result.details, isError: result.isError };
    },
    renderCall(args, theme, context) {
      const verb = context.isPartial ? "Generating" : "Generated";
      const title = theme.fg("toolTitle", theme.bold(verb));
      const prompt =
        args.prompt.length > PROMPT_SNIPPET_CHARS ? `${args.prompt.slice(0, PROMPT_SNIPPET_CHARS)}…` : args.prompt;
      const extras = [
        args.size,
        args.n && args.n > 1 ? `x${args.n}` : undefined,
        args.reference_images?.length ? `${args.reference_images.length} ref` : undefined,
        args.model,
      ]
        .filter((part) => part !== undefined && part.length > 0)
        .join(" ");
      const suffix = extras.length > 0 ? theme.fg("dim", ` ${extras}`) : "";
      return new Text(`${title} ${theme.fg("accent", `"${prompt}"`)}${suffix}`, 0, 0);
    },
    renderResult(result, options, theme, context) {
      const pad = " ".repeat(context.outputPad);
      const details = result.details as GenerateImageDetails;
      if (context.isError) {
        const textBlock = result.content.find((block) => block.type === "text");
        const text = textBlock && textBlock.type === "text" ? textBlock.text : "image generation failed";
        return new Text(pad + theme.fg("muted", truncateToWidth(`└ ${text}`, 200, "…")), 0, 0);
      }
      if (options.expanded) {
        const lines = details.files.map((file) =>
          theme.fg("toolOutput", `saved ${file.path} (${file.mimeType}, ${file.bytes} bytes)`),
        );
        if (details.revisedPrompt) lines.push(theme.fg("dim", `revised prompt: ${details.revisedPrompt}`));
        return new Text(lines.map((line) => pad + line).join("\n"), 0, 0);
      }
      if (details.files.length === 0) return new Text("", 0, 0);
      const count = theme.fg("success", `${details.files.length} image${details.files.length === 1 ? "" : "s"}`);
      const first = theme.fg("dim", shortenPath(details.files[0].path));
      const more = details.files.length > 1 ? theme.fg("dim", ` · ${details.files.length - 1} more`) : "";
      return new Text(`${pad}${count} ${first}${more}`, 0, 0);
    },
  });
}
