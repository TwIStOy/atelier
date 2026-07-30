import { expect, it } from "vitest";
import { truncateBytes } from "../src/truncate.ts";

it("returns content unchanged when within byte budget", () => {
  const result = truncateBytes("hello", 100);
  expect(result.truncated).toBe(false);
  expect(result.result).toBe("hello");
  expect(result.resultBytes).toBe(5);
});

it("truncates ascii content at byte boundary", () => {
  const result = truncateBytes("abcdef", 3);
  expect(result.truncated).toBe(true);
  expect(result.result).toBe("abc");
  expect(result.resultBytes).toBe(3);
});

it("never splits a multibyte code point", () => {
  const content = "\u4F60\u597D";
  const result = truncateBytes(content, 3);
  expect(result.truncated).toBe(true);
  expect(result.result).toBe("\u4F60");
  expect(result.resultBytes).toBe(3);
});

it("handles content exactly at the boundary", () => {
  const content = "abc";
  const result = truncateBytes(content, 3);
  expect(result.truncated).toBe(false);
  expect(result.result).toBe("abc");
});
