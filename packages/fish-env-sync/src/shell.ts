import { homedir } from "node:os";
import { join } from "node:path";

const FISH_BASENAME = "fish";

export function isFishBinary(shellPath: string): boolean {
  if (shellPath.length === 0) return false;
  const trimmed = shellPath.trim();
  if (trimmed.length === 0) return false;
  const base = trimmed.split("/").pop() ?? trimmed;
  return base === FISH_BASENAME;
}

export interface ShellDetectionInput {
  envShell?: string;
  passwdShell?: string;
}

export function detectFishShell(input: ShellDetectionInput): boolean {
  if (input.envShell && isFishBinary(input.envShell)) return true;
  if (input.passwdShell && isFishBinary(input.passwdShell)) return true;
  return false;
}

export function resolveFishVarsPath(env: NodeJS.ProcessEnv, home = homedir()): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg && xdg.length > 0) {
    return join(xdg, "fish", "fish_variables");
  }
  const envHome = env.HOME?.trim();
  if (envHome && envHome.length > 0) {
    return join(envHome, ".config", "fish", "fish_variables");
  }
  return join(home, ".config", "fish", "fish_variables");
}
