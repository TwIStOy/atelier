export interface VadSegmenterOptions {
  threshold: number;
  negThreshold: number;
  minSpeechMs: number;
  minSilenceMs: number;
  maxSpeechMs: number;
}

export const DEFAULT_VAD_OPTIONS: VadSegmenterOptions = {
  threshold: 0.5,
  negThreshold: 0.35,
  minSpeechMs: 250,
  minSilenceMs: 500,
  maxSpeechMs: 30000,
};

export interface SegmenterFrameInput {
  prob: number;
  frameMs: number;
  samples: Float32Array;
}

export interface ClosedSegment {
  samples: Float32Array[];
}

type SegmenterState = "silence" | "speech";

export interface SegmenterCallbacks {
  onSpeechStart?: () => void;
  onSegment?: (segment: ClosedSegment) => void;
}

export class VadSegmenter {
  private readonly opts: VadSegmenterOptions;
  private readonly callbacks: SegmenterCallbacks;
  private state: SegmenterState = "silence";
  private currentSegment: Float32Array[] = [];
  private currentSpeechMs = 0;
  private pendingSpeechMs = 0;
  private pendingFrames: Float32Array[] = [];
  private currentSilenceMs = 0;

  constructor(opts: Partial<VadSegmenterOptions> = {}, callbacks: SegmenterCallbacks = {}) {
    this.opts = { ...DEFAULT_VAD_OPTIONS, ...opts };
    this.callbacks = callbacks;
  }

  push(input: SegmenterFrameInput): void {
    const { prob, frameMs, samples } = input;
    if (this.state === "silence") {
      this.handleSilence(prob, samples, frameMs);
    } else {
      this.handleSpeech(prob, samples, frameMs);
    }
  }

  close(): ClosedSegment | null {
    const segment =
      this.state === "speech" && this.currentSpeechMs >= this.opts.minSpeechMs ? this.buildSegment() : null;
    this.resetToSilence();
    return segment;
  }

  private handleSilence(prob: number, samples: Float32Array, frameMs: number): void {
    if (prob >= this.opts.threshold) {
      this.pendingFrames.push(samples);
      this.pendingSpeechMs += frameMs;
      if (this.pendingSpeechMs >= this.opts.minSpeechMs) {
        this.startSpeech();
      }
    } else {
      this.pendingFrames = [];
      this.pendingSpeechMs = 0;
    }
  }

  private handleSpeech(prob: number, samples: Float32Array, frameMs: number): void {
    this.currentSegment.push(samples);
    this.currentSpeechMs += frameMs;
    if (this.currentSpeechMs >= this.opts.maxSpeechMs) {
      this.emitSegment();
      return;
    }
    if (prob < this.opts.negThreshold) {
      this.currentSilenceMs += frameMs;
      if (this.currentSilenceMs >= this.opts.minSilenceMs) {
        this.emitSegment();
      }
    } else {
      this.currentSilenceMs = 0;
    }
  }

  private startSpeech(): void {
    this.state = "speech";
    for (const frame of this.pendingFrames) {
      this.currentSegment.push(frame);
    }
    this.currentSpeechMs = this.pendingSpeechMs;
    this.pendingFrames = [];
    this.pendingSpeechMs = 0;
    this.currentSilenceMs = 0;
    this.callbacks.onSpeechStart?.();
  }

  private emitSegment(): void {
    if (this.currentSpeechMs >= this.opts.minSpeechMs) {
      this.callbacks.onSegment?.(this.buildSegment());
    }
    this.resetToSilence();
  }

  private buildSegment(): ClosedSegment {
    return { samples: this.currentSegment };
  }

  private resetToSilence(): void {
    this.state = "silence";
    this.currentSegment = [];
    this.currentSpeechMs = 0;
    this.pendingFrames = [];
    this.pendingSpeechMs = 0;
    this.currentSilenceMs = 0;
  }
}
