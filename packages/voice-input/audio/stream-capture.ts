import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { buildStreamRecorderArgs, type ResolvedRecorder } from "./recorder.ts";

export interface StreamRecorderChild {
  readonly stdout: Readable;
  on(event: "error", listener: (err: Error) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
  readonly pid?: number;
}

export type StreamSpawnFn = (
  cmd: string,
  args: readonly string[],
  options: { stdio: ["ignore", "pipe", "ignore"] },
) => StreamRecorderChild;

export interface StreamCaptureOptions {
  spawn?: StreamSpawnFn;
  recorder: ResolvedRecorder;
  device?: string;
  stopTimeoutMs?: number;
}

const DEFAULT_STOP_TIMEOUT_MS = 3000;

const FFMPEG_OK_EXIT_CODES = new Set([0, 130, 255]);
const GENERIC_OK_EXIT_CODES = new Set([0, 130]);

export class StreamCapture {
  private readonly _spawn: StreamSpawnFn;
  private readonly _recorder: ResolvedRecorder;
  private readonly _device: string | undefined;
  private readonly _stopTimeoutMs: number;

  private _child: StreamRecorderChild | null = null;
  private _spawnError: Error | null = null;
  private _exited = false;

  constructor(opts: StreamCaptureOptions) {
    this._spawn = opts.spawn ?? (spawn as unknown as StreamSpawnFn);
    this._recorder = opts.recorder;
    this._device = opts.device;
    this._stopTimeoutMs = opts.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
  }

  start(): Readable {
    if (this._child) {
      throw new Error("Stream recording already in progress.");
    }
    const args = buildStreamRecorderArgs(this._recorder, this._device);
    const child = this._spawn(this._recorder, args, {
      stdio: ["ignore", "pipe", "ignore"],
    });
    this._child = child;
    this._spawnError = null;
    this._exited = false;
    child.on("error", (err) => {
      this._spawnError = err;
    });
    child.on("exit", () => {
      this._exited = true;
    });
    return child.stdout;
  }

  async stop(): Promise<void> {
    const child = this.requireActive();
    try {
      child.kill("SIGINT");
    } catch {
      // best-effort signal; rely on exit/error below
    }
    const code = await waitForExit(child, this._stopTimeoutMs);
    this.assertAcceptableExit(code);
    this._child = null;
  }

  async cancel(): Promise<void> {
    const child = this._child;
    try {
      child?.kill("SIGINT");
    } catch {
      // best-effort signal
    }
    this._child = null;
  }

  isActive(): boolean {
    return this._child !== null && !this._exited;
  }

  private requireActive(): StreamRecorderChild {
    if (this._spawnError) {
      throw this._spawnError;
    }
    const child = this._child;
    if (!child) {
      throw new Error("No active stream recording to stop.");
    }
    return child;
  }

  private assertAcceptableExit(code: number | null): void {
    if (code === null) return;
    const ok = this._recorder === "ffmpeg" ? FFMPEG_OK_EXIT_CODES : GENERIC_OK_EXIT_CODES;
    if (!ok.has(code)) {
      throw new Error(`Recorder ${this._recorder} exited with code ${code}.`);
    }
  }
}

function waitForExit(child: StreamRecorderChild, timeoutMs: number): Promise<number | null> {
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
