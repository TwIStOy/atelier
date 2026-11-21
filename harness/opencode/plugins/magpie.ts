import { tool, type Plugin } from "@opencode-ai/plugin";
import type { Model } from "@opencode-ai/sdk/v2";

const DEFAULT_MAGPIE_URL = "http://poi.li-rankine.ts.net:3425";
const DEFAULT_MAGPIE_API_KEY = "magpie-private";
const MAX_REFERENCE_IMAGES = 5;
const IMAGE_TIMEOUT_MS = 300_000;
const B64_JSON = "b64_json";

interface MagpieConfig {
  baseUrl: string;
  apiKey: string;
  imageTimeoutMs: number;
}

function loadMagpieConfig(): MagpieConfig {
  const url = process.env.MAGPIE_BASE_URL?.trim() || DEFAULT_MAGPIE_URL;
  return {
    baseUrl: `${url.replace(/\/+$/, "")}/v1`,
    apiKey: process.env.MAGPIE_API_KEY?.trim() || DEFAULT_MAGPIE_API_KEY,
    imageTimeoutMs: IMAGE_TIMEOUT_MS,
  };
}

const TOOL_DESCRIPTION = `Generate an image from a text prompt, or edit and combine existing images given as reference_images, through the Magpie gateway's image models.

Use it when the user asks for a visual: a diagram, illustration, icon, mockup, photo edit, or any image artifact. The images are saved as files in the current project directory.

- Generation takes from a few seconds to a few minutes; do not give up early or fire duplicate calls.
- Write a detailed prompt: subject, style, composition, colours, and any text to render exactly.
- For edits, pass every target image in reference_images and describe the change in prompt; preserve existing transparency unless asked otherwise.
- Set background to transparent for cutouts and background removal.
- Reference the saved file path when the user needs the image in the project.`;

interface GenerateImageParams {
  prompt: string;
  size?: string;
  n?: number;
  reference_images?: string[];
  quality?: "low" | "medium" | "high" | "xhigh" | "max" | "auto";
  background?: "transparent" | "opaque" | "auto";
  model?: string;
}

const z = tool.schema;

const generateImageArgs = {
  prompt: z
    .string()
    .describe(
      "What to draw, or how to change the reference images. Be specific: subject, style, composition, colours, and any text to render exactly.",
    ),
  size: z
    .string()
    .optional()
    .describe("WIDTHxHEIGHT (1024x1024, 1536x1024, 1024x1536) or an aspect ratio (16:9). Default: the model's."),
  n: z.number().int().min(1).max(4).optional().describe("How many images to generate (default 1)."),
  reference_images: z
    .array(z.string().describe("Image file path to edit or draw from."))
    .max(MAX_REFERENCE_IMAGES)
    .optional()
    .describe("Images to edit or combine with the prompt, as file paths. Omit for a brand new image."),
  quality: z
    .enum(["low", "medium", "high", "xhigh", "max", "auto"])
    .optional()
    .describe("Quality level, for models that take it. Default: the model's."),
  background: z
    .enum(["transparent", "opaque", "auto"])
    .optional()
    .describe("Background of the generated image: transparent for cutouts, opaque, or auto. Default: the model's."),
  model: z
    .string()
    .optional()
    .describe(
      "Magpie image model id (provider/model) or routing group (group/<id>). Default: the image model picked in magpie's Settings.",
    ),
};

const IMAGE_FORMATS = [
  { magic: [0x89, 0x50, 0x4e, 0x47], mime: "image/png", extension: "png" },
  { magic: [0xff, 0xd8, 0xff], mime: "image/jpeg", extension: "jpg" },
  { magic: [0x57, 0x45, 0x42, 0x50], mime: "image/webp", extension: "webp", offset: 8 },
  { magic: [0x47, 0x49, 0x46], mime: "image/gif", extension: "gif" },
] as const;

function sniffImageMime(bytes: Uint8Array): string | undefined {
  return IMAGE_FORMATS.find(
    (format) =>
      bytes.length >= (format.offset ?? 0) + format.magic.length &&
      format.magic.every((byte, index) => bytes[(format.offset ?? 0) + index] === byte),
  )?.mime;
}

