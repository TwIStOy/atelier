import * as path from "node:path";

const MUTATING_TOOLS = new Set(["write", "edit"]);

export interface ClassifyOptions {
  cwd: string;
  vaultRoots: string[];
}

export interface GuardDecision {
  block: boolean;
  reason?: string;
  wikiTouched: boolean;
  touchedVault?: string;
}

export function classifyPathOperation(toolName: string, input: unknown, opts: ClassifyOptions): GuardDecision {
  if (!MUTATING_TOOLS.has(toolName)) return { block: false, wikiTouched: false };
  const target = readPath(input);
  if (target === null) return { block: false, wikiTouched: false };

  const abs = path.isAbsolute(target) ? path.resolve(target) : path.resolve(opts.cwd, target);

  let wikiVault: string | undefined;
  for (const vaultRoot of opts.vaultRoots) {
    if (contains(path.join(vaultRoot, "raw"), abs)) {
      return {
        block: true,
        reason: `wiki guardrail: raw/ is immutable — use wiki_capture instead of writing ${truncatePath(target)}`,
        wikiTouched: false,
      };
    }
    if (contains(path.join(vaultRoot, "meta"), abs)) {
      return {
        block: true,
        reason: `wiki guardrail: meta/ is derived — use wiki_rebuild_meta instead of writing ${truncatePath(target)}`,
        wikiTouched: false,
      };
    }
    if (contains(path.join(vaultRoot, "wiki"), abs)) {
      wikiVault = vaultRoot;
    }
  }

  return wikiVault === undefined
    ? { block: false, wikiTouched: false }
    : { block: false, wikiTouched: true, touchedVault: wikiVault };
}

function readPath(input: unknown): string | null {
  if (input === null || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  return typeof record.path === "string" && record.path.length > 0 ? record.path : null;
}

function contains(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function truncatePath(target: string): string {
  return target.length <= 80 ? target : `${target.slice(0, 77)}...`;
}
