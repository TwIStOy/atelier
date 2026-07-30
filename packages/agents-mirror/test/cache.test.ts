import { beforeEach, describe, expect, it } from "vitest";
import { InjectionCache } from "../src/cache.ts";

describe("InjectionCache", () => {
  let cache: InjectionCache;

  beforeEach(() => {
    cache = new InjectionCache();
  });

  it("marks and detects injected directories per session", () => {
    cache.markInjected("s1", "/a");
    expect(cache.hasInjected("s1", "/a")).toBe(true);
    expect(cache.hasInjected("s1", "/b")).toBe(false);
    expect(cache.hasInjected("s2", "/a")).toBe(false);
  });

  it("counts and lists injected directories", () => {
    cache.markInjected("s1", "/a");
    cache.markInjected("s1", "/b");
    expect(cache.getCacheSize("s1")).toBe(2);
    expect(cache.listInjected("s1").sort()).toEqual(["/a", "/b"]);
  });

  it("clears a single session without touching others", () => {
    cache.markInjected("s1", "/a");
    cache.markInjected("s2", "/b");
    cache.clearSession("s1");
    expect(cache.getCacheSize("s1")).toBe(0);
    expect(cache.getCacheSize("s2")).toBe(1);
  });
});
