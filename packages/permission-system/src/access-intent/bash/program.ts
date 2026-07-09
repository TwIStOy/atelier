import type { BashCommand } from "../../types.ts";
import { collectCommands } from "./command-enumeration.ts";
import { getParser } from "./parser.ts";

export type { BashCommand };

// ── Path-analysis surface (Step 2 — not yet implemented) ───────────────────
//
// `externalPaths()` and `pathRuleCandidates()` depend on a PathNormalizer +
// AccessPath + cd-aware BashPathResolver layer (~1000 LOC of path logic).
// They are intentionally stubbed returning empty for Step 1 (red-test porting).
// The full implementations land in Step 2; their tests are marked
// `.skip` in test/access-intent/bash/program.test.ts until then.

// Placeholder types so parse() matches the upstream call signature the
// ported tests use. Step 2 replaces these with real PathNormalizer +
// PathRuleTokenMatcher implementations.
export type PathNormalizer = unknown;
export type PathRuleTokenMatcher = (token: string) => boolean;

export interface BashPathRuleCandidate {
  readonly token: string;
  readonly path: { matchValues(): string[]; value(): string; boundaryValue(): string };
}

export class BashProgram {
  private constructor(
    private readonly commandUnits: readonly BashCommand[],
    private readonly _externalPathValues: readonly string[] = [],
    private readonly _pathRuleCandidateTokens: readonly BashPathRuleCandidate[] = [],
  ) {}

  static async parse(
    _command: string,
    _normalizer?: PathNormalizer,
    _isPromotablePathToken?: PathRuleTokenMatcher,
  ): Promise<BashProgram> {
    const parser = await getParser();
    const tree = parser.parse(_command);
    if (!tree) return new BashProgram([], [], []);

    try {
      return new BashProgram(collectCommands(tree.rootNode));
    } finally {
      tree.delete();
    }
  }

  commands(): BashCommand[] {
    return [...this.commandUnits];
  }

  externalPaths(): { value(): string }[] {
    return this._externalPathValues.map((v) => ({ value: () => v }));
  }

  pathRuleCandidates(): BashPathRuleCandidate[] {
    return [...this._pathRuleCandidateTokens];
  }
}
