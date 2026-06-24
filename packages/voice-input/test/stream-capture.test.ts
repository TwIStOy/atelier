import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedRecorder } from "../src/audio/recorder.ts";
import type { StreamRecorderChild, StreamSpawnFn } from "../src/audio/stream-capture.ts";
import { StreamCapture } from "../src/audio/stream-capture.ts";

interface FakeStreamChild extends StreamRecorderChild {
  emit(code: number | null, signal?: NodeJS.Signals | null): void;
  emitError(err: Error): void;
  killCalls: Array<NodeJS.Signals | undefined>;
  stdout: Readable;
}

function makeFakeChild(): FakeStreamChild {
  const ee = new EventEmitter();
  const killCalls: Array<NodeJS.Signals | undefined> = [];
  const stdout = new Readable({ read() {} });
  const child: FakeStreamChild = {
    pid: 23456,
    stdout,
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
  let lastChild!: FakeStreamChild;
  const spawn = vi.fn(((_cmd, _args, _opts) => {
    lastChild = makeFakeChild();
    return lastChild;
  }) as StreamSpawnFn);
  return { spawn, lastChild: () => lastChild };
}

function makeCapture(
  fakes: ReturnType<typeof makeFakes>,
  recorder: ResolvedRecorder = "ffmpeg",
  opts: { device?: string; stopTimeoutMs?: number } = {},
) {
  return new StreamCapture({
    spawn: fakes.spawn,
    recorder,
    device: opts.device,
    stopTimeoutMs: opts.stopTimeoutMs,
  });
}

describe("StreamCapture.start", () => {
  it("spawns the recorder and returns its stdout stream", () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    const stdout = capture.start();
    expect(fakes.spawn).toHaveBeenCalledTimes(1);
    expect(stdout).toBe(fakes.lastChild().stdout);
  });

  it("throws if called twice without an intervening stop", () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    expect(() => capture.start()).toThrow(/already in progress/i);
  });

  it("uses stream-style args ending with stdout '-' for ffmpeg", () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    const [, args] = fakes.spawn.mock.calls[0];
    expect(args[args.length - 1]).toBe("-");
    expect(args).toContain("-f");
    expect(args).toContain("s16le");
  });
});

describe("StreamCapture.stop — happy path", () => {
  it("sends SIGINT then resolves after exit 0 (ffmpeg)", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    const stopped = capture.stop();
    expect(fakes.lastChild().killCalls).toEqual(["SIGINT"]);
    fakes.lastChild().emit(0);
    await expect(stopped).resolves.toBeUndefined();
  });

  it("tolerates ffmpeg exit 255 (macOS avfoundation quirk)", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    const stopped = capture.stop();
    fakes.lastChild().emit(255, "SIGINT");
    await expect(stopped).resolves.toBeUndefined();
  });

  it("tolerates exit 130 for sox", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "sox");
    capture.start();
    const stopped = capture.stop();
    fakes.lastChild().emit(130, "SIGINT");
    await expect(stopped).resolves.toBeUndefined();
  });

  it("treats a null exit code (signal death) as acceptable", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    const stopped = capture.stop();
    fakes.lastChild().emit(null, "SIGKILL");
    await expect(stopped).resolves.toBeUndefined();
  });
});

describe("StreamCapture.stop — failure modes", () => {
  it("rejects when sox exits with an unexpected code", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "sox");
    capture.start();
    const stopped = capture.stop();
    fakes.lastChild().emit(1);
    await expect(stopped).rejects.toThrow(/exited with code 1/);
  });

  it("rejects on stop timeout", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg", { stopTimeoutMs: 10 });
    capture.start();
    const stopped = capture.stop();
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
    await expect(capture.stop()).rejects.toThrow(/No active stream recording/);
  });
});

describe("StreamCapture.cancel", () => {
  it("sends SIGINT and clears the active child", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    expect(capture.isActive()).toBe(true);
    await capture.cancel();
    expect(fakes.lastChild().killCalls).toEqual(["SIGINT"]);
    expect(capture.isActive()).toBe(false);
  });

  it("does not throw when called with no active recording", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    await expect(capture.cancel()).resolves.toBeUndefined();
  });
});

describe("StreamCapture.isActive", () => {
  it("reflects active state before and after exit", async () => {
    const fakes = makeFakes();
    const capture = makeCapture(fakes, "ffmpeg");
    capture.start();
    expect(capture.isActive()).toBe(true);
    fakes.lastChild().emit(0);
    expect(capture.isActive()).toBe(false);
  });
});