function extensionForMime(mimeType: string): string {
  return IMAGE_FORMATS.find((format) => format.mime === mimeType)?.extension ?? "png";
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

interface MagpieImageData {
  [key: string]: unknown;
  url?: string;
  mime_type?: string;
  revised_prompt?: string;
}

interface MagpieCatalogEntry {
  id?: string;
  object?: string;
  display_name?: string;
  context_window?: number;
  context_length?: number;
  max_output_tokens?: number;
  modalities?: { input?: string[] };
  reasoning?: boolean;
  reasoning_levels?: string[];
  supported_reasoning_levels?: { effort?: string }[];
  pricing?: {
    prompt?: string;
    completion?: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
  created?: number;
}

interface MagpieModelsResponse {
  data?: MagpieCatalogEntry[];
}

const PROVIDER_ID = "magpie";
const PROVIDER_NPM = "@ai-sdk/openai-compatible";
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 16_384;
const EPOCH_RELEASE_DATE = "1970-01-01T00:00:00.000Z";

function shiftDecimal(whole: string, frac: string, scale: number): { intDigits: string; fracDigits: string } {
  if (frac.length <= scale) return { intDigits: whole + frac.padEnd(scale, "0"), fracDigits: "" };
  return { intDigits: whole + frac.slice(0, scale), fracDigits: frac.slice(scale).replace(/0+$/, "") };
}

function perMillion(perToken: string | undefined): number {
  if (!perToken) return 0;
  const trimmed = perToken.trim();
  const decimal = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!decimal) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) && numeric > 0 ? numeric * 1_000_000 : 0;
  }
  const shifted = shiftDecimal(decimal[1] ?? "0", decimal[2] ?? "", 6);
  const intDigits = shifted.intDigits.replace(/^0+(?=\d)/, "");
  const value = Number(shifted.fracDigits ? `${intDigits}.${shifted.fracDigits}` : intDigits);
  return Number.isFinite(value) ? value : 0;
}

function reasoningEfforts(entry: MagpieCatalogEntry): string[] {
  const named = entry.reasoning_levels;
  const source = named ?? entry.supported_reasoning_levels?.map((level) => level.effort ?? "") ?? [];
  return source.map((level) => level.trim().toLowerCase()).filter((level) => level.length > 0);
}

export function magpieModelsToOpenCode(payload: MagpieModelsResponse, baseUrl: string): Record<string, Model> {
  const models: Record<string, Model> = {};
  for (const entry of payload.data ?? []) {
    if (!entry.id || (entry.object !== undefined && entry.object !== "model")) continue;
    if (models[entry.id]) continue;
    models[entry.id] = magpieModelToOpenCode(entry, entry.id, baseUrl);
  }
  return models;
}

