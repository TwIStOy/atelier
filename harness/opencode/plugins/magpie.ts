import { Model, Plugin, Provider } from "@opencode/plugin";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_MAGPIE_URL = "http://poi.li-rankine.ts.net:3425";
const DEFAULT_MAGPIE_API_KEY = "magpie-private";
const PROVIDER_ID = "magpie";
const PROVIDER_NAME = "Magpie";
const PROVIDER_PACKAGE = "@opencode/ai/providers/openai-compatible";
const MAX_REFERENCE_IMAGES = 5;
const IMAGE_TIMEOUT_MS = 300_000;
const CATALOG_TIMEOUT_MS = 10_000;
const B64_JSON = "b64_json";
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 32_000;

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

interface MagpieCatalogEntry {
  id?: string;
  object?: string;
  display_name?: string;
  context_window?: number;
  context_length?: number;
  max_output_tokens?: number;
  modalities?: { input?: string[]; output?: string[] };
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

function modelInputs(entry: MagpieCatalogEntry): string[] {
  const advertised = entry.modalities?.input ?? [];
  const inputs = ["text", ...advertised.filter((modality) => modality !== "text")];
  return [...new Set(inputs)];
}

function modelOutputs(entry: MagpieCatalogEntry): string[] {
  const advertised = entry.modalities?.output ?? [];
  return advertised.length > 0 ? [...new Set(advertised)] : ["text"];
}

function toModelInfo(entry: MagpieCatalogEntry, providerID: Provider.ID): Model.Info | undefined {
  if (!entry.id || (entry.object !== undefined && entry.object !== "model")) return undefined;
  return {
    ...Model.Info.default(providerID, Model.ID.make(entry.id)),
    name: entry.display_name?.trim() || entry.id,
    capabilities: {
      tools: true,
      input: modelInputs(entry),
      output: modelOutputs(entry),
    },
    cost: [
      {
        input: perMillion(entry.pricing?.prompt),
        output: perMillion(entry.pricing?.completion),
        cache: {
          read: perMillion(entry.pricing?.input_cache_read),
          write: perMillion(entry.pricing?.input_cache_write),
        },
      },
    ],
    limit: {
      context: entry.context_window ?? entry.context_length ?? DEFAULT_CONTEXT_WINDOW,
      output: entry.max_output_tokens ?? DEFAULT_MAX_TOKENS,
    },
    time: { released: entry.created ?? 0 },
  };
}

async function fetchMagpieModels(config: MagpieConfig, providerID: Provider.ID): Promise<Model.Info[]> {
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: { accept: "application/json", authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as MagpieModelsResponse;
    const models: Model.Info[] = [];
    const seen = new Set<string>();
    for (const entry of payload.data ?? []) {
      const model = toModelInfo(entry, providerID);
      if (!model || seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
    return models;
  } catch (error) {
    console.error(`magpie: model catalog refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

const TOOL_DESCRIPTION = `Generate an image from a text prompt, or edit and combine existing images given as reference_images, through the Magpie gateway's image models.

Use it when the user asks for a visual: a diagram, illustration, icon, mockup, photo edit, or any image artifact. The images are saved as files in the current project directory.

- Generation takes from a few seconds to a few minutes; do not give up early or fire duplicate calls.
- Write a detailed prompt: subject, style, composition, colours, and any text to render exactly.
- For edits, pass every target image in reference_images and describe the change in prompt; preserve existing transparency unless asked otherwise.
- Set background to transparent for cutouts and background removal.
- Reference the saved file path when the user needs the image in the project.`;

const GENERATE_IMAGE_INPUT = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      description:
        "What to draw, or how to change the reference images. Be specific: subject, style, composition, colours, and any text to render exactly.",
    },
    size: {
      type: "string",
      description: "WIDTHxHEIGHT (1024x1024, 1536x1024, 1024x1536) or an aspect ratio (16:9). Default: the model's.",
    },
    n: { type: "integer", minimum: 1, maximum: 4, description: "How many images to generate (default 1)." },
    reference_images: {
      type: "array",
      items: { type: "string" },
      maxItems: MAX_REFERENCE_IMAGES,
      description: "Images to edit or combine with the prompt, as file paths. Omit for a brand new image.",
    },
    quality: {
      type: "string",
      enum: ["low", "medium", "high", "xhigh", "max", "auto"],
      description: "Quality level, for models that take it. Default: the model's.",
    },
    background: {
      type: "string",
      enum: ["transparent", "opaque", "auto"],
      description: "Background of the generated image: transparent for cutouts, opaque, or auto. Default: the model's.",
    },
    model: {
      type: "string",
      description:
        "Magpie image model id (provider/model) or routing group (group/<id>). Default: the image model picked in magpie's Settings.",
    },
  },
  required: ["prompt"],
  additionalProperties: false,
} as const;

interface GenerateImageParams {
  prompt: string;
  size?: string;
  n?: number;
  reference_images?: string[];
  quality?: "low" | "medium" | "high" | "xhigh" | "max" | "auto";
  background?: "transparent" | "opaque" | "auto";
  model?: string;
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

interface SavedImage {
  path: string;
  mimeType: string;
  bytes: number;
}

function targetPath(projectDir: string, prompt: string, mimeType: string, index: number, now: Date): string {
  const base = `${promptSlug(prompt)}-${timestamp(now)}`;
  const extension = extensionForMime(mimeType);
  let candidate = join(projectDir, index === 0 ? `${base}.${extension}` : `${base}-${index + 1}.${extension}`);
  for (let suffix = index + 1; existsSync(candidate); suffix += 1) {
    candidate = join(projectDir, `${base}-${suffix}.${extension}`);
  }
  return candidate;
}

async function readReferenceImage(projectDir: string, path: string): Promise<string> {
  const resolved = path.startsWith("/") ? path : join(projectDir, path);
  const buffer = new Uint8Array(await readFile(resolved));
  const mimeType = sniffImageMime(buffer);
  if (!mimeType) throw new Error(`reference image ${path} is not a recognized PNG, JPEG, WebP, or GIF file`);
  return `data:${mimeType};base64,${Buffer.from(buffer).toString("base64")}`;
}

async function executeGenerateImage(
  params: GenerateImageParams,
  projectDir: string,
  config: MagpieConfig,
  signal: AbortSignal | undefined,
): Promise<{ content: { type: "text"; text: string }[] | string; images: SavedImage[] }> {
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
  const images: SavedImage[] = [];
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
    const target = targetPath(projectDir, params.prompt, resolvedMime, index, now);
    await writeFile(target, buffer);
    images.push({ path: target, mimeType: resolvedMime, bytes: buffer.byteLength });
  }
  if (images.length === 0) {
    throw new Error(`Magpie returned no image data (HTTP ${response.status})`);
  }

  const revised = payload.data.find((entry) => entry.revised_prompt)?.revised_prompt;
  const lines = [`Model: ${payload.model || "magpie default"}`, ...images.map((image) => `Saved ${image.path} (${image.mimeType}, ${image.bytes} bytes)`)];
  if (revised) lines.push(`Revised prompt: ${revised}`);
  return { content: lines.map((line) => ({ type: "text", text: line })), images };
}

const magpiePlugin = Plugin.define({
  id: "magpie",
  async setup(ctx) {
    const config = loadMagpieConfig();
    const providerID = Provider.ID.make(PROVIDER_ID);

    const models = await fetchMagpieModels(config, providerID);
    await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(providerID),
          name: PROVIDER_NAME,
          activation: "enabled",
          package: PROVIDER_PACKAGE,
          settings: { baseURL: config.baseUrl, apiKey: config.apiKey },
        },
        models,
      });
    });

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "generate_image",
        description: TOOL_DESCRIPTION,
        input: GENERATE_IMAGE_INPUT,
        async execute(input, context) {
          const params = input as GenerateImageParams;
          const toolConfig = loadMagpieConfig();
          try {
            const result = await executeGenerateImage(params, ctx.location.directory, toolConfig, context.signal);
            const files = result.images.map((image) => ({
              type: "file" as const,
              uri: `file://${image.path}`,
              mime: image.mimeType,
              name: image.path.split("/").pop() ?? image.mimeType,
            }));
            return { content: [...(Array.isArray(result.content) ? result.content : []), ...files] };
          } catch (error) {
            if (context.signal.aborted) throw error;
            const message =
              error instanceof Error && error.name === "TimeoutError"
                ? `Magpie image generation timed out after ${toolConfig.imageTimeoutMs}ms.`
                : `Magpie image generation failed: ${error instanceof Error ? error.message : String(error)}`;
            return { content: message, metadata: { isError: true } };
          }
        },
      });
    });
  },
});

export default magpiePlugin;
