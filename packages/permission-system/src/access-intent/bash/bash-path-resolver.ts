import type { PathNormalizer } from "../../path-normalizer.ts";
import { isSafeSystemPath } from "../../safe-system-paths.ts";
import type { PathRuleTokenMatcher } from "../../types.ts";
import type { AccessPath } from "../access-path.ts";
import { normalizePathPolicyLiteral } from "../path-normalization.ts";
import { ARG_NODE_TYPES, SKIP_SUBTREE_TYPES } from "./node-text.ts";
import type { TSNode } from "./parser.ts";
import {
  classifyPromotedRuleCandidate,
  classifyTokenAsPathCandidate,
  classifyTokenAsRuleCandidate,
} from "./token-classification.ts";
import {
  collectCommandTokens,
  collectPathCandidateTokens,
  collectRedirectTokens,
  extractCommandName,
} from "./token-collection.ts";

const NO_PROMOTION: PathRuleTokenMatcher = () => false;

type EffectiveBase = { readonly kind: "known"; readonly offset: string } | { readonly kind: "unknown" };

interface PathCandidate {
  readonly token: string;
  readonly base: EffectiveBase;
}

export interface BashPathRuleCandidate {
  readonly token: string;
  readonly path: AccessPath;
}

export interface ResolvedBashPaths {
  readonly externalPaths: readonly AccessPath[];
  readonly ruleCandidates: readonly BashPathRuleCandidate[];
}

const CWD_BASE: EffectiveBase = { kind: "known", offset: "" };
const UNKNOWN_BASE: EffectiveBase = { kind: "unknown" };

export class BashPathResolver {
  constructor(
    private readonly normalizer: PathNormalizer,
    private readonly isPromotablePathToken: PathRuleTokenMatcher = NO_PROMOTION,
  ) {}

  resolve(rootNode: TSNode): ResolvedBashPaths {
    const candidates = this.collectPathCandidates(rootNode);
    return {
      externalPaths: this.projectExternalPaths(candidates),
      ruleCandidates: this.projectRuleCandidates(candidates),
    };
  }

  private collectPathCandidates(rootNode: TSNode): PathCandidate[] {
    const out: PathCandidate[] = [];
    this.walkForCandidates(rootNode, CWD_BASE, out);
    return out;
  }

  private walkForCandidates(node: TSNode, base: EffectiveBase, out: PathCandidate[]): EffectiveBase {
    switch (node.type) {
      case "program":
      case "list":
      case "redirected_statement":
        return this.walkCurrentShellSequence(node, base, out);
      case "command":
        tagTokens(collectCommandTokens(node), base, out);
        return this.foldCd(node, base);
      case "pipeline":
        return this.walkPipeline(node, base, out);
      case "subshell":
        this.walkCurrentShellSequence(node, base, out);
        return base;
      case "compound_statement":
        return this.walkCurrentShellSequence(node, base, out);
      default:
        tagTokens(collectPathCandidateTokens(node), base, out);
        return base;
    }
  }

  private walkCurrentShellSequence(seqNode: TSNode, base: EffectiveBase, out: PathCandidate[]): EffectiveBase {
    let current = base;
    for (let i = 0; i < seqNode.childCount; i++) {
      const child = seqNode.child(i);
      if (!child?.isNamed) continue;
      if (SKIP_SUBTREE_TYPES.has(child.type)) continue;
      const after = this.walkForCandidates(child, current, out);
      current = isBackgrounded(seqNode, i) ? current : after;
    }
    return current;
  }

