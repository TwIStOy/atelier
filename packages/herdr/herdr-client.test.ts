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
