import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allocateSourcePacket, appendJsonl, atomicWriteFile, contentHash } from "../src/core/atomic.ts";

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "llm-wiki-atomic-"));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("contentHash", () => {
  it("returns the sha256 hex digest of the content", () => {
    expect(contentHash("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("is stable across calls and encodes UTF-8 bytes", () => {
    expect(contentHash("héllo")).toBe(contentHash("héllo"));
    expect(contentHash("héllo")).not.toBe(contentHash("hello"));
  });

  it("hashes a Buffer identically to its string form (UTF-8)", () => {
    expect(contentHash(Buffer.from("hello", "utf8"))).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("atomicWriteFile", () => {
  it("writes the content to the target path", () => {
    const target = path.join(tmpRoot, "note.md");
    atomicWriteFile(target, "# Hello\n");
    expect(fs.readFileSync(target, "utf8")).toBe("# Hello\n");
  });

  it("leaves no temporary file behind", () => {
    const target = path.join(tmpRoot, "deep", "note.md");
    atomicWriteFile(target, "body");
    const leftover = fs.readdirSync(path.join(tmpRoot, "deep")).filter((f) => f.endsWith(".tmp"));
    expect(leftover).toEqual([]);
  });

  it("overwrites an existing file", () => {
    const target = path.join(tmpRoot, "note.md");
    atomicWriteFile(target, "first");
    atomicWriteFile(target, "second");
    expect(fs.readFileSync(target, "utf8")).toBe("second");
  });

  it("creates missing parent directories", () => {
    const target = path.join(tmpRoot, "a", "b", "c", "note.md");
    atomicWriteFile(target, "deep");
    expect(fs.readFileSync(target, "utf8")).toBe("deep");
  });

  it("accepts a Buffer and persists its bytes", () => {
    const target = path.join(tmpRoot, "bin.dat");
    const buf = Buffer.from([0x00, 0xff, 0x10, 0x20]);
    atomicWriteFile(target, buf);
    const digest = crypto.createHash("sha256").update(buf).digest("hex");
    expect(contentHash(fs.readFileSync(target))).toBe(digest);
  });
});

describe("appendJsonl", () => {
  it("appends each record as a JSON line terminated by a newline", () => {
    const file = path.join(tmpRoot, "events.jsonl");
    appendJsonl(file, { type: "a", n: 1 });
    appendJsonl(file, { type: "b", n: 2 });

    const lines = fs.readFileSync(file, "utf8").split("\n");
    expect(lines.at(-1)).toBe("");
    expect(lines.slice(0, -1)).toEqual(['{"type":"a","n":1}', '{"type":"b","n":2}']);
  });

  it("creates missing parent directories on first write", () => {
    const file = path.join(tmpRoot, "meta", "deep", "events.jsonl");
    appendJsonl(file, { ok: true });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ ok: true });
  });

  it("produces lines that each parse as valid JSON", () => {
    const file = path.join(tmpRoot, "events.jsonl");
    appendJsonl(file, { unicode: "héllo→world", nested: { a: [1, 2, 3] } });
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(parsed).toEqual({ unicode: "héllo→world", nested: { a: [1, 2, 3] } });
  });
});

describe("allocateSourcePacket", () => {
  const fixedDate = new Date(Date.UTC(2024, 0, 5));

  it("allocates SRC-YYYY-MM-DD-001 and creates the directory on first call", () => {
    const dir = path.join(tmpRoot, "raw", "sources");
    const allocated = allocateSourcePacket(dir, fixedDate);

    expect(path.basename(allocated)).toBe("SRC-2024-01-05-001");
    expect(fs.existsSync(allocated)).toBe(true);
    expect(fs.statSync(allocated).isDirectory()).toBe(true);
  });

  it("increments the sequence on each subsequent call for the same day", () => {
    const dir = path.join(tmpRoot, "raw", "sources");
    const first = allocateSourcePacket(dir, fixedDate);
    const second = allocateSourcePacket(dir, fixedDate);
    const third = allocateSourcePacket(dir, fixedDate);

    expect(path.basename(first)).toBe("SRC-2024-01-05-001");
    expect(path.basename(second)).toBe("SRC-2024-01-05-002");
    expect(path.basename(third)).toBe("SRC-2024-01-05-003");
  });

  it("skips an already-claimed sequence number (mkdir EEXIST retry)", () => {
    const dir = path.join(tmpRoot, "raw", "sources");
    fs.mkdirSync(path.join(dir, "SRC-2024-01-05-001"), { recursive: true });

    const allocated = allocateSourcePacket(dir, fixedDate);

    expect(path.basename(allocated)).toBe("SRC-2024-01-05-002");
  });

  it("scopes sequences per calendar day", () => {
    const dir = path.join(tmpRoot, "raw", "sources");
    const dayA = allocateSourcePacket(dir, new Date(Date.UTC(2024, 0, 5)));
    const dayB = allocateSourcePacket(dir, new Date(Date.UTC(2024, 0, 6)));

    expect(path.basename(dayA)).toBe("SRC-2024-01-05-001");
    expect(path.basename(dayB)).toBe("SRC-2024-01-06-001");
  });

  it("creates the sources directory if it does not exist", () => {
    const dir = path.join(tmpRoot, "deep", "raw", "sources");
    expect(fs.existsSync(dir)).toBe(false);
    const allocated = allocateSourcePacket(dir, fixedDate);
    expect(fs.existsSync(allocated)).toBe(true);
  });
});
