import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { detectRepeatingSuffix } from "../src/stream-loop.ts";

const OPTIONS = { minWindow: 80, maxWindow: 2000 };

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomText(length: number, seed = 42): string {
  const rand = mulberry32(seed);
  let out = "";
  while (out.length < length) {
    out += String.fromCharCode(97 + Math.floor(rand() * 26));
  }
  return out;
}

describe("detectRepeatingSuffix", () => {
  it("returns null for non-repeating text", () => {
    assert.equal(detectRepeatingSuffix(randomText(500), OPTIONS), null);
  });

  it("detects two adjacent copies of a block and keeps one", () => {
    const prefix = randomText(300);
    const block = randomText(120, 7);
    const repeat = detectRepeatingSuffix(prefix + block + block, OPTIONS);
    assert.deepEqual(repeat, { cleanPrefix: prefix + block, period: 120 });
  });

  it("keeps exactly one copy when more than two copies streamed in", () => {
    const prefix = randomText(200);
    const block = randomText(100, 9);
    const repeat = detectRepeatingSuffix(prefix + block + block + block, OPTIONS);
    assert.deepEqual(repeat, { cleanPrefix: prefix + block, period: 100 });
  });

  it("ignores repeats shorter than the minimum window", () => {
    const block = randomText(40, 11);
    assert.equal(detectRepeatingSuffix(randomText(300) + block + block, OPTIONS), null);
  });

  it("ignores non-adjacent repeats", () => {
    const block = randomText(100, 13);
    const text = block + randomText(150, 14) + block;
    assert.equal(detectRepeatingSuffix(text, OPTIONS), null);
  });

  it("finds the smallest repeating period", () => {
    const prefix = randomText(100);
    const text = `${prefix}${"ab".repeat(60)}`;
    const repeat = detectRepeatingSuffix(text, { minWindow: 2, maxWindow: 2000 });
    assert.deepEqual(repeat, { cleanPrefix: `${prefix}ab`, period: 2 });
  });

  it("does not examine blocks larger than the max window", () => {
    const block = randomText(150, 17);
    const text = randomText(100) + block + block;
    assert.equal(detectRepeatingSuffix(text, { minWindow: 50, maxWindow: 100 }), null);
  });

  it("returns null when the text is shorter than two minimum windows", () => {
    const block = randomText(50, 19);
    assert.equal(detectRepeatingSuffix(block + block, OPTIONS), null);
  });
});
