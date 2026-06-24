import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { StreamCapture } from "../audio/stream-capture.ts";
import type { SegmenterCallbacks, VadSegmenter } from "../audio/vad/segmenter.ts";
import type { SileroVad } from "../audio/vad/silero.ts";
import type { VadPipelineCallbacks } from "../audio/vad-pipeline.ts";
import { VadPipeline } from "../audio/vad-pipeline.ts";
import type { VadConfig } from "../types.ts";

const VAD_CONFIG: VadConfig = {
  enabled: true,
  threshold: 0.5,
  minSpeechMs: 250,
  minSilenceMs: 500,
  maxSpeechMs: 30000,
};

function fakeVad(prob: number): SileroVad {
  return {
    processFrame: vi.fn(async () => prob),
    reset: vi.fn(),
    release: vi.fn(async () => {}),
  } as unknown as SileroVad;
}

function fakeSegmenter(): VadSegmenter & {
  fireSegment(samples: Float32Array[]): void;
} {
  const cb: SegmenterCallbacks = {};
  return {
    push: vi.fn(),
    close: vi.fn(() => null),
    fireSegment(samples: Float32Array[]) {
      cb.onSegment?.({ samples });
    },
  } as unknown as VadSegmenter & {
    fireSegment: (s: Float32Array[]) => void;
  };
}

function fakeCapture(): StreamCapture & {
  stdout: Readable;
  push(chunk: Buffer): void;
} {
  const stdout = new Readable({ read() {} });
  return {
    start: vi.fn(() => stdout),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    isActive: vi.fn(() => true),
    stdout,
    push(chunk: Buffer) {
      stdout.push(chunk);
    },
  } as unknown as StreamCapture & {
    stdout: Readable;
    push: (c: Buffer) => void;
  };
}

function makePipeline(
  overrides: Partial<{
    capture: StreamCapture & { push: (c: Buffer) => void };
    vad: SileroVad;
    segmenter: ReturnType<typeof fakeSegmenter>;
    transcribe: (file: string, signal?: AbortSignal) => Promise<string>;
    callbacks: VadPipelineCallbacks;
  }> = {},
) {
  const capture = overrides.capture ?? fakeCapture();
  const vad = overrides.vad ?? fakeVad(0.9);
  const segmenter = overrides.segmenter ?? fakeSegmenter();
  const transcribe =
    overrides.transcribe ??
    (vi.fn(async () => "hello") as unknown as (file: string, signal?: AbortSignal) => Promise<string>);
  const transcripts: Array<{ text: string; index: number }> = [];
  const states: string[] = [];
  const errors: unknown[] = [];
  const callbacks: VadPipelineCallbacks = overrides.callbacks ?? {
    onTranscript: (text, index) => transcripts.push({ text, index }),
    onState: (s) => states.push(s),
    onError: (e) => errors.push(e),
  };
  const pipeline = new VadPipeline({
    capture,
    vad,
    config: VAD_CONFIG,
    transcribe,
    transcribeTimeoutMs: 1000,
    callbacks,
    segmenterFactory: (_cfg: VadConfig, segCb: SegmenterCallbacks) => {
      (segmenter as unknown as { _cb: SegmenterCallbacks })._cb = segCb;
      return segmenter;
    },
  });
  const fire = (samples: Float32Array[]) =>
    (segmenter as unknown as { _cb: SegmenterCallbacks })._cb.onSegment?.({
      samples,
    });
  return {
    pipeline,
    capture,
    vad,
    segmenter,
    transcribe,
    transcripts,
    states,
    errors,
    fire,
  };
}

describe("VadPipeline — start/stop lifecycle", () => {
  it("starts capture and emits the listening state", () => {
    const { pipeline, capture, states } = makePipeline();
    pipeline.start();
    expect(capture.start).toHaveBeenCalledTimes(1);
    expect(states).toContain("listening");
    pipeline.cancel();
  });

  it("throws if started twice", () => {
    const { pipeline } = makePipeline();
    pipeline.start();
    expect(() => pipeline.start()).toThrow(/already active/);
    pipeline.cancel();
  });
});

describe("VadPipeline — segment emission", () => {
  it("writes a WAV file, transcribes it, and forwards the transcript in order", async () => {
    const transcribe = vi.fn(async (file: string) => {
      expect(existsSync(file)).toBe(true);
      return `text-for-${file.split("/").pop()}`;
    });
    const { pipeline, fire, transcripts } = makePipeline({ transcribe });

    pipeline.start();
    fire([new Float32Array(512)]);
    fire([new Float32Array(512)]);

    await vi.waitFor(() => expect(transcripts).toHaveLength(2));
    expect(transcripts[0].index).toBe(1);
    expect(transcripts[1].index).toBe(2);
    expect(transcripts[0].text).toMatch(/seg-1/);
    expect(transcripts[1].text).toMatch(/seg-2/);
    pipeline.cancel();
  });

  it("skips empty transcripts", async () => {
    const transcribe = vi.fn(async () => "   ");
    const { pipeline, fire, transcripts } = makePipeline({ transcribe });
    pipeline.start();
    fire([new Float32Array(512)]);
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
    expect(transcripts).toHaveLength(0);
    pipeline.cancel();
  });

  it("reports transcribe errors via onError", async () => {
    const transcribe = vi.fn(async () => {
      throw new Error("STT down");
    });
    const { pipeline, fire, errors } = makePipeline({ transcribe });
    pipeline.start();
    fire([new Float32Array(512)]);
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(String(errors[0])).toMatch(/STT down/);
    pipeline.cancel();
  });
});

describe("VadPipeline — cancel", () => {
  it("aborts in-flight transcription and cleans up the temp dir", async () => {
    const transcribe = vi.fn(
      (_file: string, signal?: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const { pipeline, fire, capture } = makePipeline({ transcribe });
    pipeline.start();
    fire([new Float32Array(512)]);
    await pipeline.cancel();
    expect(capture.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("VadPipeline — release", () => {
  it("releases the VAD backend and cleans up", async () => {
    const vad = fakeVad(0.5);
    const { pipeline } = makePipeline({ vad });
    await pipeline.release();
    expect(vad.release).toHaveBeenCalledTimes(1);
  });
});
