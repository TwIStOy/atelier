import * as fs from "node:fs";
import * as path from "node:path";
import { atomicWriteFile } from "./atomic.ts";

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_FILENAME = "manifest.json";

export type SourceType = "url" | "text" | "file";

export interface ManifestOriginUrl {
  sourceType: "url";
  url: string;
  title?: string;
  contentType?: string;
}

export interface ManifestOriginText {
  sourceType: "text";
  title?: string;
}

export interface ManifestOriginFile {
  sourceType: "file";
  originPath: string;
  originHash: string;
  title?: string;
}

export type ManifestOrigin = ManifestOriginUrl | ManifestOriginText | ManifestOriginFile;

export type IngestStatus = "pending" | "ingested" | "skipped";

export interface IngestState {
  status: IngestStatus;
  ingestedAt?: string;
}

export interface SourcePacketManifest {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  id: string;
  packetDir: string;
  createdAt: string;
  origin: ManifestOrigin;
  contentHash: string;
  originalName?: string;
  ingest: IngestState;
}

export function manifestPath(packetDir: string): string {
  return path.join(packetDir, MANIFEST_FILENAME);
}

export function writeManifest(packetDir: string, manifest: SourcePacketManifest): void {
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  atomicWriteFile(manifestPath(packetDir), json);
}

export function readManifest(packetDir: string): SourcePacketManifest {
  return JSON.parse(fs.readFileSync(manifestPath(packetDir), "utf8")) as SourcePacketManifest;
}

export function readManifestSafe(packetDir: string): SourcePacketManifest | null {
  const file = manifestPath(packetDir);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as SourcePacketManifest;
  } catch {
    return null;
  }
}
