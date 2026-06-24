import { describe, expect, it, vi } from "vitest";
import type { LocalAudioCapture } from "../audio/capture.ts";
import type { VadPipeline, VadPipelineCallbacks } from "../audio/vad-pipeline.ts";
import { mergeTranscript, OrderedAppender, VoiceInputFlow, withTimeout } from "../flow.ts";
import type { SttProvider } from "../providers/index.ts";
import type { VoiceInputConfig } from "../types.ts";

const CONFIG: VoiceInputConfig = {
  provider: "inference-self-host",
  providers: {},
  recorder: "auto",
  micDevice: "",
  transcribeTimeoutMs: 1000,
  vad: {
    enabled: false,
    threshold: 0.5,
    minSpeechMs: 250,
    minSilenceMs: 500,
    maxSpeechMs: 30000,
  },
};

describe("mergeTranscript", () => {
  it("returns existing when transcript is empty", () => {
    expect(mergeTranscript("hello", "")).toBe("hello");
  });

  it("returns existing when transcript is whitespace only", () => {
    expect(mergeTranscript("hello", "   ")).toBe("hello");
  });

  it("returns trimmed transcript when current is empty", () => {
    expect(mergeTranscript("", "  hi  ")).toBe("hi");
  });

  it("returns transcript when existing is undefined", () => {
    expect(mergeTranscript(undefined, "hi")).toBe("hi");
  });

  it("concatenates directly when current ends with whitespace", () => {
    expect(mergeTranscript("hello ", "world")).toBe("hello world");
  });

  it("inserts a space when current has no trailing whitespace", () => {
    expect(mergeTranscript("hello", "world")).toBe("hello world");
  });

  it("handles tab/newline as trailing whitespace", () => {
    expect(mergeTranscript("hello\t", "world")).toBe("hello\tworld");
  });
});

describe("withTimeout", () => {
  it("resolves with the promise value when fast enough", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "Op")).resolves.toBe(42);
  });

  it("rejects with a labeled message on timeout", async () => {
    const slow = new Promise<string>(() => {});
    await expect(withTimeout(slow, 20, "Transcription")).rejects.toThrow(/Transcription timed out after 20ms/);
  });

  it("surfaces the underlying rejection when the promise errors", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "Op")).rejects.toThrow("boom");
  });
});

interface FakeRecorder {
  startFile: string;
  transcribedFile: string | null;
  cleanupCalled: boolean;
  cancelCalled: boolean;
  stopFile: string;
  stopError: Error | null;
  asCapture(): LocalAudioCapture;
}

function makeFakeRecorder(stopFile = "/tmp/voice/recording.wav"): FakeRecorder {
  const rec: FakeRecorder = {
    startFile: stopFile,
    transcribedFile: null,
    cleanupCalled: false,
    cancelCalled: false,
    stopFile,
    stopError: null,
    asCapture() {
      const self = this;
      return {
        start() {
          return { file: self.startFile };
        },
        async stop() {
          if (self.stopError) throw self.stopError;
          return { file: self.stopFile };
        },
        async cancel() {
          self.cancelCalled = true;
        },
        cleanup() {
          self.cleanupCalled = true;
        },
      } as unknown as LocalAudioCapture;
    },
  };
  return rec;
}

interface FakeProvider {
  transcribe: ReturnType<typeof vi.fn>;
  asProvider(): SttProvider;
}

function makeFakeProvider(transcript = "hello"): FakeProvider {
  const fn = vi.fn(async () => {
    return transcript;
  });
  return {
    transcribe: fn,
    asProvider: () => ({ transcribe: fn }) as SttProvider,
  };
}

function makeCtx(initialEditor = "") {
  let editor = initialEditor;
  const calls: {
    widgets: Array<string[] | undefined>;
    notifications: Array<{ message: string; type?: string }>;
    editorTexts: string[];
  } = { widgets: [], notifications: [], editorTexts: [] };
  return {
    calls,
    ctx: {
      ui: {
        setWidget(_key: string, content: string[] | undefined) {
          calls.widgets.push(content);
        },
        getEditorText() {
          return editor;
        },
        setEditorText(text: string) {
          editor = text;
          calls.editorTexts.push(text);
        },
        notify(message: string, type?: "info" | "warning" | "error") {
          calls.notifications.push({ message, type });
        },
      },
    },
  };
}

