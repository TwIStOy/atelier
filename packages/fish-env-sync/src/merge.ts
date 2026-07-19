import type { FishUniversalVar } from "./parse.ts";

const PATH_SEPARATOR = ":";

export function joinValues(values: string[], pathvar: boolean): string {
  return values.join(pathvar ? PATH_SEPARATOR : " ");
}

export function mergeVarsIntoEnv(vars: FishUniversalVar[], target: Record<string, string | undefined>): void {
  for (const v of vars) {
    if (!v.exported) continue;
    const joined = joinValues(v.values, v.pathvar);
    if (v.name === "PATH" && v.pathvar) {
      target.PATH = mergePath(joined, target.PATH);
      continue;
    }
    target[v.name] = joined;
  }
}

function mergePath(newPath: string, existingPath: string | undefined): string {
  const newEntries = newPath.split(PATH_SEPARATOR).filter((e) => e.length > 0);
  const existingEntries = (existingPath ?? "").split(PATH_SEPARATOR).filter((e) => e.length > 0);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const e of newEntries) {
    if (seen.has(e)) continue;
    seen.add(e);
    ordered.push(e);
  }
  for (const e of existingEntries) {
    if (seen.has(e)) continue;
    seen.add(e);
    ordered.push(e);
  }
  return ordered.join(PATH_SEPARATOR);
}
