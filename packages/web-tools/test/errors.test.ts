import { describe, expect, test } from "vitest";
import { describeError, ProviderError } from "../src/providers/errors.ts";

describe("describeError", () => {
  test("includes the fetch cause that Node omits from the message", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND api.search.brave.com"), { code: "ENOTFOUND" });
    const err = new TypeError("fetch failed", { cause });
    expect(describeError(err)).toBe("fetch failed: getaddrinfo ENOTFOUND api.search.brave.com");
  });

  test("appends a code that is not already in the message", () => {
    const err = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    expect(describeError(err)).toBe("socket hang up (ECONNRESET)");
  });

  test("keeps a ProviderError message without a cause", () => {
    const err = new ProviderError("brave", 401, "invalid subscription token");
    expect(describeError(err)).toBe("brave API error (401): invalid subscription token");
  });

  test("walks an AggregateError when cause is unset", () => {
    const err = new AggregateError([Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })]);
    expect(describeError(err)).toBe("connect ECONNREFUSED");
  });

  test("stops on a cause cycle", () => {
    const err = new Error("loop");
    err.cause = err;
    expect(describeError(err)).toBe("loop");
  });

  test("stringifies a non-Error", () => {
    expect(describeError("offline")).toBe("offline");
  });
});
