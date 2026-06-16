import { describe, expect, it } from "vitest";
import { encodeWav, float32ToInt16 } from "../audio/pcm-wav.ts";

function readString(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++)
    s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("encodeWav", () => {
  it("writes a valid RIFF/WAVE/fmt/data header", () => {
    const samples = new Int16Array([0, 100, -100]);
    const wav = encodeWav(samples, 16000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(readString(view, 0, 4)).toBe("RIFF");
    expect(readString(view, 8, 4)).toBe("WAVE");
    expect(readString(view, 12, 4)).toBe("fmt ");
    expect(readString(view, 36, 4)).toBe("data");
    expect(view.getUint32(4, true)).toBe(36 + samples.byteLength);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(samples.byteLength);
  });

  it("copies sample data after the 44-byte header", () => {
    const samples = new Int16Array([1, 2, 3, 4]);
    const wav = encodeWav(samples);
    expect(wav.length).toBe(44 + 8);
    const copy = new Int16Array(wav.buffer, 44, 4);
    expect(Array.from(copy)).toEqual([1, 2, 3, 4]);
  });

  it("handles an empty sample array", () => {
    const wav = encodeWav(new Int16Array(0));
    expect(wav.length).toBe(44);
  });

  it("respects a custom sample rate in the header", () => {
    const wav = encodeWav(new Int16Array([0]), 8000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(28, true)).toBe(16000);
  });
});

describe("float32ToInt16", () => {
  it("converts 0.0 to 0", () => {
    expect(float32ToInt16(new Float32Array([0]))[0]).toBe(0);
  });

  it("converts 1.0 to max positive (32767)", () => {
    expect(float32ToInt16(new Float32Array([1]))[0]).toBe(32767);
  });

  it("converts -1.0 to min negative (-32768)", () => {
    expect(float32ToInt16(new Float32Array([-1]))[0]).toBe(-32768);
  });

  it("clamps values beyond [-1, 1]", () => {
    const out = float32ToInt16(new Float32Array([2, -2]));
    expect(out[0]).toBe(32767);
    expect(out[1]).toBe(-32768);
  });

  it("converts 0.5 to ~16384", () => {
    expect(float32ToInt16(new Float32Array([0.5]))[0]).toBeCloseTo(16384, -2);
  });

  it("round-trips a full frame through int16 then back to float32 lossily", () => {
    const original = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    const int16 = float32ToInt16(original);
    const back = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) back[i] = int16[i] / 32768;
    for (let i = 0; i < original.length; i++) {
      expect(back[i]).toBeCloseTo(original[i], 3);
    }
  });
});