function magpieModelToOpenCode(entry: MagpieCatalogEntry, id: string, baseUrl: string): Model {
  const efforts = reasoningEfforts(entry);
  const acceptsImages = entry.modalities?.input?.includes("image") ?? false;
  return {
    id,
    providerID: PROVIDER_ID,
    api: { id, url: baseUrl, npm: PROVIDER_NPM },
    name: entry.display_name?.trim() || id,
    capabilities: {
      temperature: true,
      reasoning: entry.reasoning === true || efforts.length > 0,
      attachment: acceptsImages,
      toolcall: true,
      input: { text: true, audio: false, image: acceptsImages, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: {
      input: perMillion(entry.pricing?.prompt),
      output: perMillion(entry.pricing?.completion),
      cache: {
        read: perMillion(entry.pricing?.input_cache_read),
        write: perMillion(entry.pricing?.input_cache_write),
      },
    },
    limit: {
      context: entry.context_window ?? entry.context_length ?? DEFAULT_CONTEXT_WINDOW,
      output: entry.max_output_tokens ?? DEFAULT_MAX_TOKENS,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: entry.created ? new Date(entry.created * 1000).toISOString() : EPOCH_RELEASE_DATE,
  };
}

interface MagpieImagesResponse {
  model?: string;
  data?: MagpieImageData[];
  error?: { message?: string };
}

function errorMessage(payload: MagpieImagesResponse, fallback: string): string {
  return payload.error?.message?.trim() || fallback;
}

async function readReferenceImage(projectDir: string, path: string): Promise<string> {
  const resolved = path.startsWith("/") ? path : `${projectDir}/${path}`;
  const buffer = new Uint8Array(await Bun.file(resolved).arrayBuffer());
  const mimeType = sniffImageMime(buffer);
  if (!mimeType) throw new Error(`reference image ${path} is not a recognized PNG, JPEG, WebP, or GIF file`);
  return `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
}

async function targetPath(
  projectDir: string,
  prompt: string,
  mimeType: string,
  index: number,
  now: Date,
): Promise<string> {
  const base = `${promptSlug(prompt)}-${timestamp(now)}`;
  const extension = extensionForMime(mimeType);
  let candidate = `${projectDir}/${index === 0 ? `${base}.${extension}` : `${base}-${index + 1}.${extension}`}`;
  for (let suffix = index + 1; await Bun.file(candidate).exists(); suffix += 1) {
    candidate = `${projectDir}/${base}-${suffix}.${extension}`;
  }
  return candidate;
}

async function executeGenerateImage(
  params: GenerateImageParams,
  projectDir: string,
  config: MagpieConfig,
  signal: AbortSignal | undefined,
): Promise<{ title: string; output: string }> {
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
      dataUrls.push(await readReferenceImage(projectDir, reference));
    }
    body.images = dataUrls;
    path = "images/edits";
  }

  const timeout = AbortSignal.timeout(config.imageTimeoutMs);
  const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(new URL(path, `${config.baseUrl}/`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: attemptSignal,
  });
  const payload = (await response.json().catch(() => ({}))) as MagpieImagesResponse;

  if (response.status === 401) {
    throw new Error("Magpie rejected the gateway key (HTTP 401). Check MAGPIE_API_KEY.");
  }
  if (response.status === 400 && !payload.data?.length) {
    throw new Error(
      `Magpie refused the request: ${errorMessage(payload, "HTTP 400")}. Pick an image model in magpie Settings → Images, or pass a model parameter.`,
    );
  }
  if (response.status < 200 || response.status >= 300 || !payload.data?.length) {
    throw new Error(
      `Magpie image generation failed (HTTP ${response.status}): ${errorMessage(payload, "no image in the answer")}`,
    );
  }

  const now = new Date();
  const saved: string[] = [];
  for (const [index, entry] of payload.data.entries()) {
    const inline = entry[B64_JSON];
    let data = typeof inline === "string" ? inline : undefined;
    let mimeType = entry.mime_type;
    if (!data && entry.url) {
      const download = await fetch(entry.url, { signal: AbortSignal.timeout(config.imageTimeoutMs) });
      if (!download.ok) throw new Error(`downloading the generated image failed with HTTP ${download.status}`);
      const buffer = new Uint8Array(await download.arrayBuffer());
      data = Buffer.from(buffer).toString("base64");
      mimeType = mimeType || sniffImageMime(buffer);
    }
    if (!data) continue;
    const resolvedMime = mimeType || "image/png";
    const buffer = Buffer.from(data, "base64");
    const target = await targetPath(projectDir, params.prompt, resolvedMime, index, now);
    await Bun.write(target, buffer);
    saved.push(`${target} (${resolvedMime}, ${buffer.byteLength} bytes)`);
  }
  if (saved.length === 0) {
    throw new Error(`Magpie returned no image data (HTTP ${response.status})`);
  }

  const revised = payload.data.find((entry) => entry.revised_prompt)?.revised_prompt;
  const lines = [`Model: ${payload.model || "magpie default"}`, ...saved.map((line) => `Saved ${line}`)];
  if (revised) lines.push(`Revised prompt: ${revised}`);
  return { title: "Generate Image", output: lines.join("\n") };
}

interface OpenCodeProviderConfig {
  models?: Record<string, unknown>;
}

interface OpenCodeConfigLike {
  provider?: Record<string, OpenCodeProviderConfig>;
}

async function fetchMagpieModels(config: MagpieConfig): Promise<Record<string, Model>> {
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: { accept: "application/json", authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return magpieModelsToOpenCode((await response.json()) as MagpieModelsResponse, config.baseUrl);
  } catch (error) {
    console.error(`magpie: model catalog refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

const magpiePlugin: Plugin = async () => {
  return {
    config: async (config) => {
      const providerConfig = (config as unknown as OpenCodeConfigLike).provider?.[PROVIDER_ID];
      if (!providerConfig) return;
      const models = await fetchMagpieModels(loadMagpieConfig());
      if (Object.keys(models).length === 0) return;
      providerConfig.models = { ...(providerConfig.models ?? {}), ...models };
    },
    tool: {
      generate_image: tool({
        description: TOOL_DESCRIPTION,
        args: generateImageArgs,
        async execute(args, context) {
          const config = loadMagpieConfig();
          try {
            return await executeGenerateImage(args, context.directory, config, context.abort);
          } catch (error) {
            if (context.abort.aborted) throw error;
            const message =
              error instanceof Error && error.name === "TimeoutError"
                ? `Magpie image generation timed out after ${config.imageTimeoutMs}ms.`
                : `Magpie image generation failed: ${error instanceof Error ? error.message : String(error)}`;
            return { title: "Generate Image", output: message, metadata: { isError: true } };
          }
        },
      }),
    },
  };
};

export default magpiePlugin;
