import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { RecorderChildProcess, SpawnFn } from "../audio/capture.ts";
import { LocalAudioCapture } from "../audio/capture.ts";
import type { ResolvedRecorder } from "../audio/recorder.ts";

interface FakeChild extends RecorderChildProcess {
  emit(code: number | null, signal?: NodeJS.Signals | null): void;
  emitError(err: Error): void;
  killCalls: Array<NodeJS.Signals | undefined>;
}

function makeFakeChild(): FakeChild {
  const ee = new EventEmitter();
  const killCalls: Array<NodeJS.Signals | undefined> = [];
  const child: FakeChild = {
    pid: 12345,
    on(event, listener) {
      ee.on(event, listener);
      return child;
    },
    kill(signal) {
      killCalls.push(signal);
      return true;
    },
    emit(code, signal = null) {
      ee.emit("exit", code, signal);
    },
    emitError(err) {
      ee.emit("error", err);
    },
    killCalls,
  };
  return child;
}

function makeFakes() {
  let lastChild!: FakeChild;
  const spawn = vi.fn(((_cmd, _args, _opts) => {
    lastChild = makeFakeChild();
    return lastChild;
  }) as SpawnFn);
  const mkdtemp = vi.fn((prefix: string) => `${prefix}XXX`);
  const rm = vi.fn(() => undefined);
  const tmpdir = vi.fn(() => "/tmp");
  return {
    spawn,
    mkdtemp,
    rm,
    tmpdir,
    lastChild: () => lastChild,
  };
}

function makeCapture(
  fakes: ReturnType<typeof makeFakes>,
  recorder: ResolvedRecorder = "ffmpeg",
  opts: { device?: string; stopTimeoutMs?: number } = {},
) {
  return new LocalAudioCapture({
    spawn: fakes.spawn,
    mkdtemp: fakes.mkdtemp,
    rm: fakes.rm,
    tmpdir: fakes.tmpdir,
    recorder,
    device: opts.device,
    stopTimeoutMs: opts.stopTimeoutMs,
  });
}

describe("LocalAudioCapture.start", () => {
  it("spawns the recorder with args derived from the file path", () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    const { file } = capture.start();
    expect(fakes.spawn).toHaveBeenCalledTimes(1);
    expect(fakes.mkdtemp).toHaveBeenCalledWith("/tmp/voice-input-");
    expect(file).toBe("/tmp/voice-input-XXX/recording.wav");
    const [, args] = fakes.spawn.mock.calls[0];
    expect(args[args.length - 1]).toBe(file);
  });

  it("throws if called twice without an intervening stop", () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    expect(() => capture.start()).toThrow(/already in progress/i);
  });
});

describe("LocalAudioCapture.stop — happy path", () => {
  it("sends SIGINT, then resolves with the file after exit 0 (ffmpeg)", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    const { file: started } = capture.start();
    const stopped = capture.stop();
    expect(fakes.lastChild().killCalls).toEqual(["SIGINT"]);
    fakes.lastChild().emit(0);
    await expect(stopped).resolves.toEqual({ file: started });
  });

  it("tolerates ffmpeg exit 255 (macOS avfoundation SIGINT quirk)", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    const stopped = capture.stop();
    fakes.lastChild().emit(255, "SIGINT");
    await expect(stopped).resolves.toBeDefined();
  });

  it("tolerates exit 130 for non-ffmpeg recorders", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "parecord");
    capture.start();
    const stopped = capture.stop();
    fakes.lastChild().emit(130, "SIGINT");
    await expect(stopped).resolves.toBeDefined();
  });

  it("treats a null exit code (signal death) as acceptable", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "sox");
    capture.start();
    const stopped = capture.stop();
    fakes.lastChild().emit(null, "SIGKILL");
    await expect(stopped).resolves.toBeDefined();
  });

  it("swallows kill errors during stop (best-effort signal)", async () => {
    const fakes = makeFakes();
    let child!: FakeChild;
    fakes.spawn.mockImplementationOnce((() => {
      child = makeFakeChild();
      child.kill = () => {
        throw new Error("kill failed");
      };
      return child;
    }) as SpawnFn);
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    const stopped = capture.stop();
    child.emit(0);
    await expect(stopped).resolves.toBeDefined();
  });
});

describe("LocalAudioCapture.stop — failure modes", () => {
  it("rejects when a non-ffmpeg recorder exits with an unexpected code", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "parecord");
    capture.start();
    const stopped = capture.stop();
    fakes.lastChild().emit(1);
    await expect(stopped).rejects.toThrow(/exited with code 1/);
  });

  it("rejects when ffmpeg exits with an unexpected code", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    const stopped = capture.stop();
    fakes.lastChild().emit(42);
    await expect(stopped).rejects.toThrow(/exited with code 42/);
  });

  it("rejects on stop timeout", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg", { stopTimeoutMs: 10 });
    capture.start();
    const stopped = capture.stop();
    // child never emits exit
    await expect(stopped).rejects.toThrow(/timed out after 10ms/);
  });

  it("rejects with the spawn error if the child failed to spawn", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    fakes.lastChild().emitError(new Error("ENOENT"));
    await expect(capture.stop()).rejects.toThrow(/ENOENT/);
  });

  it("throws if stop is called with no active recording", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    await expect(capture.stop()).rejects.toThrow(/No active recording/);
  });
});

describe("LocalAudioCapture.cancel", () => {
  it("sends SIGINT and immediately cleans up the temp dir", () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    capture.cancel();
    expect(fakes.lastChild().killCalls).toEqual(["SIGINT"]);
    expect(fakes.rm).toHaveBeenCalledWith("/tmp/voice-input-XXX", {
      recursive: true,
      force: true,
    });
  });

  it("does not throw when called with no active recording", () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    expect(() => capture.cancel()).not.toThrow();
    expect(fakes.rm).not.toHaveBeenCalled();
  });

  it("swallows kill errors (best-effort signal)", () => {
    const fakes = makeFakes();
    fakes.spawn.mockImplementationOnce((() => {
      const child = makeFakeChild();
      child.kill = () => {
        throw new Error("kill failed");
      };
      return child;
    }) as SpawnFn);
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    expect(() => capture.cancel()).not.toThrow();
  });
});

describe("LocalAudioCapture.cleanup", () => {
  it("removes the dir and is idempotent on subsequent calls", () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    capture.cleanup();
    expect(fakes.rm).toHaveBeenCalledTimes(1);
    capture.cleanup();
    expect(fakes.rm).toHaveBeenCalledTimes(1);
  });

  it("swallows rm errors", () => {
    const fakes = makeFakes();
    fakes.rm.mockImplementation(() => {
      throw new Error("EBUSY");
    });
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    expect(() => capture.cleanup()).not.toThrow();
  });

  it("uses stop() → cleanup() pipeline correctly: file delivered then dir removed", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    const { file } = capture.start();
    const stopped = capture.stop();
    fakes.lastChild().emit(0);
    await stopped;
    capture.cleanup();
    expect(fakes.rm).toHaveBeenCalledTimes(1);
    expect(file).toBe("/tmp/voice-input-XXX/recording.wav");
  });
});
