import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contentHash } from "../src/core/atomic.ts";
import { readManifest } from "../src/core/manifest.ts";
import { type CaptureResult, captureSource, type FetchedContent, type UrlFetcher } from "../src/core/packet.ts";
import { vaultLayout } from "../src/core/paths.ts";

let tmpRoot: string;
let vaultRoot: string;
let sourcesDir: string;

const fixedNow = () => new Date(Date.UTC(2024, 0, 5, 8, 0, 0));

function sha(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function fakeFetcher(responses: Record<string, FetchedContent>): UrlFetcher {
  return {
    fetch: vi.fn(async (url: string): Promise<FetchedContent> => {
      const r = responses[url];
      if (!r) throw new Error(`no fake response for ${url}`);
      return r;
    }),
  };
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-packet-"));
  vaultRoot = path.join(tmpRoot, "vault");
  sourcesDir = vaultLayout(vaultRoot).sourcesRoot;
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function packetDirs(): string[] {
  return fs.existsSync(sourcesDir)
    ? fs
        .readdirSync(sourcesDir)
        .filter((d) => d.startsWith("SRC-"))
        .map((d) => path.join(sourcesDir, d))
    : [];
}

describe("captureSource — text", () => {
  it("writes manifest + original + extracted and marks ingest pending", async () => {
    const text = "# Hello\n\nSome pasted body.";
    const result = await captureSource({ sourceType: "text", text, title: "Hello" }, { sourcesDir, now: fixedNow });

    expect(result.created).toBe(true);
    expect(path.basename(result.packetDir)).toBe("SRC-2024-01-05-001");

    const manifest = readManifest(result.packetDir);
    expect(manifest.origin).toEqual({ sourceType: "text", title: "Hello" });
    expect(manifest.contentHash).toBe(sha(text));
    expect(manifest.originalName).toBe("pasted.md");
    expect(manifest.ingest).toEqual({ status: "pending" });

    expect(fs.readFileSync(path.join(result.packetDir, "original", "pasted.md"), "utf8")).toBe(text);
    expect(fs.readFileSync(path.join(result.packetDir, "extracted.md"), "utf8")).toBe(text);
  });
});

describe("captureSource — file", () => {
  it("copies the file bytes into original/, decodes extracted.md, records originPath and originHash", async () => {
    const fileBody = "# Note\n\nLocal file body.\n";
    const originPath = path.join(tmpRoot, "note.md");
    fs.writeFileSync(originPath, fileBody, "utf8");

    const result = await captureSource({ sourceType: "file", originPath }, { sourcesDir, now: fixedNow });

    expect(result.created).toBe(true);
    const manifest = readManifest(result.packetDir);

    expect(manifest.origin).toEqual({
      sourceType: "file",
      originPath,
      originHash: contentHash(fileBody),
    });
    expect(manifest.originalName).toBe("note.md");
    expect(manifest.contentHash).toBe(sha(fileBody));

    expect(fs.readFileSync(path.join(result.packetDir, "original", "note.md"), "utf8")).toBe(fileBody);
    expect(fs.readFileSync(path.join(result.packetDir, "extracted.md"), "utf8")).toBe(fileBody);
  });

  it("resolves a relative originPath against cwd to an absolute originPath", async () => {
    const rel = path.relative(process.cwd(), path.join(tmpRoot, "rel.md"));
    fs.writeFileSync(path.join(tmpRoot, "rel.md"), "rel body", "utf8");

    const result = await captureSource({ sourceType: "file", originPath: rel }, { sourcesDir, now: fixedNow });

    const manifest = readManifest(result.packetDir);
    expect(path.isAbsolute(manifest.origin.sourceType === "file" ? manifest.origin.originPath : "")).toBe(true);
    expect(manifest.origin).toMatchObject({ originPath: path.resolve(rel) });
  });

  it("rejects unsupported file types (PDF/Office/EPUB) without allocating a packet", async () => {
    const pdfPath = path.join(tmpRoot, "doc.pdf");
    fs.writeFileSync(pdfPath, Buffer.from("%PDF-1.4 not really"));

    await expect(
      captureSource({ sourceType: "file", originPath: pdfPath }, { sourcesDir, now: fixedNow }),
    ).rejects.toThrow(/PDF\/Office\/EPUB/);
    expect(packetDirs()).toEqual([]);
  });
});

describe("captureSource — url", () => {
  it("fetches via the injected UrlFetcher and stores title + contentType + content", async () => {
    const url = "https://example.com/posts/hello-world";
    const fetched: FetchedContent = {
      text: "# Hello World\n\nFetched body.\n",
      title: "Hello World",
      contentType: "text/markdown",
    };
    const fetcher = fakeFetcher({ [url]: fetched });

    const result = await captureSource({ sourceType: "url", url }, { sourcesDir, now: fixedNow, urlFetcher: fetcher });

    expect(fetcher.fetch).toHaveBeenCalledWith(url, undefined);
    expect(result.created).toBe(true);

    const manifest = readManifest(result.packetDir);
    expect(manifest.origin).toEqual({
      sourceType: "url",
      url,
      title: "Hello World",
      contentType: "text/markdown",
    });
    expect(manifest.contentHash).toBe(sha(fetched.text));
    expect(manifest.originalName).toBe("hello-world.md");

    expect(fs.readFileSync(path.join(result.packetDir, "extracted.md"), "utf8")).toBe(fetched.text);
    expect(fs.readFileSync(path.join(result.packetDir, "original", "hello-world.md"), "utf8")).toBe(fetched.text);
  });

  it("throws a clear error when no urlFetcher is configured", async () => {
    await expect(
      captureSource({ sourceType: "url", url: "https://example.com/x" }, { sourcesDir, now: fixedNow }),
    ).rejects.toThrow(/urlFetcher/i);
  });

  it("does not allocate a packet dir when the fetch fails", async () => {
    const fetcher: UrlFetcher = { fetch: vi.fn(async () => Promise.reject(new Error("boom"))) };
    await expect(
      captureSource(
        { sourceType: "url", url: "https://example.com/x" },
        { sourcesDir, now: fixedNow, urlFetcher: fetcher },
      ),
    ).rejects.toThrow("boom");
    expect(packetDirs()).toEqual([]);
  });
});

describe("captureSource — dedup (no duplicate packet for same key)", () => {
  it("returns the existing packet for a repeated file originPath without creating a new one", async () => {
    const originPath = path.join(tmpRoot, "dup.md");
    fs.writeFileSync(originPath, "body one", "utf8");

    const first = await captureSource({ sourceType: "file", originPath }, { sourcesDir, now: fixedNow });
    const second = await captureSource({ sourceType: "file", originPath }, { sourcesDir, now: fixedNow });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.packetDir).toBe(first.packetDir);
    expect(packetDirs()).toHaveLength(1);
  });

  it("returns the existing packet for a repeated url", async () => {
    const url = "https://example.com/a";
    const fetcher = fakeFetcher({ [url]: { text: "body" } });

    const first = await captureSource({ sourceType: "url", url }, { sourcesDir, now: fixedNow, urlFetcher: fetcher });
    const second = await captureSource({ sourceType: "url", url }, { sourcesDir, now: fixedNow, urlFetcher: fetcher });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.packetDir).toBe(first.packetDir);
    expect(packetDirs()).toHaveLength(1);
  });

  it("returns the existing packet for repeated identical pasted text, but creates a new one for different text", async () => {
    const a = await captureSource({ sourceType: "text", text: "same text" }, { sourcesDir, now: fixedNow });
    const b = await captureSource({ sourceType: "text", text: "same text" }, { sourcesDir, now: fixedNow });
    const c = await captureSource({ sourceType: "text", text: "different text" }, { sourcesDir, now: fixedNow });

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.packetDir).toBe(a.packetDir);
    expect(c.created).toBe(true);
    expect(c.packetDir).not.toBe(a.packetDir);
    expect(packetDirs()).toHaveLength(2);
  });

  it("treats a modified file at the same path as a duplicate (immutable capture; drift detection is lint's job)", async () => {
    const originPath = path.join(tmpRoot, "mut.md");
    fs.writeFileSync(originPath, "v1", "utf8");

    const first = await captureSource({ sourceType: "file", originPath }, { sourcesDir, now: fixedNow });
    fs.writeFileSync(originPath, "v2 totally different", "utf8");
    const second = await captureSource({ sourceType: "file", originPath }, { sourcesDir, now: fixedNow });

    expect(second.created).toBe(false);
    expect(second.packetDir).toBe(first.packetDir);
  });
});

describe("captureSource — sequence allocation", () => {
  it("increments the SRC sequence across captures of distinct sources", async () => {
    const r1 = await captureSource({ sourceType: "text", text: "one" }, { sourcesDir, now: fixedNow });
    const r2 = await captureSource({ sourceType: "text", text: "two" }, { sourcesDir, now: fixedNow });

    expect(path.basename(r1.packetDir)).toBe("SRC-2024-01-05-001");
    expect(path.basename(r2.packetDir)).toBe("SRC-2024-01-05-002");
  });
});

describe("captureSource — return shape", () => {
  it("exposes the full manifest on the CaptureResult", async () => {
    const result: CaptureResult = await captureSource(
      { sourceType: "text", text: "shape check" },
      { sourcesDir, now: fixedNow },
    );

    expect(result.manifest.id).toBe("SRC-2024-01-05-001");
    expect(result.manifest.schemaVersion).toBe(1);
    expect(result.manifest.createdAt).toBe("2024-01-05T08:00:00.000Z");
  });
});
