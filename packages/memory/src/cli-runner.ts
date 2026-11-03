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

export async function runHat(args: string[], options?: RunHatOptions): Promise<unknown> {
  if (options?.signal?.aborted) {
    throw new Error("Operation aborted");
  }
  try {
    const { stdout } = await execFile(HAT_BIN, buildHatArgv(args, options), {
      maxBuffer: 10 * 1024 * 1024,
      signal: options?.signal,
    });
    return JSON.parse(stdout);
  } catch (e: unknown) {
    if (options?.signal?.aborted) {
      throw new Error("Operation aborted", e instanceof Error ? { cause: e } : undefined);
    }
    const err = e as { stderr?: string; message?: string };
    const message = err.stderr?.trim() || err.message || String(e);
    throw new Error(message, e instanceof Error ? { cause: e } : undefined);
  }
}
