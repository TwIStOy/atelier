import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { MirrorMappings } from "./types.ts";

export interface MirrorResolution {
  cwd: string;
  mirrorRoot: string | null;
}

export function resolveMirrorRoot(mappings: MirrorMappings, cwd: string): string | null {
  const canonicalCwd = realpathSafe(cwd);
  if (canonicalCwd === null) return null;
  for (const [key, value] of Object.entries(mappings)) {
    const canonicalKey = realpathSafe(resolveAgainst(cwd, key));
    if (canonicalKey === null) continue;
    if (canonicalKey === canonicalCwd) return value;
  }
  return null;
}

function resolveAgainst(cwd: string, p: string): string {
  return isAbsolute(p) ? p : resolve(cwd, p);
}

function realpathSafe(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}
