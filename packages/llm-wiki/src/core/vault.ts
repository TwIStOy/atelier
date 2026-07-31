import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { VAULT_DIR_NAME } from "./paths.ts";

export interface ResolveVaultsOptions {
  cwd: string;
  personalVaultPath?: string;
}

export interface ResolvedVaults {
  projectVault: string | null;
  personalVault: string;
}

export function defaultPersonalVaultPath(homedir: string = os.homedir()): string {
  return path.join(homedir, VAULT_DIR_NAME);
}

function findProjectVault(cwd: string): string | null {
  let dir = path.resolve(cwd);
  while (true) {
    const candidate = path.join(dir, VAULT_DIR_NAME);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function resolveVaults(opts: ResolveVaultsOptions): ResolvedVaults {
  return {
    projectVault: findProjectVault(opts.cwd),
    personalVault: opts.personalVaultPath ?? defaultPersonalVaultPath(),
  };
}
