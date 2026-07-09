import { posix as posixPath, win32 as winPath } from "node:path";

import { isSafeSystemPath } from "./safe-system-paths.ts";

export function isPathWithinDirectory(pathValue: string, directory: string, platform: NodeJS.Platform): boolean {
  if (!pathValue || !directory) {
    return false;
  }

  if (pathValue === directory) {
    return true;
  }

  const impl = platform === "win32" ? winPath : posixPath;
  const rel = impl.relative(directory, pathValue);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${impl.sep}`) && !impl.isAbsolute(rel);
}

export function isPathOutsideWorkingDirectory(
  canonicalPath: string,
  canonicalCwd: string,
  platform: NodeJS.Platform,
): boolean {
  if (!canonicalCwd || !canonicalPath) {
    return false;
  }
  if (isSafeSystemPath(canonicalPath)) {
    return false;
  }
  return !isPathWithinDirectory(canonicalPath, canonicalCwd, platform);
}
