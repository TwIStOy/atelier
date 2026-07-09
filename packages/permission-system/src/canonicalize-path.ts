import { realpathSync } from "node:fs";
import { posix as posixPath, win32 as winPath } from "node:path";

export function canonicalizePath(absolutePath: string, platform: NodeJS.Platform): string {
  if (!absolutePath) return absolutePath;

  const impl = platform === "win32" ? winPath : posixPath;
  const root = impl.parse(absolutePath).root;
  const rest = absolutePath.slice(root.length);
  const parts = rest.split(impl.sep).filter(Boolean);
  for (let i = parts.length; i >= 0; i--) {
    const candidate = root + parts.slice(0, i).join(impl.sep);
    try {
      const real = realpathSync(candidate);
      const tail = parts.slice(i);
      return tail.length === 0 ? real : impl.join(real, ...tail);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return absolutePath;
    }
  }
  return absolutePath;
}
