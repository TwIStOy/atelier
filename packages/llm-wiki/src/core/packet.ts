import * as fs from "node:fs";
import * as path from "node:path";
import { allocateSourcePacket, atomicWriteFile, contentHash } from "./atomic.ts";
import { MANIFEST_SCHEMA_VERSION, readManifest, type SourcePacketManifest, writeManifest } from "./manifest.ts";

const EXTRACTED_FILENAME = "extracted.md";
const ORIGINAL_DIR = "original";
const TEXT_ORIGINAL_NAME = "pasted.md";
const TEXT_FILE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".text"]);

export interface FetchedContent {
  text: string;
  title?: string;
  contentType?: string;
}

export interface UrlFetcher {
  fetch(url: string, signal?: AbortSignal): Promise<FetchedContent>;
}

export interface CaptureUrlInput {
  sourceType: "url";
  url: string;
  title?: string;
}

export interface CaptureTextInput {
  sourceType: "text";
  text: string;
  title?: string;
}

export interface CaptureFileInput {
  sourceType: "file";
  originPath: string;
  title?: string;
}

export type CaptureInput = CaptureUrlInput | CaptureTextInput | CaptureFileInput;

export interface SourcePacketStoreOptions {
  sourcesDir: string;
  now?: () => Date;
  urlFetcher?: UrlFetcher;
  signal?: AbortSignal;
}

export interface CaptureResult {
  packetDir: string;
  manifest: SourcePacketManifest;
  created: boolean;
}

interface PreparedPacket {
  origin: SourcePacketManifest["origin"];
  extractedText: string;
  originalName: string;
  originalBytes: Buffer;
}

async function preparePacket(input: CaptureInput, options: SourcePacketStoreOptions): Promise<PreparedPacket> {
  switch (input.sourceType) {
    case "text": {
      const originalBytes = Buffer.from(input.text, "utf8");
      return {
        origin: { sourceType: "text", ...(input.title !== undefined ? { title: input.title } : {}) },
        extractedText: input.text,
        originalName: TEXT_ORIGINAL_NAME,
        originalBytes,
      };
    }
    case "file": {
      const originPath = path.resolve(input.originPath);
      const ext = path.extname(originPath).toLowerCase();
      if (!TEXT_FILE_EXTENSIONS.has(ext)) {
        throw new Error(
          `unsupported source file extension "${ext || "(none)"}: only .md/.markdown/.txt/.text are supported (PDF/Office/EPUB are not)`,
        );
      }
      const originalBytes = fs.readFileSync(originPath);
      return {
        origin: {
          sourceType: "file",
          originPath,
          originHash: contentHash(originalBytes),
          ...(input.title !== undefined ? { title: input.title } : {}),
        },
        extractedText: originalBytes.toString("utf8"),
        originalName: path.basename(originPath),
        originalBytes,
      };
    }
    case "url": {
      if (!options.urlFetcher) {
        throw new Error("a urlFetcher is required to capture a url source");
      }
      const fetched = await options.urlFetcher.fetch(input.url, options.signal);
      const originalBytes = Buffer.from(fetched.text, "utf8");
      const title = input.title ?? fetched.title;
      return {
        origin: {
          sourceType: "url",
          url: input.url,
          ...(title !== undefined ? { title } : {}),
          ...(fetched.contentType !== undefined ? { contentType: fetched.contentType } : {}),
        },
        extractedText: fetched.text,
        originalName: deriveOriginalName(input.url),
        originalBytes,
      };
    }
    default: {
      const exhaustive: never = input;
      throw new Error(`unsupported capture sourceType: ${String((exhaustive as { sourceType?: string }).sourceType)}`);
    }
  }
}

function deriveOriginalName(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return "page.md";
  }
  const base = path.basename(pathname).toLowerCase();
  const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "page"}.md`;
}

function listPacketDirs(sourcesDir: string): string[] {
  if (!fs.existsSync(sourcesDir)) return [];
  return fs
    .readdirSync(sourcesDir)
    .filter((name) => name.startsWith("SRC-"))
    .map((name) => path.join(sourcesDir, name))
    .filter((dir) => fs.statSync(dir).isDirectory());
}

function findExistingPacket(sourcesDir: string, input: CaptureInput): SourcePacketManifest | null {
  let target: (manifest: SourcePacketManifest) => boolean;
  switch (input.sourceType) {
    case "file": {
      const originPath = path.resolve(input.originPath);
      target = (m) => m.origin.sourceType === "file" && m.origin.originPath === originPath;
      break;
    }
    case "url":
      target = (m) => m.origin.sourceType === "url" && m.origin.url === input.url;
      break;
    case "text": {
      const hash = contentHash(input.text);
      target = (m) => m.origin.sourceType === "text" && m.contentHash === hash;
      break;
    }
    default: {
      const exhaustive: never = input;
      throw new Error(`unsupported capture sourceType: ${String((exhaustive as { sourceType?: string }).sourceType)}`);
    }
  }

  for (const dir of listPacketDirs(sourcesDir)) {
    const manifestFile = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestFile)) continue;
    let manifest: SourcePacketManifest;
    try {
      manifest = readManifest(dir);
    } catch {
      continue;
    }
    if (target(manifest)) return manifest;
  }
  return null;
}

export async function captureSource(input: CaptureInput, options: SourcePacketStoreOptions): Promise<CaptureResult> {
  const existing = findExistingPacket(options.sourcesDir, input);
  if (existing) {
    return { packetDir: existing.packetDir, manifest: existing, created: false };
  }

  const now = options.now ?? (() => new Date());
  const date = now();
  const prepared = await preparePacket(input, options);
  const packetDir = allocateSourcePacket(options.sourcesDir, date);
  const id = path.basename(packetDir);

  atomicWriteFile(path.join(packetDir, ORIGINAL_DIR, prepared.originalName), prepared.originalBytes);
  atomicWriteFile(path.join(packetDir, EXTRACTED_FILENAME), prepared.extractedText);

  const manifest: SourcePacketManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    id,
    packetDir,
    createdAt: date.toISOString(),
    origin: prepared.origin,
    contentHash: contentHash(prepared.extractedText),
    originalName: prepared.originalName,
    ingest: { status: "pending" },
  };
  writeManifest(packetDir, manifest);

  return { packetDir, manifest, created: true };
}
