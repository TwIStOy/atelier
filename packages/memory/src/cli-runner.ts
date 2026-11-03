import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { getSessionNamespace, sanitizeNamespace } from "./settings.js";

const execFile = promisify(execFileCb);
const HAT_BIN = "hat";

export type RunHatOptions = {
  namespace?: string;
  signal?: AbortSignal;
};

function buildHatArgv(args: string[], options?: RunHatOptions): string[] {
  const ns = options?.namespace !== undefined ? sanitizeNamespace(options.namespace) : getSessionNamespace();
  return ["--json", ...(ns ? ["--namespace", ns] : []), ...args];
}

function aborted(options?: RunHatOptions): boolean {
  return !!options?.signal?.aborted;
}

function errorCause(e: unknown): ErrorOptions | undefined {
  return e instanceof Error ? { cause: e } : undefined;
}

function hatErrorMessage(e: unknown): string {
  const err = e as { stderr?: string; message?: string };
  return err.stderr?.trim() || err.message || String(e);
}

function hatFailure(e: unknown, options?: RunHatOptions): Error {
  if (aborted(options)) {
    return new Error("Operation aborted", errorCause(e));
  }
  return new Error(hatErrorMessage(e), errorCause(e));
}

export async function runHat(args: string[], options?: RunHatOptions): Promise<unknown> {
  if (aborted(options)) {
    throw new Error("Operation aborted");
  }
  try {
    const { stdout } = await execFile(HAT_BIN, buildHatArgv(args, options), {
      maxBuffer: 10 * 1024 * 1024,
      signal: options?.signal,
    });
    return JSON.parse(stdout);
  } catch (e: unknown) {
    throw hatFailure(e, options);
  }
}
