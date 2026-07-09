import {
  canonicalNormalizePathForComparison,
  getPathPolicyValues,
  normalizePathForComparison,
} from "./path-normalization.ts";

export class AccessPath {
  private constructor(
    private readonly lexical: string,
    private readonly matchAliases: readonly string[],
    private readonly canonical: string,
  ) {}

  matchValues(): string[] {
    return this.canonical ? [...new Set([...this.matchAliases, this.canonical])] : [...this.matchAliases];
  }

  boundaryValue(): string {
    return this.canonical;
  }

  value(): string {
    return this.lexical;
  }

  resolvedAlias(): string | undefined {
    if (!this.canonical || this.canonical === this.lexical) {
      return undefined;
    }
    return this.canonical;
  }

  static forPath(
    pathValue: string,
    options: { cwd: string; resolveBase?: string; platform: NodeJS.Platform },
  ): AccessPath {
    const { cwd, resolveBase = cwd, platform } = options;
    return new AccessPath(
      normalizePathForComparison(pathValue, resolveBase, platform),
      getPathPolicyValues(pathValue, { cwd, resolveBase }, platform),
      canonicalNormalizePathForComparison(pathValue, resolveBase, platform),
    );
  }

  static forLiteral(literal: string, matchAliases: readonly string[] = []): AccessPath {
    if (!literal) return new AccessPath("", [], "");
    const aliases = [...new Set([literal, ...matchAliases.filter(Boolean)])];
    return new AccessPath(literal, aliases, "");
  }

  static forDevice(devicePath: string): AccessPath {
    return new AccessPath(devicePath, [devicePath], devicePath);
  }
}