  private walkPipeline(node: TSNode, base: EffectiveBase, out: PathCandidate[]): EffectiveBase {
    let current = base;
    let first = true;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child?.isNamed) continue;
      if (SKIP_SUBTREE_TYPES.has(child.type)) continue;
      if (first) {
        current = this.foldPipelineFirstStage(child, current, out);
        first = false;
        continue;
      }
      tagTokens(collectPathCandidateTokens(child), current, out);
    }
    return current;
  }

  private foldPipelineFirstStage(node: TSNode, base: EffectiveBase, out: PathCandidate[]): EffectiveBase {
    if (node.type === "list") return this.foldListExceptTerminal(node, base, out);
    if (node.type === "redirected_statement") {
      let current = base;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child?.isNamed) continue;
        if (child.type === "file_redirect") {
          tagTokens(collectRedirectTokens(child), current, out);
          continue;
        }
        current = this.foldPipelineFirstStage(child, current, out);
      }
      return current;
    }
    tagTokens(collectPathCandidateTokens(node), base, out);
    return base;
  }

  private foldListExceptTerminal(node: TSNode, base: EffectiveBase, out: PathCandidate[]): EffectiveBase {
    const namedChildren: TSNode[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.isNamed && !SKIP_SUBTREE_TYPES.has(child.type)) {
        namedChildren.push(child);
      }
    }
    let current = base;
    for (let i = 0; i < namedChildren.length; i++) {
      const child = namedChildren[i]!;
      if (i < namedChildren.length - 1) {
        current = this.walkForCandidates(child, current, out);
      } else {
        tagTokens(collectPathCandidateTokens(child), current, out);
      }
    }
    return current;
  }

  private foldCd(commandNode: TSNode, base: EffectiveBase): EffectiveBase {
    if (extractCommandName(commandNode) !== "cd") return base;
    const target = cdLiteralTarget(commandNode);
    if (target === null) return UNKNOWN_BASE;
    const interpreted = this.normalizer.interpretBashCdTarget(target);
    switch (interpreted.kind) {
      case "absolute":
        return { kind: "known", offset: interpreted.value };
      case "unknown":
        return UNKNOWN_BASE;
      case "relative":
        if (base.kind === "unknown") return UNKNOWN_BASE;
        return {
          kind: "known",
          offset: this.normalizer.joinBase(base.offset, target),
        };
    }
  }

  private projectExternalPaths(candidates: readonly PathCandidate[]): AccessPath[] {
    const seen = new Set<string>();
    const externalPaths: AccessPath[] = [];

    for (const { token, base } of candidates) {
      const candidate = classifyTokenAsPathCandidate(token);
      if (!candidate) continue;

      if (base.kind === "unknown" && this.isRelativeCandidate(candidate)) {
        const accessPath = this.normalizer.forPath(candidate);
        const canonical = accessPath.boundaryValue();
        if (canonical && !isSafeSystemPath(canonical) && !seen.has(canonical)) {
          seen.add(canonical);
          externalPaths.push(accessPath);
        }
        continue;
      }

      const resolveBase = base.kind === "known" ? this.normalizer.resolveBase(base.offset) : undefined;
      const accessPath = this.normalizer.forBashToken(candidate, {
        resolveBase,
      });
      const lexical = accessPath.value();
      if (!lexical) continue;
      const canonical = accessPath.boundaryValue();
      const isExternal = canonical ? this.normalizer.isBoundaryOutsideWorkingDirectory(canonical) : true;
      const dedupKey = canonical || lexical;

      if (isExternal && !seen.has(dedupKey)) {
        seen.add(dedupKey);
        externalPaths.push(accessPath);
      }
    }

    return externalPaths;
  }

  private projectRuleCandidates(candidates: readonly PathCandidate[]): BashPathRuleCandidate[] {
    const seen = new Set<string>();
    const result: BashPathRuleCandidate[] = [];
    const windowsSeparators = this.normalizer.usesWindowsSeparators();

    for (const { token, base } of candidates) {
      const candidate =
        classifyTokenAsRuleCandidate(token, { windowsSeparators }) ??
        classifyPromotedRuleCandidate(token, this.isPromotablePathToken);
      if (!candidate) continue;

      const path = this.buildRuleCandidatePath(candidate, base);
      const matchValues = path.matchValues();
      if (matchValues.length === 0) continue;

      const key = matchValues.join("\0");
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ token: candidate, path });
    }

    return result;
  }

  private buildRuleCandidatePath(candidate: string, base: EffectiveBase): AccessPath {
    if (base.kind === "unknown" && this.isRelativeCandidate(candidate)) {
      return this.normalizer.forLiteral(normalizePathPolicyLiteral(candidate));
    }

    const resolveBase = base.kind === "known" ? this.normalizer.resolveBase(base.offset) : undefined;
    return this.normalizer.forBashToken(candidate, { resolveBase });
  }

  private isRelativeCandidate(candidate: string): boolean {
    return !this.normalizer.isAbsolute(candidate) && !candidate.startsWith("~");
  }
}

function isBackgrounded(seqNode: TSNode, index: number): boolean {
  const next = seqNode.child(index + 1);
  if (!next || next.isNamed) return false;
  return next.type === "&";
}

function tagTokens(tokens: readonly string[], base: EffectiveBase, out: PathCandidate[]): void {
  for (const token of tokens) out.push({ token, base });
}

function cdLiteralTarget(commandNode: TSNode): string | null {
  for (let i = 0; i < commandNode.childCount; i++) {
    const child = commandNode.child(i);
    if (!child) continue;
    if (child.type === "command_name" || child.type === "variable_assignment") continue;
    if (!child.isNamed) continue;
    if (child.type === "word" && child.text === "--") continue;
    if (!ARG_NODE_TYPES.has(child.type)) return null;
    return literalTextOf(child);
  }
  return null;
}

function literalTextOf(node: TSNode): string | null {
  switch (node.type) {
    case "word": {
      const text = node.text;
      if (text === "-" || text.startsWith("~")) return null;
      return text;
    }
    case "raw_string": {
      const text = node.text;
      return text.length >= 2 && text.startsWith("'") && text.endsWith("'") ? text.slice(1, -1) : text;
    }
    case "concatenation": {
      let result = "";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        const part = literalTextOf(child);
        if (part === null) return null;
        result += part;
      }
      return result;
    }
    case "string": {
      let result = "";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        if (child.type === '"') continue;
        if (child.type !== "string_content") return null;
        result += child.text;
      }
      return result;
    }
    default:
      return null;
  }
}
