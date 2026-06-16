import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { createFramerState, FRAME_MS, pushChunk } from "./framer.ts";
import { encodeWav, float32ToInt16 } from "./pcm-wav.ts";
import { StreamCapture } from "./stream-capture.ts";
import { SileroVad } from "./vad/silero.ts";
import { VadSegmenter, type ClosedSegment } from "./vad/segmenter.ts";
import type { VadConfig } from "../types.ts";

export interface VadPipelineDeps {
  capture: StreamCapture;
  vad: SileroVad;
}

export type VadState = "listening" | "transcribing";

export interface VadPipelineCallbacks {
  onTranscript: (text: string, segmentIndex: number) => void;
  onState?: (state: VadState) => void;
  onError?: (error: unknown) => void;
}

export interface VadPipelineOptions {
  capture: StreamCapture;
  vad: SileroVad;
  config: VadConfig;
  transcribe: (file: string, signal?: AbortSignal) => Promise<string>;
  transcribeTimeoutMs: number;
  callbacks?: VadPipelineCallbacks;
  segmenterFactory?: (
    config: VadConfig,
    callbacks: import("./vad/segmenter.ts").SegmenterCallbacks,
  ) => VadSegmenter;
}

export class VadPipeline {
  private readonly capture: StreamCapture;
  private readonly vad: SileroVad;
  private readonly segmenter: VadSegmenter;
  private readonly transcribe: VadPipelineOptions["transcribe"];
  private readonly transcribeTimeoutMs: number;
  private callbacks: VadPipelineCallbacks;

  private tmpDir: string | null = null;
  private segmentCounter = 0;
  private active = false;
  private abortController: AbortController | null = null;
  private stream: Readable | null = null;

  constructor(opts: VadPipelineOptions) {
    this.capture = opts.capture;
    this.vad = opts.vad;
    this.transcribe = opts.transcribe;
    this.transcribeTimeoutMs = opts.transcribeTimeoutMs;
    this.callbacks = opts.callbacks ?? { onTranscript: () => {} };
    this.segmenter = (opts.segmenterFactory ?? defaultSegmenterFactory)(
      opts.config,
      {
        onSpeechStart: () => this.callbacks.onState?.("listening"),
        onSegment: (segment) => this.emitSegment(segment),
      },
    );
  }

  setCallbacks(callbacks: VadPipelineCallbacks): void {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.active) throw new Error("VAD pipeline already active.");
    this.active = true;
    this.tmpDir = mkdtempSync(join(tmpdir(), "voice-vad-"));
    this.abortController = new AbortController();
    this.stream = this.capture.start();
    this.callbacks.onState?.("listening");
    this.pump();
  }

  private pump(): void {
    const framer = createFramerState();

    this.stream!.on("data", async (chunk: Buffer) => {
      if (!this.active) return;
      const frames = pushChunk(new Uint8Array(chunk), framer);
      for (const frame of frames) {
        try {
          const prob = await this.vad.processFrame(frame);
          this.segmenter.push({ prob, frameMs: FRAME_MS, samples: frame });
        } catch (err) {
          this.callbacks.onError?.(err);
        }
      }
    });

    this.stream!.on("error", (err) => {
      this.callbacks.onError?.(err);
    });
  }

  private emitSegment(segment: ClosedSegment): void {
    this.segmentCounter += 1;
    const index = this.segmentCounter;
    const file = join(this.tmpDir!, `seg-${index}.wav`);
    const flat = flatten(segment.samples);
    writeFileSync(file, encodeWav(float32ToInt16(flat)));
    this.callbacks.onState?.("transcribing");
    this.transcribeSegment(index, file);
  }

  private transcribeSegment(index: number, file: string): void {
    const signal = this.abortController?.signal;
    raceWithTimeout(
      this.transcribe(file, signal),
      this.transcribeTimeoutMs,
      `Segment ${index} transcription`,
    )
      .then((text) => {
        const trimmed = text?.trim();
        if (trimmed) {
          this.callbacks.onTranscript(trimmed, index);
        }
      })
      .catch((err) => {
        this.callbacks.onError?.(err);
      })
      .finally(() => {
        try {
          rmSync(file, { force: true });
        } catch {
          // best-effort cleanup
        }
      });
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.flushTrailingSegment();
    try {
      await this.capture.stop();
    } catch {
      // best-effort
    }
  }

  private flushTrailingSegment(): void {
    try {
      const flushed = this.segmenter.close();
      if (flushed) this.emitSegment(flushed);
    } catch {
      // best-effort flush
    }
  }

  async cancel(): Promise<void> {
    this.active = false;
    this.abortController?.abort();
    try {
      await this.capture.cancel();
    } catch {
      // best-effort
    }
    this.cleanup();
  }

  cleanup(): void {
    const dir = this.tmpDir;
    this.tmpDir = null;
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }

  async release(): Promise<void> {
    try {
      await this.vad.release();
    } catch {
      // best-effort
    }
    this.cleanup();
  }
}

const defaultSegmenterFactory = (
  config: VadConfig,
  callbacks: import("./vad/segmenter.ts").SegmenterCallbacks,
): VadSegmenter => new VadSegmenter(config, callbacks);

function flatten(samples: Float32Array[]): Float32Array {
  const total = samples.reduce((acc, s) => acc + s.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const s of samples) {
    out.set(s, offset);
    offset += s.length;
  }
  return out;
}

function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
