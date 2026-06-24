import { describe, expect, it } from "vitest";
import {
  createFramerState,
  FRAME_BYTES,
  FRAME_SAMPLES,
  pushChunk,
  remainingBytes,
  s16leBytesToFloat32,
} from "../audio/framer.ts";

function encodeS16le(samples: number[]): Uint8Array {
  const buf = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(i * 2, samples[i], true);
  }
  return new Uint8Array(buf);
}

describe("s16leBytesToFloat32", () => {
  it("decodes zero samples to 0.0", () => {
    const bytes = encodeS16le([0]);
    expect(s16leBytesToFloat32(bytes)).toEqual(new Float32Array([0]));
  });

  it("decodes max positive (32767) to ~1.0", () => {
    const bytes = encodeS16le([32767]);
    const out = s16leBytesToFloat32(bytes);
    expect(out[0]).toBeCloseTo(1.0, 3);
  });

  it("decodes min negative (-32768) to ~-1.0", () => {
    const bytes = encodeS16le([-32768]);
    const out = s16leBytesToFloat32(bytes);
    expect(out[0]).toBeCloseTo(-1.0, 3);
  });

  it("decodes multiple samples in order", () => {
    const bytes = encodeS16le([0, 16384, -16384]);
    const out = s16leBytesToFloat32(bytes);
    expect(out[0]).toBeCloseTo(0, 3);
    expect(out[1]).toBeCloseTo(0.5, 3);
    expect(out[2]).toBeCloseTo(-0.5, 3);
  });
});

describe("pushChunk framing", () => {
  it("returns no frames when fewer than one frame of bytes arrive", () => {
    const state = createFramerState();
    const small = encodeS16le(new Array(10).fill(0));
    const frames = pushChunk(small, state);
    expect(frames).toHaveLength(0);
    expect(remainingBytes(state)).toBe(small.length);
  });

  it("emits exactly one frame when exactly FRAME_BYTES arrive", () => {
    const state = createFramerState();
    const samples = new Array(FRAME_SAMPLES).fill(0);
    const bytes = encodeS16le(samples);
    expect(bytes.length).toBe(FRAME_BYTES);
    const frames = pushChunk(bytes, state);
    expect(frames).toHaveLength(1);
    expect(frames[0].length).toBe(FRAME_SAMPLES);
    expect(remainingBytes(state)).toBe(0);
  });

  it("accumulates across chunks and emits frames when threshold crossed", () => {
    const state = createFramerState();
    const half = encodeS16le(new Array(FRAME_SAMPLES / 2).fill(0));
    pushChunk(half, state);
    expect(remainingBytes(state)).toBe(half.length);
    const frames = pushChunk(half, state);
    expect(frames).toHaveLength(1);
    expect(remainingBytes(state)).toBe(0);
  });

  it("emits multiple frames from a large chunk", () => {
    const state = createFramerState();
    const big = encodeS16le(new Array(FRAME_SAMPLES * 3).fill(0));
    const frames = pushChunk(big, state);
    expect(frames).toHaveLength(3);
    expect(remainingBytes(state)).toBe(0);
  });

  it("emits 2 frames and keeps remainder for 2.5 frames of bytes", () => {
    const state = createFramerState();
    const twoAndHalf = encodeS16le(new Array(FRAME_SAMPLES * 2 + FRAME_SAMPLES / 2).fill(0));
    const frames = pushChunk(twoAndHalf, state);
    expect(frames).toHaveLength(2);
    expect(remainingBytes(state)).toBe(FRAME_BYTES / 2);
  });
});
