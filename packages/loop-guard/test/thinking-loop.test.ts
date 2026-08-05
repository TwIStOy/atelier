import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { extractChunks, ThinkingLoopDetector, type ThinkingLoopOptions } from "../src/thinking-loop.ts";

const OPTIONS: ThinkingLoopOptions = { minChunkChars: 50, acrossRepeatLimit: 1, maxMessages: 10 };

const CHUNK_A =
  "First I considered the cache layer and decided to invalidate it on every write because staleness caused bugs.";
const CHUNK_B =
  "Then I looked at the index builder and realized the shard map must be rebuilt after each compaction cycle.";
const CHUNK_C =
  "Finally I checked the retry policy and concluded that backoff must be exponential with jitter to avoid storms.";

describe("extractChunks", () => {
  it("splits on blank lines and drops short paragraphs", () => {
    assert.deepEqual(extractChunks(`${CHUNK_A}\n\nshort\n\n${CHUNK_B}`, 50), [CHUNK_A, CHUNK_B]);
  });

  it("normalizes internal whitespace", () => {
    const text = `${"x".repeat(60)}\n${"y".repeat(60)}`;
    assert.deepEqual(extractChunks(text, 50), [`${"x".repeat(60)} ${"y".repeat(60)}`]);
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(extractChunks("", 50), []);
  });
});

describe("ThinkingLoopDetector within-message", () => {
  it("detects a paragraph repeated inside one message", () => {
    const detector = new ThinkingLoopDetector();
    assert.deepEqual(detector.checkMessage([`${CHUNK_A}\n\n${CHUNK_B}\n\n${CHUNK_A}`], OPTIONS), {
      kind: "within-message",
      repeatedChunks: 1,
    });
  });

  it("counts multiple distinct repeated paragraphs", () => {
    const detector = new ThinkingLoopDetector();
    const text = `${CHUNK_A}\n\n${CHUNK_B}\n\n${CHUNK_A}\n\n${CHUNK_B}`;
    assert.deepEqual(detector.checkMessage([text], OPTIONS), { kind: "within-message", repeatedChunks: 2 });
  });

  it("ignores repetition of paragraphs below the minimum length", () => {
    const detector = new ThinkingLoopDetector();
    assert.equal(detector.checkMessage(["wait.\n\nwait.\n\nwait."], OPTIONS), null);
  });

  it("returns null for messages without repetition", () => {
    const detector = new ThinkingLoopDetector();
    assert.equal(detector.checkMessage([`${CHUNK_A}\n\n${CHUNK_B}`], OPTIONS), null);
  });

  it("returns null when there is no thinking content", () => {
    const detector = new ThinkingLoopDetector();
    assert.equal(detector.checkMessage([], OPTIONS), null);
  });
});

describe("ThinkingLoopDetector across-turns", () => {
  it("detects a paragraph repeated from an earlier message", () => {
    const detector = new ThinkingLoopDetector();
    assert.equal(detector.checkMessage([CHUNK_A], OPTIONS), null);
    assert.deepEqual(detector.checkMessage([CHUNK_A], OPTIONS), { kind: "across-turns", repeatedChunks: 1 });
  });

  it("matches chunks despite whitespace differences", () => {
    const detector = new ThinkingLoopDetector();
    detector.checkMessage([CHUNK_A], OPTIONS);
    const respaced = CHUNK_A.replace(/ /g, "  \n ");
    const detection = detector.checkMessage([`${respaced}\n\n${CHUNK_B}`], OPTIONS);
    assert.equal(detection?.kind, "across-turns");
  });

  it("honors an across-turn limit above one", () => {
    const options: ThinkingLoopOptions = { ...OPTIONS, acrossRepeatLimit: 2 };
    const detector = new ThinkingLoopDetector();
    detector.checkMessage([`${CHUNK_A}\n\n${CHUNK_B}`], options);
    assert.equal(detector.checkMessage([CHUNK_A], options), null);
    assert.deepEqual(detector.checkMessage([`${CHUNK_A}\n\n${CHUNK_B}`], options), {
      kind: "across-turns",
      repeatedChunks: 2,
    });
  });

  it("forgets messages outside the history window", () => {
    const options: ThinkingLoopOptions = { ...OPTIONS, maxMessages: 2 };
    const detector = new ThinkingLoopDetector();
    detector.checkMessage([CHUNK_A], options);
    detector.checkMessage([CHUNK_B], options);
    detector.checkMessage([CHUNK_C], options);
    assert.equal(detector.checkMessage([CHUNK_A], options), null);
  });

  it("reset clears history", () => {
    const detector = new ThinkingLoopDetector();
    detector.checkMessage([CHUNK_A], OPTIONS);
    detector.reset();
    assert.equal(detector.checkMessage([CHUNK_A], OPTIONS), null);
  });
});
