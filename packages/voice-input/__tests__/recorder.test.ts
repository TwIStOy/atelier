import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRecorderArgs,
  commandExists,
  selectRecorder,
} from "../audio/recorder.ts";
import type { RecorderKind } from "../types.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selectRecorder", () => {
  it("returns the explicit recorder without probing when not 'auto'", () => {
    const exists = vi.fn();
    expect(selectRecorder({ recorder: "ffmpeg" }, exists)).toBe("ffmpeg");
    expect(selectRecorder({ recorder: "parecord" }, exists)).toBe("parecord");
    expect(selectRecorder({ recorder: "sox" }, exists)).toBe("sox");
    expect(exists).not.toHaveBeenCalled();
  });

  it("on linux: prefers parecord when present", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    const exists = vi.fn((name: string) => name === "parecord");
    expect(selectRecorder({ recorder: "auto" }, exists)).toBe("parecord");
    expect(exists).toHaveBeenNthCalledWith(1, "parecord");
  });

  it("on linux: falls back to ffmpeg when parecord is missing", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    const exists = vi.fn((name: string) => name === "ffmpeg");
    expect(selectRecorder({ recorder: "auto" }, exists)).toBe("ffmpeg");
  });

  it("on non-linux: skips parecord and prefers ffmpeg", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    const exists = vi.fn(
      (name: string) => name === "ffmpeg" || name === "parecord",
    );
    expect(selectRecorder({ recorder: "auto" }, exists)).toBe("ffmpeg");
    expect(exists).not.toHaveBeenCalledWith("parecord");
  });

  it("falls through to sox when ffmpeg is missing but sox exists", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    const exists = vi.fn((name: string) => name === "sox");
    expect(selectRecorder({ recorder: "auto" }, exists)).toBe("sox");
  });

  it("throws a guiding error when no recorder is available", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    expect(() => selectRecorder({ recorder: "auto" }, () => false)).toThrow(
      /No recorder found/,
    );
  });
});

describe("buildRecorderArgs — ffmpeg", () => {
  it("places input args before output flags and emits 16k mono wav", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    const args = buildRecorderArgs("ffmpeg", "/tmp/out.wav");
    expect(args).toEqual([
      "-y",
      "-f",
      "pulse",
      "-i",
      "default",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "/tmp/out.wav",
    ]);
  });

  it("uses :0 default input on macOS", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    expect(buildRecorderArgs("ffmpeg", "/tmp/out.wav")).toEqual([
      "-y",
      "-f",
      "avfoundation",
      "-i",
      ":0",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "/tmp/out.wav",
    ]);
  });

  it("uses dshow on win32", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    expect(buildRecorderArgs("ffmpeg", "/tmp/out.wav")).toEqual([
      "-y",
      "-f",
      "dshow",
      "-i",
      "audio=Microphone",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      "/tmp/out.wav",
    ]);
  });

  it("overrides the default device when provided", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    const args = buildRecorderArgs("ffmpeg", "/tmp/out.wav", ":2");
    expect(args).toContain("-i");
    expect(args[args.indexOf("-i") + 1]).toBe(":2");
  });
});

describe("buildRecorderArgs — parecord", () => {
  it("emits wav/s16le/16k/mono to the file", () => {
    const args = buildRecorderArgs("parecord", "/tmp/out.wav");
    expect(args).toEqual([
      "--file-format=wav",
      "--channels=1",
      "--rate=16000",
      "--format=s16le",
      "/tmp/out.wav",
    ]);
  });

  it("ignores device override (parecord reads PulseAudio default source)", () => {
    expect(buildRecorderArgs("parecord", "/tmp/out.wav", "ignored")).toEqual(
      buildRecorderArgs("parecord", "/tmp/out.wav"),
    );
  });
});

describe("buildRecorderArgs — sox", () => {
  it("records from -d at 16k mono to the file", () => {
    expect(buildRecorderArgs("sox", "/tmp/out.wav")).toEqual([
      "-d",
      "-r",
      "16000",
      "-c",
      "1",
      "/tmp/out.wav",
    ]);
  });
});

describe("commandExists", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns true for a known-present command", () => {
    expect(commandExists("ls") || commandExists("node")).toBe(true);
  });

  it("returns false for a clearly-bogus command name", () => {
    expect(commandExists("definitely-not-a-real-cmd-xyzzy")).toBe(false);
  });
});

describe("RecorderKind type completeness", () => {
  it("covers all variants", () => {
    const kinds: RecorderKind[] = ["auto", "ffmpeg", "parecord", "sox"];
    expect(kinds).toHaveLength(4);
  });
});
