import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveCacheName, isForbiddenUrl, registerGitCloneTool } from "../src/git-clone/index.ts";

describe("isForbiddenUrl", () => {
  it("rejects file:// URLs", () => {
    expect(isForbiddenUrl("file:///etc/passwd")).toBe(true);
    expect(isForbiddenUrl("FILE://relative/path")).toBe(true);
  });

  it("rejects ssh:// and git+ssh:// URLs", () => {
    expect(isForbiddenUrl("ssh://git@github.com/owner/repo.git")).toBe(true);
    expect(isForbiddenUrl("git+ssh://git@github.com/owner/repo.git")).toBe(true);
  });

  it("accepts https:// URLs", () => {
    expect(isForbiddenUrl("https://github.com/owner/repo.git")).toBe(false);
  });

  it("accepts git:// protocol", () => {
    expect(isForbiddenUrl("git://github.com/owner/repo.git")).toBe(false);
  });

  it("trims before checking", () => {
    expect(isForbiddenUrl("   file://x")).toBe(true);
  });
});

describe("deriveCacheName", () => {
  it("derives owner-repo from an https URL with .git suffix", () => {
    expect(deriveCacheName("https://github.com/octocat/Hello-World.git")).toBe("octocat-Hello-World");
  });

  it("derives owner-repo from a git URL without .git", () => {
    expect(deriveCacheName("git://github.com/sst/opencode")).toBe("sst-opencode");
  });

  it("sanitizes unusual characters in owner/repo", () => {
    expect(deriveCacheName("https://example.com/a.b/c_d/e/f")).toBe("e-f");
  });

  it("respects an explicit repo_name override", () => {
    expect(deriveCacheName("https://github.com/a/b", "my-cache")).toBe("my-cache");
  });

  it("sanitizes the override too", () => {
    expect(deriveCacheName("https://github.com/a/b", "weird name/here")).toBe("weird-name-here");
  });

  it("returns null when override is empty/whitespace and URL has no owner/repo", () => {
    expect(deriveCacheName("not-a-url", "   ")).toBeNull();
  });

  it("returns null for a URL it cannot parse", () => {
    expect(deriveCacheName("https://example.com")).toBeNull();
  });
});

describe("git_clone abort", () => {
  const stallServer = http.createServer(() => {});
  let stallPort = 0;
  const cacheName = "git-clone-abort-test";
  const cachePath = path.join(tmpdir(), "scout-cache", cacheName);

  beforeAll(async () => {
    await new Promise<void>((resolve) => stallServer.listen(0, "127.0.0.1", resolve));
    stallPort = (stallServer.address() as { port: number }).port;
  });

  afterAll(() => {
    stallServer.close();
    rmSync(cachePath, { recursive: true, force: true });
    try {
      execSync(`pkill -f 'scout-cache/${cacheName}' || true`);
    } catch {
      // already gone
    }
  });

  function captureTool(): ToolDefinition {
    let captured: ToolDefinition | undefined;
    const fake = {
      registerTool: (definition: ToolDefinition) => {
        captured = definition;
      },
    } as unknown as ExtensionAPI;
    registerGitCloneTool(fake);
    if (!captured) throw new Error("tool was not registered");
    return captured;
  }

  it("settles promptly and kills the process group when aborted mid-clone", { timeout: 20_000 }, async () => {
    rmSync(cachePath, { recursive: true, force: true });
    const tool = captureTool();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const started = Date.now();
    await expect(
      tool.execute(
        "call_abort_1",
        { url: `http://127.0.0.1:${stallPort}/hang.git`, repo_name: cacheName },
        controller.signal,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow(/aborted/);
    expect(Date.now() - started).toBeLessThan(5_000);

    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const survivors = execSync("pgrep -af 'git' || true").toString();
      if (!survivors.includes(`scout-cache/${cacheName}`)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const survivors = execSync("pgrep -af 'git' || true").toString();
    expect(survivors.includes(`scout-cache/${cacheName}`)).toBe(false);
  });
});
