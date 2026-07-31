import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MANIFEST_SCHEMA_VERSION,
  readManifest,
  type SourcePacketManifest,
  writeManifest,
} from "../src/core/manifest.ts";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-manifest-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function packetDir(id: string): string {
  const dir = path.join(tmpRoot, "raw", "sources", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe("writeManifest / readManifest", () => {
  it("round-trips a URL packet manifest preserving every field", () => {
    const dir = packetDir("SRC-2024-01-05-001");
    const manifest: SourcePacketManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      id: "SRC-2024-01-05-001",
      packetDir: dir,
      createdAt: "2024-01-05T08:00:00.000Z",
      origin: {
        sourceType: "url",
        url: "https://example.com/posts/hello",
        title: "Hello World",
        contentType: "text/markdown",
      },
      contentHash: "a".repeat(64),
      originalName: "hello.md",
      ingest: { status: "pending" },
    };

    writeManifest(dir, manifest);
    const back = readManifest(dir);

    expect(back).toEqual(manifest);
    expect(back.origin).toEqual({
      sourceType: "url",
      url: "https://example.com/posts/hello",
      title: "Hello World",
      contentType: "text/markdown",
    });
  });

  it("round-trips a pasted-text packet manifest", () => {
    const dir = packetDir("SRC-2024-01-05-002");
    const manifest: SourcePacketManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      id: "SRC-2024-01-05-002",
      packetDir: dir,
      createdAt: "2024-01-05T08:30:00.000Z",
      origin: { sourceType: "text", title: "Pasted note" },
      contentHash: "b".repeat(64),
      originalName: "pasted.md",
      ingest: { status: "pending" },
    };

    writeManifest(dir, manifest);
    expect(readManifest(dir)).toEqual(manifest);
    expect(readManifest(dir).origin.sourceType).toBe("text");
  });

  it("round-trips a local-file packet manifest with originPath and originHash", () => {
    const dir = packetDir("SRC-2024-01-05-003");
    const manifest: SourcePacketManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      id: "SRC-2024-01-05-003",
      packetDir: dir,
      createdAt: "2024-01-05T09:00:00.000Z",
      origin: {
        sourceType: "file",
        originPath: "/abs/path/to/note.md",
        originHash: "c".repeat(64),
      },
      contentHash: "c".repeat(64),
      originalName: "note.md",
      ingest: { status: "ingested", ingestedAt: "2024-01-06T00:00:00.000Z" },
    };

    writeManifest(dir, manifest);
    const back = readManifest(dir);

    expect(back).toEqual(manifest);
    expect(back.origin).toMatchObject({
      sourceType: "file",
      originPath: "/abs/path/to/note.md",
      originHash: "c".repeat(64),
    });
  });

  it("writes the manifest to <packetDir>/manifest.json", () => {
    const dir = packetDir("SRC-2024-01-05-004");
    const manifest: SourcePacketManifest = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      id: "SRC-2024-01-05-004",
      packetDir: dir,
      createdAt: "2024-01-05T10:00:00.000Z",
      origin: { sourceType: "text" },
      contentHash: "d".repeat(64),
      originalName: "pasted.md",
      ingest: { status: "pending" },
    };

    writeManifest(dir, manifest);

    expect(fs.existsSync(path.join(dir, "manifest.json"))).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    expect(onDisk.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
  });

  it("exposes schema version 1", () => {
    expect(MANIFEST_SCHEMA_VERSION).toBe(1);
  });
});
