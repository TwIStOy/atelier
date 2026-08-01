import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentHash } from "../src/core/atomic.ts";
import { scanInbox } from "../src/core/inbox.ts";
import { type SourcePacketManifest, writeManifest } from "../src/core/manifest.ts";
import { vaultLayout } from "../src/core/paths.ts";

let tmpRoot: string;
let vaultRoot: string;

const sha = (text: string): string => contentHash(Buffer.from(text, "utf8"));

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-inbox-"));
  vaultRoot = path.join(tmpRoot, "vault");
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function inboxFile(name: string, content: string): string {
  const abs = path.join(vaultLayout(vaultRoot).inbox, name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return abs;
}

function writeFileSourceManifest(
  packetId: string,
  originPath: string,
  originHash: string,
  overrides: Partial<SourcePacketManifest> = {},
): void {
  const dir = path.join(vaultLayout(vaultRoot).sourcesRoot, packetId);
  fs.mkdirSync(dir, { recursive: true });
  const manifest: SourcePacketManifest = {
    schemaVersion: 1,
    id: packetId,
    packetDir: dir,
    createdAt: "2024-01-05T09:00:00.000Z",
    origin: { sourceType: "file", originPath, originHash },
    contentHash: originHash,
    ingest: { status: "pending" },
    ...overrides,
  };
  writeManifest(dir, manifest);
}

describe("scanInbox", () => {
  it("lists inbox files with no matching Source Packet as uncaptured", () => {
    inboxFile("new.md", "# New source\n");

    const scan = scanInbox(vaultRoot);

    expect(scan.uncaptured.map((f) => f.name)).toEqual(["new.md"]);
    expect(scan.modified).toEqual([]);
    expect(scan.captured).toEqual([]);
    expect(scan.uncaptured[0]?.relPath).toBe("inbox/new.md");
    expect(path.isAbsolute(scan.uncaptured[0]?.path ?? "")).toBe(true);
  });

  it("flags an inbox file whose originHash changed as modified", () => {
    const abs = inboxFile("changed.md", "updated body");
    writeFileSourceManifest("SRC-2024-01-05-001", abs, sha("original body"));

    const scan = scanInbox(vaultRoot);

    expect(scan.uncaptured).toEqual([]);
    expect(scan.modified.map((f) => f.name)).toEqual(["changed.md"]);
    expect(scan.captured).toEqual([]);
  });

  it("treats an inbox file captured unchanged as captured (no drift)", () => {
    const abs = inboxFile("stable.md", "stable body");
    writeFileSourceManifest("SRC-2024-01-05-001", abs, sha("stable body"));

    const scan = scanInbox(vaultRoot);

    expect(scan.uncaptured).toEqual([]);
    expect(scan.modified).toEqual([]);
    expect(scan.captured.map((f) => f.name)).toEqual(["stable.md"]);
  });

  it("ignores non-text files in the inbox", () => {
    const abs = inboxFile("report.pdf", "binary");
    fs.writeFileSync(path.join(vaultLayout(vaultRoot).inbox, "image.png"), "x");
    void abs;

    const scan = scanInbox(vaultRoot);

    expect(scan.uncaptured).toEqual([]);
    expect(scan.modified).toEqual([]);
    expect(scan.captured).toEqual([]);
  });

  it("ignores url/text packets when matching inbox files", () => {
    const abs = inboxFile("only-text.md", "hi");
    const dir = path.join(vaultLayout(vaultRoot).sourcesRoot, "SRC-2024-01-05-001");
    fs.mkdirSync(dir, { recursive: true });
    writeManifest(dir, {
      schemaVersion: 1,
      id: "SRC-2024-01-05-001",
      packetDir: dir,
      createdAt: "2024-01-05T09:00:00.000Z",
      origin: { sourceType: "url", url: "https://example.com/x" },
      contentHash: sha(abs),
      ingest: { status: "pending" },
    });

    const scan = scanInbox(vaultRoot);

    expect(scan.uncaptured.map((f) => f.name)).toEqual(["only-text.md"]);
  });

  it("returns empty lists when the inbox dir does not exist", () => {
    const scan = scanInbox(vaultRoot);
    expect(scan.uncaptured).toEqual([]);
    expect(scan.modified).toEqual([]);
    expect(scan.captured).toEqual([]);
    expect(scan.inboxDir).toBe(vaultLayout(vaultRoot).inbox);
  });

  it("skips subdirectories inside the inbox (top-level files only)", () => {
    fs.mkdirSync(path.join(vaultLayout(vaultRoot).inbox, "nested"), { recursive: true });
    fs.writeFileSync(path.join(vaultLayout(vaultRoot).inbox, "nested", "deep.md"), "x");
    inboxFile("top.md", "top");

    const scan = scanInbox(vaultRoot);

    expect(scan.uncaptured.map((f) => f.name)).toEqual(["top.md"]);
  });
});
