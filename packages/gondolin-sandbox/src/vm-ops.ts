import { constants } from "node:fs";
import path from "node:path";
import { createHttpHooks, type HttpHooks, RealFSProvider, VM, type VMOptions } from "@earendil-works/gondolin";
import type {
  BashOperations,
  EditOperations,
  FindOperations,
  GrepOperations,
  LsOperations,
  ReadOperations,
  WriteOperations,
} from "@earendil-works/pi-coding-agent";

const GUEST_WORKSPACE = "/workspace";

export interface SandboxOptions {
  allowedHosts: string[];
}

export function toGuestPath(localCwd: string, localPath: string): string {
  const rel = path.relative(localCwd, localPath);
  if (rel === "") return GUEST_WORKSPACE;
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${localPath}`);
  }
  const posixRel = rel.split(path.sep).join(path.posix.sep);
  return path.posix.join(GUEST_WORKSPACE, posixRel);
}

function sanitizeEnv(env?: NodeJS.ProcessEnv): Record<string, string> | undefined {
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export interface VmHandle {
  vm: VM;
  httpHooks?: HttpHooks;
}

export async function createSandboxVm(
  localCwd: string,
  options: SandboxOptions,
  vmOptions: Pick<VMOptions, "sandbox" | "memory" | "cpus">,
): Promise<VmHandle> {
  let httpHooks: HttpHooks | undefined;
  let env: Record<string, string> | undefined;

  if (options.allowedHosts.length > 0) {
    const built = createHttpHooks({ allowedHosts: options.allowedHosts });
    httpHooks = built.httpHooks;
    env = built.env as Record<string, string> | undefined;
  }

  const vm = await VM.create({
    ...vmOptions,
    httpHooks,
    env,
    vfs: {
      mounts: {
        [GUEST_WORKSPACE]: new RealFSProvider(localCwd),
      },
    },
  });

  return { vm, httpHooks };
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export function createGondolinReadOps(vm: VM, localCwd: string): ReadOperations {
  return {
    readFile: (p) => vm.fs.readFile(toGuestPath(localCwd, p)),
    access: (p) => vm.fs.access(toGuestPath(localCwd, p), { mode: constants.R_OK }),
    detectImageMimeType: async (p) => IMAGE_MIME_BY_EXT[path.extname(p).toLowerCase()] ?? null,
  };
}

export function createGondolinWriteOps(vm: VM, localCwd: string): WriteOperations {
  return {
    writeFile: (p, content) => vm.fs.writeFile(toGuestPath(localCwd, p), content, { encoding: "utf8" }),
    mkdir: (dir) => vm.fs.mkdir(toGuestPath(localCwd, dir), { recursive: true }),
  };
}

export function createGondolinEditOps(vm: VM, localCwd: string): EditOperations {
  return {
    readFile: (p) => vm.fs.readFile(toGuestPath(localCwd, p)),
    access: (p) => vm.fs.access(toGuestPath(localCwd, p), { mode: constants.R_OK | constants.W_OK }),
    writeFile: (p, content) => vm.fs.writeFile(toGuestPath(localCwd, p), content, { encoding: "utf8" }),
  };
}

export function createGondolinGrepOps(vm: VM, localCwd: string): GrepOperations {
  return {
    isDirectory: async (p) => (await vm.fs.stat(toGuestPath(localCwd, p))).isDirectory(),
    readFile: (p) => vm.fs.readFile(toGuestPath(localCwd, p), { encoding: "utf8" }),
  };
}

export function createGondolinFindOps(vm: VM, localCwd: string): FindOperations {
  return {
    exists: async (p) => {
      try {
        await vm.fs.stat(toGuestPath(localCwd, p));
        return true;
      } catch {
        return false;
      }
    },
    glob: async (pattern, searchPath, { ignore, limit }) => {
      const guestRoot = toGuestPath(localCwd, searchPath);

      let insideGitRepo = false;
      for (let current = guestRoot; ; current = path.posix.dirname(current)) {
        try {
          await vm.fs.stat(path.posix.join(current, ".git"));
          insideGitRepo = true;
        } catch {
          // keep walking up
        }
        if (insideGitRepo || current === GUEST_WORKSPACE) break;
      }

      const args = ["/usr/bin/fd", "--glob", "--color=never", "--hidden"];
      for (const ignorePattern of ignore) {
        const segment = /^\*\*\/(.+)\/\*\*$/.exec(ignorePattern);
        args.push("--exclude", segment ? segment[1] : ignorePattern);
      }
      if (!insideGitRepo) args.push("--no-require-git");
      args.push("--max-results", String(limit));

      const posixPattern = pattern.split(path.sep).join("/");
      let effectivePattern = posixPattern;
      if (posixPattern.includes("/")) {
        args.push("--full-path");
        if (!posixPattern.startsWith("/") && !posixPattern.startsWith("**/") && posixPattern !== "**") {
          effectivePattern = `**/${posixPattern}`;
        }
      }
      args.push("--", effectivePattern, guestRoot);

      const r = await vm.exec(args);
      if (r.exitCode !== 0 && r.stdout.length === 0) {
        throw new Error(r.stderr.trim() || `fd exited with code ${r.exitCode}`);
      }
      const prefix = `${guestRoot}/`;
      return r
        .lines()
        .map((line) => line.replace(/\r$/, ""))
        .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
        .filter((line) => line.length > 0);
    },
  };
}

export function createGondolinLsOps(vm: VM, localCwd: string): LsOperations {
  return {
    exists: async (p) => {
      try {
        await vm.fs.stat(toGuestPath(localCwd, p));
        return true;
      } catch {
        return false;
      }
    },
    stat: (p) => vm.fs.stat(toGuestPath(localCwd, p)),
    readdir: (p) => vm.fs.listDir(toGuestPath(localCwd, p)),
  };
}

export function createGondolinBashOps(vm: VM, localCwd: string): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const guestCwd = toGuestPath(localCwd, cwd);

      const ac = new AbortController();
      const onAbort = () => ac.abort();
      signal?.addEventListener("abort", onAbort, { once: true });

      let timedOut = false;
      const timer =
        timeout && timeout > 0
          ? setTimeout(() => {
              timedOut = true;
              ac.abort();
            }, timeout * 1000)
          : undefined;

      try {
        const proc = vm.exec(["/bin/bash", "-lc", command], {
          cwd: guestCwd,
          signal: ac.signal,
          env: sanitizeEnv(env),
          stdout: "pipe",
          stderr: "pipe",
        });

        for await (const chunk of proc.output()) {
          onData(chunk.data);
        }

        const r = await proc;
        return { exitCode: r.exitCode };
      } catch (err) {
        if (signal?.aborted) throw new Error("aborted");
        if (timedOut) throw new Error(`timeout:${timeout}`);
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
