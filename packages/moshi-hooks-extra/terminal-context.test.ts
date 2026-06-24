import { describe, expect, test } from "vitest";
import {
  contextFromMoshiJson,
  EMPTY_TERMINAL_CONTEXT,
  parseMoshiContextJson,
  probeTerminalContext,
  resetTerminalContextCache,
} from "./terminal-context.ts";

const HERDR_PAYLOAD = JSON.stringify({
  kind: "herdr",
  herdr: {
    session: "wow-addon-profile",
    rawSession: "",
    paneId: "w654c673a848702-1",
    workspaceId: "w654c673a848702",
    tabId: "w654c673a848702:1",
    tab: "1",
  },
  cwd: "/home/hawtian/pi-extensions",
  git: { repo: "/home/hawtian/pi-extensions", branch: "master", dirty: false },
});

describe("parseMoshiContextJson", () => {
  test("parses valid JSON", () => {
    const parsed = parseMoshiContextJson(HERDR_PAYLOAD);
    expect(parsed?.kind).toBe("herdr");
    expect(parsed?.herdr?.paneId).toBe("w654c673a848702-1");
  });

  test("returns null on garbage", () => {
    expect(parseMoshiContextJson("not json")).toBeNull();
  });

  test("returns null on empty input", () => {
    expect(parseMoshiContextJson("")).toBeNull();
    expect(parseMoshiContextJson("   ")).toBeNull();
  });
});

describe("contextFromMoshiJson", () => {
  test("maps herdr fields to envelope keys", () => {
    const parsed = parseMoshiContextJson(HERDR_PAYLOAD);
    const ctx = contextFromMoshiJson(parsed);
    expect(ctx.terminalKind).toBe("herdr");
    expect(ctx.herdrSession).toBe("wow-addon-profile");
    expect(ctx.herdrPane).toBe("w654c673a848702-1");
    expect(ctx.herdrWorkspaceId).toBe("w654c673a848702");
    expect(ctx.herdrTabId).toBe("w654c673a848702:1");
    expect(ctx.tmuxSession).toBe("");
  });

  test("maps tmux payload", () => {
    const ctx = contextFromMoshiJson({
      kind: "tmux",
      tmux: { session: "main", window: "0", pane: "%3" },
    });
    expect(ctx.terminalKind).toBe("tmux");
    expect(ctx.tmuxSession).toBe("main");
    expect(ctx.tmuxWindow).toBe("0");
    expect(ctx.tmuxPane).toBe("%3");
  });

  test("maps zellij payload", () => {
    const ctx = contextFromMoshiJson({
      kind: "zellij",
      zellij: { session: "z1", pane: "p1" },
    });
    expect(ctx.terminalKind).toBe("zellij");
    expect(ctx.zellijSession).toBe("z1");
    expect(ctx.zellijPane).toBe("p1");
  });

  test("null input yields empty context", () => {
    expect(contextFromMoshiJson(null)).toEqual(EMPTY_TERMINAL_CONTEXT);
  });
});

describe("probeTerminalContext", () => {
  test("returns context when moshi-hook context prints JSON", () => {
    const spawnSync = ((bin: string, args: string[]) => {
      expect(bin).toBe("moshi-hook");
      expect(args).toEqual(["context"]);
      return { stdout: HERDR_PAYLOAD, status: 0 };
    }) as never;
    const ctx = probeTerminalContext({ spawnSync });
    expect(ctx.herdrSession).toBe("wow-addon-profile");
  });

  test("returns empty context on spawn throw", () => {
    const spawnSync = (() => {
      throw new Error("ENOENT");
    }) as never;
    const ctx = probeTerminalContext({ spawnSync });
    expect(ctx).toEqual(EMPTY_TERMINAL_CONTEXT);
  });

  test("returns empty context on malformed stdout", () => {
    const spawnSync = (() => ({ stdout: "garbage", status: 0 })) as never;
    const ctx = probeTerminalContext({ spawnSync });
    expect(ctx).toEqual(EMPTY_TERMINAL_CONTEXT);
  });
});

describe("cache", () => {
  test("getCachedTerminalContext returns cached value across calls", async () => {
    resetTerminalContextCache();
    const { getCachedTerminalContext } = await import("./terminal-context.ts");
    let calls = 0;
    const spawnSync = (() => {
      calls++;
      return { stdout: HERDR_PAYLOAD, status: 0 };
    }) as never;
    const a = getCachedTerminalContext({ spawnSync });
    const b = getCachedTerminalContext({ spawnSync });
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });
});
