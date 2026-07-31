import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

const DISABLED_FILENAME = "extensions-disabled.json";

export interface DisableConfigPaths {
  globalPath: string;
  projectPath: string;
}

export function defaultDisablePaths(): DisableConfigPaths {
  return {
    globalPath: join(getAgentDir(), DISABLED_FILENAME),
    projectPath: join(process.cwd(), CONFIG_DIR_NAME, DISABLED_FILENAME),
  };
}

function readDisabledMap(filePath: string): Set<string> {
  try {
    if (!existsSync(filePath)) return new Set();
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return new Set();
    const disabled = new Set<string>();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === true) disabled.add(key);
    }
    return disabled;
  } catch {
    return new Set();
  }
}

export function resolveDisabledExtensions(paths: DisableConfigPaths): Set<string> {
  const globalDisabled = readDisabledMap(paths.globalPath);
  const projectDisabled = readDisabledMap(paths.projectPath);
  return new Set([...globalDisabled, ...projectDisabled]);
}

export function isExtensionDisabled(extensionId: string): boolean {
  return resolveDisabledExtensions(defaultDisablePaths()).has(extensionId);
}
