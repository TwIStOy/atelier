import { constants, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createHttpHooks,
  type HttpHooks,
  ReadonlyProvider,
  RealFSProvider,
  VM,
  type VMOptions,
} from "@earendil-works/gondolin";
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

export interface MountSpec {
  hostPath: string;
  guestPath: string;
  readOnly: boolean;
}

export interface MountEntry {
  hostRoot: string;
  guestRoot: string;
  readOnly: boolean;
}

export interface SandboxOptions {
  allowedHosts: string[];
  extraMounts?: MountSpec[];
}

export function parseExtraMounts(raw: string): MountSpec[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const parts = entry.split(":");
      if (parts.length < 2 || parts.length > 3) {
        throw new Error(`invalid extra mount "${entry}" (expected host:guest[:ro|:rw])`);
      }
      const [hostPath, guestPath, mode] = parts;
      const expanded = hostPath.startsWith("~/") ? path.join(os.homedir(), hostPath.slice(2)) : hostPath;
      if (!path.isAbsolute(expanded)) {
        throw new Error(`extra mount host path must be absolute: ${hostPath}`);
      }
      if (!guestPath.startsWith("/") || guestPath.replace(/\/+$/, "") === "") {
        throw new Error(`extra mount guest path must be an absolute path other than "/": ${guestPath}`);
      }
      if (mode !== undefined && mode !== "ro" && mode !== "rw") {
        throw new Error(`extra mount mode must be "ro" or "rw": ${mode}`);
      }
      return {
        hostPath: path.resolve(expanded),
        guestPath: guestPath.replace(/\/+$/, ""),
        readOnly: mode === "ro",
      };
    });
}

export function resolveGuestPath(mounts: MountEntry[], localPath: string): string {
  for (const mount of mounts) {
    const rel = path.relative(mount.hostRoot, localPath);
    if (rel === "") return mount.guestRoot;
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    return path.posix.join(mount.guestRoot, rel.split(path.sep).join(path.posix.sep));
  }
  const roots = mounts.map((m) => m.hostRoot).join(", ");
  throw new Error(`path escapes sandbox mounts (allowed roots: ${roots}): ${localPath}`);
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
  mounts: MountEntry[];
  warnings: string[];
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

  const providers: Record<string, RealFSProvider | ReadonlyProvider> = {
    [GUEST_WORKSPACE]: new RealFSProvider(localCwd),
  };
  const mounts: MountEntry[] = [{ hostRoot: localCwd, guestRoot: GUEST_WORKSPACE, readOnly: false }];
  const warnings: string[] = [];

  for (const spec of options.extraMounts ?? []) {
    if (!existsSync(spec.hostPath)) {
      warnings.push(`extra mount skipped, host path missing: ${spec.hostPath}`);
      continue;
    }
    if (providers[spec.guestPath]) {
      warnings.push(`extra mount skipped, duplicate guest path: ${spec.guestPath}`);
      continue;
    }
    const provider = spec.readOnly
      ? new ReadonlyProvider(new RealFSProvider(spec.hostPath))
      : new RealFSProvider(spec.hostPath);
    providers[spec.guestPath] = provider;
    mounts.push({ hostRoot: spec.hostPath, guestRoot: spec.guestPath, readOnly: spec.readOnly });
  }

  const vm = await VM.create({
    ...vmOptions,
    httpHooks,
    env,
    vfs: { mounts: providers },
  });

  return { vm, httpHooks, mounts, warnings };
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

export function createGondolinReadOps(vm: VM, mounts: MountEntry[]): ReadOperations {
  return {
    readFile: (p) => vm.fs.readFile(resolveGuestPath(mounts, p)),
    access: (p) => vm.fs.access(resolveGuestPath(mounts, p), { mode: constants.R_OK }),
    detectImageMimeType: async (p) => IMAGE_MIME_BY_EXT[path.extname(p).toLowerCase()] ?? null,
  };
}

export function createGondolinWriteOps(vm: VM, mounts: MountEntry[]): WriteOperations {
  return {
    writeFile: (p, content) => vm.fs.writeFile(resolveGuestPath(mounts, p), content, { encoding: "utf8" }),
    mkdir: (dir) => vm.fs.mkdir(resolveGuestPath(mounts, dir), { recursive: true }),
  };
}

export function createGondolinEditOps(vm: VM, mounts: MountEntry[]): EditOperations {
  return {
    readFile: (p) => vm.fs.readFile(resolveGuestPath(mounts, p)),
    access: (p) => vm.fs.access(resolveGuestPath(mounts, p), { mode: constants.R_OK | constants.W_OK }),
    writeFile: (p, content) => vm.fs.writeFile(resolveGuestPath(mounts, p), content, { encoding: "utf8" }),
  };
}

export function createGondolinGrepOps(vm: VM, mounts: MountEntry[]): GrepOperations {
  return {
    isDirectory: async (p) => (await vm.fs.stat(resolveGuestPath(mounts, p))).isDirectory(),
    readFile: (p) => vm.fs.readFile(resolveGuestPath(mounts, p), { encoding: "utf8" }),
  };
}

export function createGondolinFindOps(vm: VM, mounts: MountEntry[]): FindOperations {
  return {
    exists: async (p) => {
      try {
        await vm.fs.stat(resolveGuestPath(mounts, p));
        return true;
      } catch {
        return false;
      }
    },
    glob: async (pattern, searchPath, { ignore, limit }) => {
      const guestRoot = resolveGuestPath(mounts, searchPath);
      const mountRoot =
        mounts.find((m) => guestRoot === m.guestRoot || guestRoot.startsWith(`${m.guestRoot}/`))?.guestRoot ??
        GUEST_WORKSPACE;

      let insideGitRepo = false;
      for (let current = guestRoot; ; current = path.posix.dirname(current)) {
        try {
          await vm.fs.stat(path.posix.join(current, ".git"));
          insideGitRepo = true;
        } catch {
          // keep walking up
        }
        if (insideGitRepo || current === mountRoot) break;
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

export function createGondolinLsOps(vm: VM, mounts: MountEntry[]): LsOperations {
  return {
    exists: async (p) => {
      try {
        await vm.fs.stat(resolveGuestPath(mounts, p));
        return true;
      } catch {
        return false;
      }
    },
    stat: (p) => vm.fs.stat(resolveGuestPath(mounts, p)),
    readdir: (p) => vm.fs.listDir(resolveGuestPath(mounts, p)),
  };
}

export function createGondolinBashOps(vm: VM, mounts: MountEntry[]): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const guestCwd = resolveGuestPath(mounts, cwd);

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
