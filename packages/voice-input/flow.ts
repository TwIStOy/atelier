import type { LocalAudioCapture } from "./audio/capture.ts";
import type { VadPipeline } from "./audio/vad-pipeline.ts";
import type { SttProvider } from "./providers/index.ts";
import type { VoiceInputConfig } from "./types.ts";
import { safeError } from "./secrets.ts";

const WIDGET_KEY = "voice-input";
const RECORDING_WIDGET = [
  "🎙 recording — /voice-toggle to stop, /voice-cancel to cancel",
];
const LISTENING_WIDGET = [
  "🎙 listening (VAD) — /voice-toggle to stop, /voice-cancel to cancel",
];
const TRANSCRIBING_WIDGET = ["… transcribing"];

export interface FlowUi {
  setWidget(key: string, content: string[] | undefined): void;
  getEditorText(): string;
  setEditorText(text: string): void;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface FlowContext {
  ui: FlowUi;
}

export interface FlowOpts {
  ctx: FlowContext;
  recorder: LocalAudioCapture;
  provider: SttProvider;
  config: VoiceInputConfig;
  pipeline?: VadPipeline;
}

export interface InsertResult {
  inserted: boolean;
  text?: string;
}

export function mergeTranscript(
  existing: string | undefined,
  transcript: string,
): string {
  const text = String(transcript ?? "").trim();
  if (!text) return existing ?? "";
  const current = existing ?? "";
  if (!current) return text;
  if (/\s$/.test(current)) return `${current}${text}`;
  return `${current} ${text}`;
}

export function withTimeout<T>(
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

export class VoiceInputFlow {
  private readonly ctx: FlowContext;
  private readonly recorder: LocalAudioCapture;
  private readonly provider: SttProvider;
  private readonly config: VoiceInputConfig;
  private readonly pipeline: VadPipeline | undefined;
  private readonly appender: OrderedAppender | undefined;

  constructor(opts: FlowOpts) {
    this.ctx = opts.ctx;
    this.recorder = opts.recorder;
    this.provider = opts.provider;
    this.config = opts.config;
    this.pipeline = opts.pipeline;
    if (opts.pipeline) {
      this.appender = new OrderedAppender((text) =>
        this.appendTranscript(text),
      );
    }
  }

  async startRecording(): Promise<void> {
    if (this.pipeline) {
      this.pipeline.setCallbacks({
        onTranscript: (text, index) => this.appender!.submit(index, text),
        onState: (state) =>
          this.setWidget(
            state === "transcribing" ? TRANSCRIBING_WIDGET : LISTENING_WIDGET,
          ),
        onError: (err) => this.fail(err),
      });
      this.pipeline.start();
      this.setWidget(LISTENING_WIDGET);
      return;
    }
    this.recorder.start();
    this.setWidget(RECORDING_WIDGET);
  }

  async finalizeRecording(): Promise<InsertResult> {
    if (this.pipeline) {
      this.setWidget(TRANSCRIBING_WIDGET);
      try {
        await this.pipeline.stop();
        await this.appender!.drain();
        return { inserted: true };
      } catch (error) {
        this.fail(error);
        throw error;
      } finally {
        await this.pipeline.release();
        this.setWidget(undefined);
      }
    }
    this.setWidget(TRANSCRIBING_WIDGET);
    try {
      const stopped = await this.recorder.stop();
      const transcript = await withTimeout(
        this.provider.transcribe(stopped.file),
        this.config.transcribeTimeoutMs,
        "Transcription",
      );
      return this.insertTranscript(transcript);
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.recorder.cleanup();
      this.setWidget(undefined);
    }
  }

  async cancel(): Promise<void> {
    if (this.pipeline) {
      await this.pipeline.cancel();
      this.setWidget(undefined);
      return;
    }
    await this.recorder.cancel();
    this.setWidget(undefined);
  }

  private appendTranscript(text: string): void {
    const current = this.ctx.ui.getEditorText();
    const next = mergeTranscript(current, text);
    this.ctx.ui.setEditorText(next);
  }

  private insertTranscript(transcript: string): InsertResult {
    const text = String(transcript ?? "").trim();
    if (!text) {
      this.ctx.ui.notify("No speech detected", "warning");
      return { inserted: false };
    }
    const current = this.ctx.ui.getEditorText();
    const next = mergeTranscript(current, text);
    this.ctx.ui.setEditorText(next);
    this.ctx.ui.notify("Transcript inserted", "info");
    return { inserted: true, text: next };
  }

  private setWidget(lines: string[] | undefined): void {
    this.ctx.ui.setWidget(WIDGET_KEY, lines);
  }

  private fail(error: unknown): void {
    this.ctx.ui.notify(`Voice input failed: ${safeError(error)}`, "warning");
  }
}

export class OrderedAppender {
  private readonly flush: (text: string) => void;
  private nextIndex = 1;
  private readonly pending = new Map<number, string>();
  private drainResolvers: Array<() => void> = [];

  constructor(flush: (text: string) => void) {
    this.flush = flush;
  }

  submit(index: number, text: string): void {
    this.pending.set(index, text);
    this.pump();
  }

  async drain(): Promise<void> {
    if (this.pending.size === 0) return;
    await new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private pump(): void {
    while (this.pending.has(this.nextIndex)) {
      const text = this.pending.get(this.nextIndex)!;
      this.pending.delete(this.nextIndex);
      this.nextIndex += 1;
      this.flush(text);
    }
    if (this.pending.size === 0) {
      const resolvers = this.drainResolvers;
      this.drainResolvers = [];
      for (const resolve of resolvers) resolve();
    }
  }
}