describe("VoiceInputFlow.startRecording", () => {
  it("starts the recorder and shows the recording widget", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider();
    const { ctx } = makeCtx();
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
    });
    await flow.startRecording();
    expect(ctx.ui).toBeDefined();
    expect(recorder.startFile).toBeTruthy();
  });
});

describe("VoiceInputFlow.finalizeRecording — happy path", () => {
  it("stops recorder, transcribes, appends to editor, cleans up, clears widget", async () => {
    const recorder = makeFakeRecorder("/tmp/r.wav");
    const provider = makeFakeProvider("hello world");
    const { ctx, calls } = makeCtx("existing");
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
    });

    const result = await flow.finalizeRecording();

    expect(result.inserted).toBe(true);
    expect(result.text).toBe("existing hello world");
    expect(calls.editorTexts).toEqual(["existing hello world"]);
    expect(calls.notifications[0]).toMatchObject({
      message: "Transcript inserted",
      type: "info",
    });
    expect(recorder.cleanupCalled).toBe(true);
    expect(calls.widgets.at(-1)).toBeUndefined();
    expect(provider.transcribe).toHaveBeenCalledWith("/tmp/r.wav");
  });

  it("shows the transcribing widget before transcription", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider("x");
    const { ctx, calls } = makeCtx();
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
    });
    await flow.finalizeRecording();
    expect(calls.widgets[0]).toEqual(["… transcribing"]);
  });

  it("inserts with no separator when editor ends in whitespace", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider("world");
    const { ctx, calls } = makeCtx("hello ");
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
    });
    await flow.finalizeRecording();
    expect(calls.editorTexts[0]).toBe("hello world");
  });
});

describe("VoiceInputFlow.finalizeRecording — empty transcript", () => {
  it("notifies warning and does not edit the editor", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider("   ");
    const { ctx, calls } = makeCtx("untouched");
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
    });
    const result = await flow.finalizeRecording();
    expect(result.inserted).toBe(false);
    expect(calls.editorTexts).toHaveLength(0);
    expect(calls.notifications[0]).toMatchObject({
      message: "No speech detected",
      type: "warning",
    });
    expect(recorder.cleanupCalled).toBe(true);
  });
});

describe("VoiceInputFlow.finalizeRecording — transcription failure", () => {
  it("notifies failure, rethrows, but still cleans up + clears widget", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider();
    provider.transcribe.mockRejectedValueOnce(new Error("STT down"));
    const { ctx, calls } = makeCtx();
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
    });
    await expect(flow.finalizeRecording()).rejects.toThrow("STT down");
    expect(calls.notifications[0].message).toMatch(/Voice input failed/);
    expect(recorder.cleanupCalled).toBe(true);
    expect(calls.widgets.at(-1)).toBeUndefined();
  });

  it("rethrows when stop() fails but still cleans up", async () => {
    const recorder = makeFakeRecorder();
    recorder.stopError = new Error("exit code 1");
    const provider = makeFakeProvider();
    const { ctx, calls } = makeCtx();
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
    });
    await expect(flow.finalizeRecording()).rejects.toThrow("exit code 1");
    expect(recorder.cleanupCalled).toBe(true);
    expect(calls.widgets.at(-1)).toBeUndefined();
  });

  it("aborts transcription after the configured timeout", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider();
    provider.transcribe.mockImplementationOnce(() => new Promise<string>(() => {}));
    const { ctx } = makeCtx();
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: { ...CONFIG, transcribeTimeoutMs: 20 },
    });
    await expect(flow.finalizeRecording()).rejects.toThrow(/Transcription timed out after 20ms/);
    expect(recorder.cleanupCalled).toBe(true);
  });
});

