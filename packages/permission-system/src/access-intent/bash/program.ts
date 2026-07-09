import type { PathNormalizer } from "../../path-normalizer.ts";
import type { BashCommand, PathRuleTokenMatcher } from "../../types.ts";
import type { AccessPath } from "../access-path.ts";
import { BashPathResolver, type BashPathRuleCandidate } from "./bash-path-resolver.ts";
import { collectCommands } from "./command-enumeration.ts";
import { getParser } from "./parser.ts";

export type { BashCommand, BashPathRuleCandidate };

export class BashProgram {
  private constructor(
    private readonly commandUnits: readonly BashCommand[],
    private readonly resolvedExternalPaths: readonly AccessPath[],
    private readonly resolvedRuleCandidates: readonly BashPathRuleCandidate[],
  ) {}

  static async parse(
    command: string,
    normalizer: PathNormalizer,
    isPromotablePathToken?: PathRuleTokenMatcher,
  ): Promise<BashProgram> {
    const parser = await getParser();
    const tree = parser.parse(command);
    if (!tree) return new BashProgram([], [], []);

    try {
      const { externalPaths, ruleCandidates } = new BashPathResolver(normalizer, isPromotablePathToken).resolve(
        tree.rootNode,
      );
      return new BashProgram(collectCommands(tree.rootNode), externalPaths, ruleCandidates);
    } finally {
      tree.delete();
    }
  }

  commands(): BashCommand[] {
    return [...this.commandUnits];
  }

  externalPaths(): AccessPath[] {
    return [...this.resolvedExternalPaths];
  }

  pathRuleCandidates(): BashPathRuleCandidate[] {
    return [...this.resolvedRuleCandidates];
  }
}
