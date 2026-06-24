import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRecorderArgs,
  buildStreamRecorderArgs,
  commandExists,
  selectRecorder,
  selectStreamRecorder,
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
    const exists = vi.fn((name: string) => name === "ffmpeg" || name === "parecord");
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
    expect(() => selectRecorder({ recorder: "auto" }, () => false)).toThrow(/No recorder found/);
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
    expect(args).toEqual(["--file-format=wav", "--channels=1", "--rate=16000", "--format=s16le", "/tmp/out.wav"]);
  });

  it("ignores device override (parecord reads PulseAudio default source)", () => {
    expect(buildRecorderArgs("parecord", "/tmp/out.wav", "ignored")).toEqual(
      buildRecorderArgs("parecord", "/tmp/out.wav"),
    );
  });
});

describe("buildRecorderArgs — sox", () => {
  it("records from -d at 16k mono to the file", () => {
    expect(buildRecorderArgs("sox", "/tmp/out.wav")).toEqual(["-d", "-r", "16000", "-c", "1", "/tmp/out.wav"]);
  });
});

describe("commandExists", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns true for a known-present command", () => {
    expect(commandExists("ls") || commandExists("node") || commandExists("true")).toBe(true);
  });

  it("returns true for the always-present `true` builtin wrapper", () => {
    expect(commandExists("true")).toBe(true);
  });

  it("returns false for a clearly-bogus command name", () => {
    expect(commandExists("definitely-not-a-real-cmd-xyzzy")).toBe(false);
  });

  it("does not execute shell injection via the command name", () => {
    expect(commandExists("ls; echo INJECTED")).toBe(false);
  });
});

describe("RecorderKind type completeness", () => {
  it("covers all variants", () => {
    const kinds: RecorderKind[] = ["auto", "ffmpeg", "parecord", "sox"];
    expect(kinds).toHaveLength(4);
  });
});

describe("selectStreamRecorder", () => {
  it("returns an explicit non-parecord recorder without probing", () => {
    const exists = vi.fn();
    expect(selectStreamRecorder({ recorder: "ffmpeg" }, exists)).toBe("ffmpeg");
    expect(selectStreamRecorder({ recorder: "sox" }, exists)).toBe("sox");
    expect(exists).not.toHaveBeenCalled();
  });

  it("falls through auto and parecord to probe ffmpeg/sox", () => {
    const exists = vi.fn((name: string) => name === "ffmpeg");
    expect(selectStreamRecorder({ recorder: "auto" }, exists)).toBe("ffmpeg");
    expect(selectStreamRecorder({ recorder: "parecord" }, exists)).toBe("ffmpeg");
  });

  it("prefers ffmpeg when both ffmpeg and sox are present", () => {
    const exists = vi.fn(() => true);
    expect(selectStreamRecorder({ recorder: "auto" }, exists)).toBe("ffmpeg");
  });

  it("falls back to sox when only sox is present", () => {
    const exists = vi.fn((name: string) => name === "sox");
    expect(selectStreamRecorder({ recorder: "auto" }, exists)).toBe("sox");
  });

  it("throws when neither ffmpeg nor sox is available", () => {
    const exists = vi.fn(() => false);
    expect(() => selectStreamRecorder({ recorder: "auto" }, exists)).toThrow(/requires ffmpeg or sox/);
  });
});

describe("buildStreamRecorderArgs", () => {
  it("emits raw s16le PCM to stdout for ffmpeg", () => {
    const args = buildStreamRecorderArgs("ffmpeg");
    expect(args[args.length - 1]).toBe("-");
    expect(args).toContain("-f");
    expect(args).toContain("s16le");
    expect(args).toContain("-ar");
    expect(args).toContain("16000");
    expect(args).toContain("-ac");
    expect(args).toContain("1");
  });

  it("emits raw signed-integer PCM to stdout for sox", () => {
    const args = buildStreamRecorderArgs("sox");
    expect(args[args.length - 1]).toBe("-");
    expect(args).toContain("-t");
    expect(args).toContain("raw");
    expect(args).toContain("-b");
    expect(args).toContain("16");
    expect(args).toContain("-e");
    expect(args).toContain("signed-integer");
  });

  it("throws for parecord (cannot pipe to stdout)", () => {
    expect(() => buildStreamRecorderArgs("parecord")).toThrow(/cannot stream raw PCM to stdout/);
  });
});
