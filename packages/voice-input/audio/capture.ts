import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, type PathLike } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRecorderArgs, type ResolvedRecorder } from "./recorder.ts";

export interface RecorderChildProcess {
  on(event: "error", listener: (err: Error) => void): this;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  kill(signal?: NodeJS.Signals): boolean;
  readonly pid?: number;
}

export type SpawnFn = (
  cmd: string,
  args: readonly string[],
  options: { stdio: "ignore" },
) => RecorderChildProcess;

export type MkdtempFn = (prefix: string) => string;
export type RmSyncFn = (
  path: PathLike,
  options: { recursive: true; force: true },
) => void;
export type TmpdirFn = () => string;

export interface LocalAudioCaptureOptions {
  spawn?: SpawnFn;
  mkdtemp?: MkdtempFn;
  rm?: RmSyncFn;
  tmpdir?: TmpdirFn;
  recorder: ResolvedRecorder;
  device?: string;
  stopTimeoutMs?: number;
}

const DEFAULT_STOP_TIMEOUT_MS = 3000;
const RECORDING_FILE = "recording.wav";

const FFMPEG_OK_EXIT_CODES = new Set([0, 130, 255]);
const GENERIC_OK_EXIT_CODES = new Set([0, 130]);

export class LocalAudioCapture {
  private readonly _spawn: SpawnFn;
  private readonly _mkdtemp: MkdtempFn;
  private readonly _rm: RmSyncFn;
  private readonly _tmpdir: TmpdirFn;
  private readonly _recorder: ResolvedRecorder;
  private readonly _device: string | undefined;
  private readonly _stopTimeoutMs: number;

  private _dir: string | null = null;
  private _child: RecorderChildProcess | null = null;
  private _spawnError: Error | null = null;

  constructor(opts: LocalAudioCaptureOptions) {
    this._spawn = opts.spawn ?? (spawn as unknown as SpawnFn);
    this._mkdtemp = opts.mkdtemp ?? defaultMkdtemp;
    this._rm = opts.rm ?? defaultRm;
    this._tmpdir = opts.tmpdir ?? tmpdir;
    this._recorder = opts.recorder;
    this._device = opts.device;
    this._stopTimeoutMs = opts.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  }

  start(): { file: string } {
    if (this._child || this._dir) {
      throw new Error("Recording already in progress.");
    }
    const dir = this._mkdtemp(join(this._tmpdir(), "voice-input-"));
    const file = join(dir, RECORDING_FILE);
    const args = buildRecorderArgs(this._recorder, file, this._device);
    const child = this._spawn(this._recorder, args, { stdio: "ignore" });
    this._dir = dir;
    this._child = child;
    this._spawnError = null;
    child.on("error", (err) => {
      this._spawnError = err;
    });
    return { file };
  }

  async stop(): Promise<{ file: string }> {
    const { child, file } = this.requireActive();
    try {
      child.kill("SIGINT");
    } catch {
      // best-effort signal; rely on exit/error below
    }
    const code = await waitForExit(child, this._stopTimeoutMs);
    this.assertAcceptableExit(code);
    this.clearChild();
    return { file };
  }

  async cancel(): Promise<void> {
    const child = this._child;
    try {
      child?.kill("SIGINT");
    } catch {
      // best-effort signal
    }
    this.clearChild();
    this.cleanup();
  }

  cleanup(): void {
    const dir = this._dir;
    this._dir = null;
    if (!dir) return;
    try {
      this._rm(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  private requireActive(): {
    child: RecorderChildProcess;
    file: string;
    dir: string;
  } {
    if (this._spawnError) {
      throw this._spawnError;
    }
    const child = this._child;
    const dir = this._dir;
    if (!child || !dir) {
      throw new Error("No active recording to stop.");
    }
    return { child, file: join(dir, RECORDING_FILE), dir };
  }

  private assertAcceptableExit(code: number | null): void {
    if (code === null) return;
    const ok =
      this._recorder === "ffmpeg"
        ? FFMPEG_OK_EXIT_CODES
        : GENERIC_OK_EXIT_CODES;
    if (!ok.has(code)) {
      throw new Error(`Recorder ${this._recorder} exited with code ${code}.`);
    }
  }

  private clearChild(): void {
    this._child = null;
  }
}

function waitForExit(
  child: RecorderChildProcess,
  timeoutMs: number,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Recorder stop timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

const defaultMkdtemp: MkdtempFn = (prefix) => mkdtempSync(prefix);
const defaultRm: RmSyncFn = (path, options) => rmSync(path, options);
