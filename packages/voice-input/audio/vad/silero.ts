import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const STATE_DIMS: readonly number[] = [2, 1, 128];
const STATE_SIZE = STATE_DIMS.reduce((a, b) => a * b, 1);
const INPUT_SAMPLES = 512;

export interface VadFeeds {
  input: { samples: Float32Array };
  state: Float32Array;
}

export interface VadOutputs {
  prob: number;
  state: Float32Array;
}

export interface VadModelBackend {
  run(feeds: VadFeeds): Promise<VadOutputs>;
  release(): Promise<void>;
}

export interface SileroVadOptions {
  modelPath: string;
  expectedSha256?: string;
  backend?: VadModelBackend | ((model: Uint8Array) => Promise<VadModelBackend>);
}

export class SileroVad {
  private readonly backend: VadModelBackend;
  private state: Float32Array;

  private constructor(backend: VadModelBackend) {
    this.backend = backend;
    this.state = new Float32Array(STATE_SIZE);
  }

  static async create(opts: SileroVadOptions): Promise<SileroVad> {
    const buf = await readFile(opts.modelPath);
    if (opts.expectedSha256) {
      const actual = createHash("sha256").update(buf).digest("hex");
      if (actual !== opts.expectedSha256) {
        throw new Error(
          `silero_vad.onnx checksum mismatch: expected ${opts.expectedSha256}, got ${actual}`,
        );
      }
    }
    const backend =
      typeof opts.backend === "function"
        ? await opts.backend(buf)
        : opts.backend ?? (await defaultBackend(buf));
    return new SileroVad(backend);
  }

  async processFrame(samples: Float32Array): Promise<number> {
    if (samples.length !== INPUT_SAMPLES) {
      throw new Error(
        `Silero VAD expects ${INPUT_SAMPLES} samples, got ${samples.length}`,
      );
    }
    const out = await this.backend.run({
      input: { samples },
      state: this.state,
    });
    this.state = out.state;
    return out.prob;
  }

  reset(): void {
    this.state = new Float32Array(STATE_SIZE);
  }

  async release(): Promise<void> {
    await this.backend.release();
  }
}

async function defaultBackend(model: Uint8Array): Promise<VadModelBackend> {
  const ort = await import("onnxruntime-web");
  const session = await ort.InferenceSession.create(model);
  return {
    async run(feeds: VadFeeds): Promise<VadOutputs> {
      const out = await session.run({
        input: new ort.Tensor("float32", feeds.input.samples, [
          1,
          INPUT_SAMPLES,
        ]),
        state: new ort.Tensor("float32", feeds.state, [...STATE_DIMS]),
        sr: new ort.Tensor(
          "int64",
          new BigInt64Array([BigInt(16000)]),
          [],
        ),
      });
      const prob = (out.output.data as Float32Array)[0];
      const state = new Float32Array(out.stateN.data as Float32Array);
      return { prob, state };
    },
    async release(): Promise<void> {
      await session.release();
    },
  };
}
