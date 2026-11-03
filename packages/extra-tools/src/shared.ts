import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";

function expandUser(p: string): string {
  if (p === "~" || p.startsWith("~/")) {
    return path.join(homedir(), p === "~" ? "" : p.slice(2));
  }
  return p;
}

export function resolveSearchPath(raw: string | undefined, cwd: string): string {
  const p = (raw?.trim() || ".").trim() || ".";
  const expanded = expandUser(p);
  if (path.isAbsolute(expanded)) return path.normalize(expanded);
  return path.resolve(cwd, expanded);
}

/**
 * Stream `rg` stdout line by line, collecting `parseLine` results up to
 * `maxCollect` (the child is killed once the cap is reached). Exit codes 0 and
 * 1 are success; anything else rejects with stderr.
 */
export function runRg<T>(
  args: string[],
  execCwd: string,
  signal: AbortSignal | undefined,
  maxCollect: number,
  parseLine: (line: string) => T | undefined,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const results: T[] = [];
    const child = spawn("rg", args, {
      cwd: execCwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const onAbort = () => {
      if (!child.killed) child.kill("SIGTERM");
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stderr?.on("data", (c) => {
      stderr += c.toString();
    });

    const stdout = child.stdout;
    if (!stdout) {
      settle(() => reject(new Error("ripgrep: no stdout")));
      return;
    }

    const rl = createInterface({ input: stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      const parsed = parseLine(line);
      if (parsed === undefined) return;
      results.push(parsed);
      if (results.length >= maxCollect && !child.killed) {
        child.kill("SIGTERM");
      }
    });

    child.on("error", (err) => {
      rl.close();
      if (signal) signal.removeEventListener("abort", onAbort);
      settle(() =>
        reject(
          new Error(
            `ripgrep (rg) not found or failed to start: ${err.message}. Install ripgrep and ensure it is on PATH.`,
          ),
        ),
      );
    });

    child.on("close", (code) => {
      rl.close();
      if (signal) signal.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        settle(() => reject(new Error("Operation aborted")));
        return;
      }
      const killedForCap = results.length >= maxCollect;
      const c = code ?? 0;
      if (!killedForCap && c !== 0 && c !== 1) {
        const msg = stderr.trim() || `ripgrep exited with code ${c}`;
        settle(() => reject(new Error(msg)));
        return;
      }
      settle(() => resolve(results));
    });
  });
}

export function truncateOutput(textOut: string): { text: string; truncated: boolean } {
  const truncation = truncateHead(textOut, {
    maxLines: Number.MAX_SAFE_INTEGER,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  let text = truncation.content;
  if (truncation.truncated) {
    text += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
  }
  return { text, truncated: truncation.truncated };
}