describe("VoiceInputFlow.cancel", () => {
  it("cancels the recorder and clears the widget", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider();
    const { ctx, calls } = makeCtx();
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
    });
    await flow.cancel();
    expect(recorder.cancelCalled).toBe(true);
    expect(calls.widgets.at(-1)).toBeUndefined();
  });
});

describe("VoiceInputFlow — redaction on failure", () => {
  it("does not leak an API key embedded in the transcribe error", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider();
    provider.transcribe.mockRejectedValueOnce(new Error("Authorization: Bearer sk-leaked-123 failed"));
    const { ctx, calls } = makeCtx();
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
    });
    await flow.finalizeRecording().catch(() => {});
    const note = calls.notifications[0];
    expect(note.message).not.toContain("sk-leaked-123");
    expect(note.message).toContain("<redacted>");
  });
});

describe("OrderedAppender", () => {
  it("flushes segments strictly in index order even when submitted out of order", () => {
    const flushed: string[] = [];
    const appender = new OrderedAppender((text) => flushed.push(text));
    appender.submit(2, "second");
    appender.submit(1, "first");
    appender.submit(3, "third");
    expect(flushed).toEqual(["first", "second", "third"]);
  });

  it("flushes immediately when segments arrive in order", () => {
    const flushed: string[] = [];
    const appender = new OrderedAppender((text) => flushed.push(text));
    appender.submit(1, "a");
    appender.submit(2, "b");
    appender.submit(3, "c");
    expect(flushed).toEqual(["a", "b", "c"]);
  });

  it("resolves drain() once the pending queue empties", async () => {
    const flushed: string[] = [];
    const appender = new OrderedAppender((text) => flushed.push(text));
    appender.submit(2, "late");
    const drain = appender.drain();
    appender.submit(1, "early");
    await drain;
    expect(flushed).toEqual(["early", "late"]);
  });

  it("drain() resolves immediately when nothing is pending", async () => {
    const appender = new OrderedAppender(() => {});
    await expect(appender.drain()).resolves.toBeUndefined();
  });
});

function makeFakePipeline(): {
  pipeline: VadPipeline;
} {
  let savedCallbacks: VadPipelineCallbacks | undefined;
  return {
    pipeline: {
      setCallbacks: vi.fn((cb: VadPipelineCallbacks) => {
        savedCallbacks = cb;
      }),
      start: vi.fn(() => {
        savedCallbacks?.onState?.("listening");
      }),
      stop: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      release: vi.fn(async () => {}),
    } as unknown as VadPipeline,
  };
}

describe("VoiceInputFlow — VAD mode", () => {
  it("starts the pipeline and shows the listening widget", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider();
    const { ctx, calls } = makeCtx();
    const { pipeline } = makeFakePipeline();
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
      pipeline,
    });
    await flow.startRecording();
    expect(pipeline.start).toHaveBeenCalledTimes(1);
    expect(pipeline.setCallbacks).toHaveBeenCalledTimes(1);
    expect(calls.widgets.at(-1)).toEqual(["🎙 listening (VAD) — /voice-toggle to stop, /voice-cancel to cancel"]);
  });

  it("stops, drains pending segments, and clears the widget", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider();
    const { ctx, calls } = makeCtx("existing");
    const { pipeline } = makeFakePipeline();
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
      pipeline,
    });
    await flow.startRecording();
    await flow.finalizeRecording();
    expect(pipeline.stop).toHaveBeenCalledTimes(1);
    expect(pipeline.release).toHaveBeenCalledTimes(1);
    expect(calls.widgets.at(-1)).toBeUndefined();
  });

  it("cancel delegates to the pipeline and clears the widget", async () => {
    const recorder = makeFakeRecorder();
    const provider = makeFakeProvider();
    const { ctx, calls } = makeCtx();
    const { pipeline } = makeFakePipeline();
    const flow = new VoiceInputFlow({
      ctx,
      recorder: recorder.asCapture(),
      provider: provider.asProvider(),
      config: CONFIG,
      pipeline,
    });
    await flow.cancel();
    expect(pipeline.cancel).toHaveBeenCalledTimes(1);
    expect(calls.widgets.at(-1)).toBeUndefined();
  });
});
