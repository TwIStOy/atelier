import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, resolve, sep } from "node:path";

export function findExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!command) return undefined;
  const candidates =
    isAbsolute(command) || command.includes(sep)
      ? [resolve(command)]
      : (env.PATH?.split(delimiter) ?? []).map((directory) => resolve(directory, command));
  for (const candidate of candidates) {
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}
