export const SAFE_SYSTEM_PATHS: ReadonlySet<string> = new Set([
  "/dev/null",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
]);

export function isSafeSystemPath(normalizedPath: string): boolean {
  return SAFE_SYSTEM_PATHS.has(normalizedPath);
}
