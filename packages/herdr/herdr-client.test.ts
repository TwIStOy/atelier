import { describe, expect, it } from "vitest";
import {
  extractResult,
  isInsideHerdr,
  paneIsActive,
  parseHerdrResponse,
  parsePaneInfo,
  readHerdrEnv,
  resolveHerdrBinary,
} from "./herdr-client.ts";

describe("readHerdrEnv / isInsideHerdr", () => {
  it("reads injected herdr env vars", () => {
    const env = readHerdrEnv({
      HERDR_ENV: "1",
      HERDR_PANE_ID: "w1:p2",
      HERDR_TAB_ID: "w1:t1",
      HERDR_BIN_PATH: "/usr/local/bin/herdr",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
      HERDR_SESSION: "work",
    });
    expect(env).toEqual({
      paneId: "w1:p2",
      tabId: "w1:t1",
      binary: "/usr/local/bin/herdr",
      socketPath: "/tmp/herdr.sock",
      session: "work",
    });
  });

  it("treats empty strings as absent", () => {
    const env = readHerdrEnv({
      HERDR_ENV: "1",
      HERDR_PANE_ID: "   ",
      HERDR_TAB_ID: "",
    });
    expect(env.paneId).toBeUndefined();
    expect(env.tabId).toBeUndefined();
  });

  it("is inside herdr only when HERDR_ENV=1 AND a pane id is present", () => {
    expect(isInsideHerdr({ HERDR_ENV: "1", HERDR_PANE_ID: "w1:p1" })).toBe(
      true,
    );
    expect(isInsideHerdr({ HERDR_ENV: "1", HERDR_PANE_ID: "  " })).toBe(false);
    expect(isInsideHerdr({ HERDR_ENV: "0", HERDR_PANE_ID: "w1:p1" })).toBe(
      false,
    );
    expect(isInsideHerdr({ HERDR_ENV: "1" })).toBe(false);
    expect(isInsideHerdr({})).toBe(false);
  });
});

describe("resolveHerdrBinary", () => {
  it("prefers HERDR_BIN_PATH", () => {
    expect(resolveHerdrBinary({ HERDR_BIN_PATH: "/custom/herdr" })).toBe(
      "/custom/herdr",
    );
  });
  it("falls back to the bare binary name", () => {
    expect(resolveHerdrBinary({})).toBe("herdr");
  });
});

describe("parseHerdrResponse / extractResult", () => {
  it("parses a single-line JSON envelope", () => {
    const raw = JSON.stringify({
      id: "req_1",
      result: { type: "pane_info", pane: { pane_id: "w1:p1", focused: true } },
    });
    const parsed = parseHerdrResponse(raw);
    expect(extractResult(parsed)).toEqual({
      type: "pane_info",
      pane: { pane_id: "w1:p1", focused: true },
    });
  });

  it("returns null when the response is an error envelope", () => {
    const raw = JSON.stringify({
      id: "req_1",
      error: { code: "not_found", message: "pane not found" },
    });
    expect(extractResult(parseHerdrResponse(raw))).toBeNull();
  });

  it("returns null on unparseable output", () => {
    expect(parseHerdrResponse("not json")).toBeNull();
    expect(parseHerdrResponse("")).toBeNull();
  });

  it("falls back to the first line when multiple lines are present", () => {
    const raw =
      JSON.stringify({ id: "x", result: { ok: true } }) + "\nextra noise";
    expect(extractResult(parseHerdrResponse(raw))).toEqual({ ok: true });
  });
});

describe("parsePaneInfo / paneIsActive", () => {
  it("extracts the pane object from a pane.get response", () => {
    const envelope = {
      id: "r",
      result: {
        type: "pane_info",
        pane: { pane_id: "w1:p1", focused: true, tab_id: "w1:t1" },
      },
    };
    expect(parsePaneInfo(envelope)).toEqual({
      pane_id: "w1:p1",
      focused: true,
      tab_id: "w1:t1",
    });
  });

  it("is active only when focused is true", () => {
    expect(paneIsActive({ focused: true })).toBe(true);
    expect(paneIsActive({ focused: false })).toBe(false);
    expect(paneIsActive({})).toBe(false);
    expect(paneIsActive(null)).toBe(false);
  });
});

// --- impure helpers (run against a fake pi.exec) ---

function fakePi(stdout: string, opts: { code?: number } = {}) {
  const calls: { cmd: string; args: string[] }[] = [];
  const pi = {
    exec: async (cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return {
        stdout,
        stderr: opts.code ? "boom" : "",
        code: opts.code ?? 0,
        killed: false,
      };
    },
  };
  return { pi: pi as unknown as any, calls };
}

const PANE_GET_STDOUT = JSON.stringify({
  id: "r",
  result: {
    type: "pane_info",
    pane: {
      pane_id: "w1:p1",
      focused: true,
      tab_id: "w1:t1",
      workspace_id: "w1",
    },
  },
});

describe("getOurPane / isActivePane", () => {
  it("does NOT pass --json (herdr prints bare JSON and rejects the flag)", async () => {
    const { pi, calls } = fakePi(PANE_GET_STDOUT);
    const pane = await (
      await import("./herdr-client.ts")
    ).getOurPane(pi, "p_2", {});
    expect(calls[0]?.args).toEqual(["pane", "get", "p_2"]);
    expect(pane).not.toBeNull();
    expect(pane?.tab_id).toBe("w1:t1");
  });

  it("isActivePane returns the focused flag from pane get", async () => {
    const focused = fakePi(PANE_GET_STDOUT);
    expect(
      await (
        await import("./herdr-client.ts")
      ).isActivePane(focused.pi, "p_2", {}),
    ).toBe(true);

    const unfocused = fakePi(
      JSON.stringify({
        id: "r",
        result: { type: "pane_info", pane: { focused: false } },
      }),
    );
    expect(
      await (
        await import("./herdr-client.ts")
      ).isActivePane(unfocused.pi, "p_2", {}),
    ).toBe(false);
  });
});

describe("resolveTabId", () => {
  it("prefers HERDR_TAB_ID when injected", async () => {
    const { pi } = fakePi("");
    const tabId = await (
      await import("./herdr-client.ts")
    ).resolveTabId(pi, "p_2", { HERDR_TAB_ID: "env-tab-1" });
    expect(tabId).toBe("env-tab-1");
  });

  it("falls back to tab_id from pane get when the env var is absent", async () => {
    const { pi } = fakePi(PANE_GET_STDOUT);
    const tabId = await (
      await import("./herdr-client.ts")
    ).resolveTabId(pi, "p_2", {});
    expect(tabId).toBe("w1:t1");
  });
});

describe("renameTab", () => {
  it("calls tab rename with id + clipped label and no extra flags", async () => {
    const { pi, calls } = fakePi("{}");
    await (await import("./herdr-client.ts")).renameTab(pi, "w1:t1", "Hi", {});
    expect(calls[0]?.args).toEqual(["tab", "rename", "w1:t1", "Hi"]);
  });

  it("clips labels longer than 80 chars and skips empty labels", async () => {
    const { pi, calls } = fakePi("{}");
    const long = "x".repeat(200);
    await (await import("./herdr-client.ts")).renameTab(pi, "w1:t1", long, {});
    expect(calls[0]?.args[3]?.length).toBe(80);
    calls.length = 0;
    await (await import("./herdr-client.ts")).renameTab(pi, "w1:t1", "   ", {});
    expect(calls).toHaveLength(0);
  });
});
