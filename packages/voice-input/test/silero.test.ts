import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SileroVad, type VadModelBackend, type VadOutputs } from "../src/audio/vad/silero.ts";

function makeTmpModel(payload = "not-real-onnx"): string {
  const dir = mkdtempSync(join(tmpdir(), "silero-test-"));
  const file = join(dir, "silero_vad.onnx");
  writeFileSync(file, Buffer.from(payload));
  return file;
}

function fakeBackend(prob: number): VadModelBackend & {
  isReleased(): boolean;
} {
  let released = false;
  let callCount = 0;
  return {
    async run(feeds): Promise<VadOutputs> {
      callCount += 1;
      const state = new Float32Array(feeds.state.length);
      for (let i = 0; i < state.length; i++) state[i] = callCount * 0.001;
      return { prob, state };
    },
    async release(): Promise<void> {
      released = true;
    },
    isReleased(): boolean {
      return released;
    },
  };
}

describe("SileroVad.create", () => {
  it("loads with a fake backend and skips file reading when backend provided", async () => {
    const modelPath = makeTmpModel();
    const backend = fakeBackend(0.9);
    const vad = await SileroVad.create({ modelPath, backend });
    expect(vad).toBeInstanceOf(SileroVad);
    await vad.release();
  });

  it("rejects when the sha256 checksum does not match", async () => {
    const modelPath = makeTmpModel("payload");
    await expect(
      SileroVad.create({
        modelPath,
        expectedSha256: "deadbeef".repeat(8),
        backend: fakeBackend(0.5),
      }),
    ).rejects.toThrow(/checksum mismatch/);
  });

  it("accepts a backend factory over the raw model bytes", async () => {
    const modelPath = makeTmpModel("payload");
    const factory = vi.fn(async (buf: Uint8Array) => {
      expect(buf.length).toBe(7);
      return fakeBackend(0.42);
    });
    const vad = await SileroVad.create({ modelPath, backend: factory });
    expect(factory).toHaveBeenCalledTimes(1);
    const prob = await vad.processFrame(new Float32Array(512));
    expect(prob).toBeCloseTo(0.42, 5);
  });
});

describe("SileroVad.processFrame", () => {
  it("returns the probability from the backend", async () => {
    const vad = await SileroVad.create({
      modelPath: makeTmpModel(),
      backend: fakeBackend(0.7),
    });
    const prob = await vad.processFrame(new Float32Array(512));
    expect(prob).toBeCloseTo(0.7, 5);
  });

  it("threads state between consecutive frames", async () => {
    const seen: Float32Array[] = [];
    const backend: VadModelBackend = {
      async run(feeds): Promise<VadOutputs> {
        seen.push(feeds.state);
        const next = new Float32Array(feeds.state.length);
        next[0] = (seen[seen.length - 1][0] ?? 0) + 1;
        return { prob: 0.5, state: next };
      },
      async release() {},
    };
    const vad = await SileroVad.create({
      modelPath: makeTmpModel(),
      backend,
    });
    await vad.processFrame(new Float32Array(512));
    await vad.processFrame(new Float32Array(512));
    expect(seen[0][0]).toBe(0);
    expect(seen[1][0]).toBe(1);
  });

  it("rejects a frame with the wrong number of samples", async () => {
    const vad = await SileroVad.create({
      modelPath: makeTmpModel(),
      backend: fakeBackend(0.5),
    });
    await expect(vad.processFrame(new Float32Array(100))).rejects.toThrow(/expects 512 samples/);
  });
});

describe("SileroVad.reset", () => {
  it("clears the internal LSTM state to zeros", async () => {
    const vad = await SileroVad.create({
      modelPath: makeTmpModel(),
      backend: fakeBackend(0.5),
    });
    await vad.processFrame(new Float32Array(512));
    vad.reset();
    expect(vad).toBeInstanceOf(SileroVad);
  });
});

describe("SileroVad.release", () => {
  it("releases the underlying backend", async () => {
    const backend = fakeBackend(0.5);
    const vad = await SileroVad.create({
      modelPath: makeTmpModel(),
      backend,
    });
    await vad.release();
    expect(backend.isReleased()).toBe(true);
  });
});
