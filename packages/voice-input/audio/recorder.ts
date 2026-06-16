import { spawnSync } from "node:child_process";
import type { RecorderKind } from "../types.ts";

export type ResolvedRecorder = Exclude<RecorderKind, "auto">;

export function commandExists(name: string): boolean {
  if (process.platform === "win32") {
    return spawnExists("where", [name]);
  }
  return spawnExists("sh", [
    "-c",
    `command -v ${shellQuote(name)} >/dev/null 2>&1`,
  ]);
}

function spawnExists(cmd: string, args: string[]): boolean {
  try {
    const result = spawnSync(cmd, args, { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function shellQuote(name: string): string {
  return "'" + name.replace(/'/g, "'\\''") + "'";
}

export function selectRecorder(
  config: { recorder: RecorderKind },
  exists: (name: string) => boolean = commandExists,
): ResolvedRecorder {
  if (config.recorder !== "auto") return config.recorder;
  if (process.platform === "linux" && exists("parecord")) return "parecord";
  if (exists("ffmpeg")) return "ffmpeg";
  if (exists("sox")) return "sox";
  throw new Error(
    "No recorder found. Install ffmpeg, sox, or pulseaudioUtils (parecord).",
  );
}

export function selectStreamRecorder(
  config: { recorder: RecorderKind },
  exists: (name: string) => boolean = commandExists,
): ResolvedRecorder {
  if (config.recorder !== "auto" && config.recorder !== "parecord") {
    return config.recorder;
  }
  if (exists("ffmpeg")) return "ffmpeg";
  if (exists("sox")) return "sox";
  throw new Error(
    "Stream recording requires ffmpeg or sox (parecord cannot pipe to stdout). Install one of them.",
  );
}

export function buildRecorderArgs(
  recorder: ResolvedRecorder,
  file: string,
  device?: string,
): string[] {
  const rate = "16000";
  const channels = "1";
  switch (recorder) {
    case "ffmpeg":
      return [
        "-y",
        ...ffmpegInputArgs(device),
        "-ar",
        rate,
        "-ac",
        channels,
        "-f",
        "wav",
        file,
      ];
    case "parecord":
      return [
        "--file-format=wav",
        "--channels=1",
        "--rate=16000",
        "--format=s16le",
        file,
      ];
    case "sox":
      return ["-d", "-r", rate, "-c", channels, file];
  }
}

function ffmpegInputArgs(device?: string): string[] {
  switch (process.platform) {
    case "darwin":
      return ["-f", "avfoundation", "-i", device || ":0"];
    case "win32":
      return ["-f", "dshow", "-i", device || "audio=Microphone"];
    default:
      return ["-f", "pulse", "-i", device || "default"];
  }
}

export function buildStreamRecorderArgs(
  recorder: ResolvedRecorder,
  device?: string,
): string[] {
  const rate = "16000";
  switch (recorder) {
    case "ffmpeg":
      return [
        "-y",
        ...ffmpegInputArgs(device),
        "-ar",
        rate,
        "-ac",
        "1",
        "-f",
        "s16le",
        "-",
      ];
    case "sox":
      return [
        "-d",
        "-t",
        "raw",
        "-r",
        rate,
        "-c",
        "1",
        "-b",
        "16",
        "-e",
        "signed-integer",
        "-",
      ];
    case "parecord":
      throw new Error(
        "parecord cannot stream raw PCM to stdout; use ffmpeg or sox for VAD mode.",
      );
  }
}
