import { describe, expect, it, vi } from "vitest";
import { type ClosedSegment, DEFAULT_VAD_OPTIONS, VadSegmenter } from "../src/audio/vad/segmenter.ts";

const FRAME_MS = 32;

function makeSamples(n = 512): Float32Array {
  return new Float32Array(n);
}

function framesForMs(ms: number): number {
  return Math.ceil(ms / FRAME_MS);
}

describe("VadSegmenter — silence stays silent", () => {
  it("never emits a segment when all frames are below threshold", () => {
    const onSegment = vi.fn();
    const seg = new VadSegmenter({}, { onSegment });
    for (let i = 0; i < 100; i++) {
      seg.push({ prob: 0.1, frameMs: FRAME_MS, samples: makeSamples() });
    }
    expect(onSegment).not.toHaveBeenCalled();
    expect(seg.close()).toBeNull();
  });
});

describe("VadSegmenter — speech detection", () => {
  it("fires onSpeechStart after minSpeechMs of above-threshold frames", () => {
    const onSpeechStart = vi.fn();
    const seg = new VadSegmenter({ minSpeechMs: 250 }, { onSpeechStart });
    const needed = framesForMs(250);
    for (let i = 0; i < needed; i++) {
      seg.push({ prob: 0.9, frameMs: FRAME_MS, samples: makeSamples() });
    }
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("does not start speech if above-threshold frames are interrupted by silence", () => {
    const onSpeechStart = vi.fn();
    const seg = new VadSegmenter({ minSpeechMs: 250 }, { onSpeechStart });
    for (let i = 0; i < framesForMs(100); i++) {
      seg.push({ prob: 0.9, frameMs: FRAME_MS, samples: makeSamples() });
    }
    seg.push({ prob: 0.1, frameMs: FRAME_MS, samples: makeSamples() });
    for (let i = 0; i < framesForMs(100); i++) {
      seg.push({ prob: 0.9, frameMs: FRAME_MS, samples: makeSamples() });
    }
    expect(onSpeechStart).not.toHaveBeenCalled();
  });
});

describe("VadSegmenter — segment closure by silence", () => {
  it("closes a segment after minSilenceMs of below-threshold frames", () => {
    const segments: ClosedSegment[] = [];
    const seg = new VadSegmenter({ minSpeechMs: 250, minSilenceMs: 500 }, { onSegment: (s) => segments.push(s) });
    const speechFrames = framesForMs(500);
    for (let i = 0; i < speechFrames; i++) {
      seg.push({ prob: 0.9, frameMs: FRAME_MS, samples: makeSamples() });
    }
    expect(segments).toHaveLength(0);
    const silenceFrames = framesForMs(500);
    for (let i = 0; i < silenceFrames; i++) {
      seg.push({ prob: 0.1, frameMs: FRAME_MS, samples: makeSamples() });
    }
    expect(segments).toHaveLength(1);
    const expectedFrames = speechFrames + silenceFrames;
    expect(segments[0].samples.length).toBe(expectedFrames);
  });

  it("resets silence counter when an above-negThreshold frame interrupts", () => {
    const segments: ClosedSegment[] = [];
    const seg = new VadSegmenter(
      { minSpeechMs: 250, minSilenceMs: 500, negThreshold: 0.35 },
      { onSegment: (s) => segments.push(s) },
    );
    for (let i = 0; i < framesForMs(500); i++) {
      seg.push({ prob: 0.9, frameMs: FRAME_MS, samples: makeSamples() });
    }
    for (let i = 0; i < framesForMs(300); i++) {
      seg.push({ prob: 0.1, frameMs: FRAME_MS, samples: makeSamples() });
    }
    seg.push({ prob: 0.4, frameMs: FRAME_MS, samples: makeSamples() });
    for (let i = 0; i < framesForMs(300); i++) {
      seg.push({ prob: 0.1, frameMs: FRAME_MS, samples: makeSamples() });
    }
    expect(segments).toHaveLength(0);
  });
});

describe("VadSegmenter — max speech length", () => {
  it("forces a segment close at maxSpeechMs even without silence", () => {
    const segments: ClosedSegment[] = [];
    const seg = new VadSegmenter({ minSpeechMs: 100, maxSpeechMs: 320 }, { onSegment: (s) => segments.push(s) });
    for (let i = 0; i < framesForMs(320); i++) {
      seg.push({ prob: 0.9, frameMs: FRAME_MS, samples: makeSamples() });
    }
    expect(segments).toHaveLength(1);
  });
});

describe("VadSegmenter — close flushes trailing speech", () => {
  it("flushes an in-progress speech segment on close if it meets minSpeechMs", () => {
    const segments: ClosedSegment[] = [];
    const seg = new VadSegmenter({ minSpeechMs: 250 }, { onSegment: (s) => segments.push(s) });
    for (let i = 0; i < framesForMs(500); i++) {
      seg.push({ prob: 0.9, frameMs: FRAME_MS, samples: makeSamples() });
    }
    const flushed = seg.close();
    expect(segments).toHaveLength(0);
    expect(flushed).not.toBeNull();
    expect(flushed!.samples.length).toBe(framesForMs(500));
  });

  it("discards a too-short pending segment on close", () => {
    const seg = new VadSegmenter({ minSpeechMs: 250 });
    for (let i = 0; i < framesForMs(100); i++) {
      seg.push({ prob: 0.9, frameMs: FRAME_MS, samples: makeSamples() });
    }
    expect(seg.close()).toBeNull();
  });
});

describe("VadSegmenter — defaults", () => {
  it("exposes sensible defaults", () => {
    expect(DEFAULT_VAD_OPTIONS.threshold).toBe(0.5);
    expect(DEFAULT_VAD_OPTIONS.negThreshold).toBe(0.35);
    expect(DEFAULT_VAD_OPTIONS.minSpeechMs).toBe(250);
    expect(DEFAULT_VAD_OPTIONS.minSilenceMs).toBe(500);
    expect(DEFAULT_VAD_OPTIONS.maxSpeechMs).toBe(30000);
  });
});
