import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidPageName, PageStore, pageNameFromFile } from "../src/store.ts";

describe("isValidPageName", () => {
  it("accepts simple slugs", () => {
    expect(isValidPageName("dash")).toBe(true);
    expect(isValidPageName("eval-board_2")).toBe(true);
    expect(isValidPageName("A")).toBe(true);
  });

  it("rejects unsafe names", () => {
    expect(isValidPageName("")).toBe(false);
    expect(isValidPageName("-lead")).toBe(false);
    expect(isValidPageName("has space")).toBe(false);
    expect(isValidPageName("a/b")).toBe(false);
    expect(isValidPageName("../etc")).toBe(false);
    expect(isValidPageName("x".repeat(65))).toBe(false);
  });
});

describe("pageNameFromFile", () => {
  it("maps html files to page names", () => {
    expect(pageNameFromFile("dash.html")).toBe("dash");
    expect(pageNameFromFile("notes.txt")).toBeNull();
    expect(pageNameFromFile(".hidden.html")).toBeNull();
    expect(pageNameFromFile("dash.html.123.456.tmp")).toBeNull();
  });
});

describe("PageStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "canvas-store-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("upserts and retrieves pages", () => {
    const store = new PageStore(dir);
    store.upsert("dash", "<html>v1</html>");
    expect(store.get("dash")?.html).toBe("<html>v1</html>");

    store.upsert("dash", "<html>v2</html>");
    expect(store.get("dash")?.html).toBe("<html>v2</html>");
    expect(store.list()).toHaveLength(1);
  });

  it("lists pages sorted by updatedAt descending", async () => {
    const store = new PageStore(dir);
    store.upsert("old", "<html>old</html>");
    await new Promise((r) => setTimeout(r, 5));
    store.upsert("new", "<html>new</html>");
    expect(store.list().map((p) => p.name)).toEqual(["new", "old"]);
  });

  it("persists pages to disk and shares them across store instances", () => {
    const a = new PageStore(dir);
    a.upsert("dash", "<html>persisted</html>");
    expect(readdirSync(dir)).toContain("dash.html");

    const b = new PageStore(dir);
    expect(b.get("dash")?.html).toBe("<html>persisted</html>");
    expect(b.list()).toHaveLength(1);
  });

  it("sees files written outside the store", () => {
    writeFileSync(join(dir, "external.html"), "<html>ext</html>");
    writeFileSync(join(dir, "not-a-page.txt"), "x");
    const store = new PageStore(dir);
    expect(store.list().map((p) => p.name)).toEqual(["external"]);
  });

  it("removes pages from disk", () => {
    const store = new PageStore(dir);
    store.upsert("dash", "<html>x</html>");
    expect(store.remove("dash")).toBe(true);
    expect(store.get("dash")).toBeUndefined();
    expect(existsSync(join(dir, "dash.html"))).toBe(false);
    expect(store.remove("dash")).toBe(false);
  });

  it("list on missing directory is empty", () => {
    const store = new PageStore(join(dir, "missing"));
    expect(store.list()).toHaveLength(0);
  });

  it("tracks recent writes for watcher suppression", async () => {
    const store = new PageStore(dir);
    store.upsert("dash", "<html>x</html>");
    expect(store.recentlyWritten("dash")).toBe(true);
    expect(store.recentlyWritten("other")).toBe(false);
    expect(store.recentlyWritten("dash", 0)).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(store.recentlyWritten("dash", 5)).toBe(false);
  });
});
