import { basename } from "node:path";
import { ARG_NODE_TYPES, resolveNodeText, SKIP_SUBTREE_TYPES } from "./node-text.ts";
import type { TSNode } from "./parser.ts";

export function collectPathCandidateTokens(node: TSNode): string[] {
  if (SKIP_SUBTREE_TYPES.has(node.type)) return [];
  if (node.type === "command") return collectCommandTokens(node);
  if (node.type === "file_redirect") return collectRedirectTokens(node);

  const tokens: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) tokens.push(...collectPathCandidateTokens(child));
  }
  return tokens;
}

export function collectCommandTokens(node: TSNode): string[] {
  const commandName = extractCommandName(node);
  const config = commandName ? PATTERN_FIRST_COMMANDS.get(commandName) : undefined;
  return config ? collectPatternCommandTokens(node, config) : collectGenericCommandTokens(node);
}

export function collectRedirectTokens(node: TSNode): string[] {
  const tokens: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (ARG_NODE_TYPES.has(child.type)) {
      tokens.push(resolveNodeText(child));
    }
  }
  return tokens;
}

export function extractCommandName(node: TSNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "command_name") {
      const text = resolveNodeText(child);
      return text ? basename(text) : undefined;
    }
  }
  return undefined;
}

interface PatternCommandConfig {
  readonly argConsumingFlags: ReadonlySet<string>;
  readonly fileConsumingFlags: ReadonlySet<string>;
  readonly patternPositionals?: number;
}

const PATTERN_FIRST_COMMANDS: ReadonlyMap<string, PatternCommandConfig> = new Map([
  [
    "sed",
    {
      argConsumingFlags: new Set(["-e", "-i"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "awk",
    {
      argConsumingFlags: new Set(["-e", "-F", "-v"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "gawk",
    {
      argConsumingFlags: new Set(["-e", "-F", "-v"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "nawk",
    {
      argConsumingFlags: new Set(["-e", "-F", "-v"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "grep",
    {
      argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "egrep",
    {
      argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "fgrep",
    {
      argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "rg",
    {
      argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m", "-g", "-t", "-T", "-j", "-M", "-r", "-E"]),
      fileConsumingFlags: new Set(["-f"]),
    },
  ],
  [
    "sd",
    {
      argConsumingFlags: new Set(["-n", "-f"]),
      fileConsumingFlags: new Set([]),
      patternPositionals: 2,
    },
  ],
]);

type PatternCommandFlagDirective =
  | { kind: "end-of-flags" }
  | { kind: "regular-flag" }
  | {
      kind: "consume-arg";
      nextArgAction: "skip" | "extract";
      setsExplicitScript: boolean;
    };

function classifyPatternCommandFlag(text: string, config: PatternCommandConfig): PatternCommandFlagDirective {
  if (text === "--") return { kind: "end-of-flags" };
  if (config.argConsumingFlags.has(text)) {
    return {
      kind: "consume-arg",
      nextArgAction: "skip",
      setsExplicitScript: text === "-e" || text === "-f",
    };
  }
  if (config.fileConsumingFlags.has(text)) {
    return {
      kind: "consume-arg",
      nextArgAction: "extract",
      setsExplicitScript: true,
    };
  }
  return { kind: "regular-flag" };
}

function collectPatternCommandTokens(node: TSNode, config: PatternCommandConfig): string[] {
  const patternPositionals = config.patternPositionals ?? 1;
  let hasExplicitScript = false;
  let positionalsSeen = 0;
  let nextArgAction: "skip" | "extract" | null = null;
  let pastEndOfFlags = false;
  const tokens: string[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "command_name" || child.type === "variable_assignment") continue;

    if (!ARG_NODE_TYPES.has(child.type)) {
      tokens.push(...collectPathCandidateTokens(child));
      continue;
    }

    const text = resolveNodeText(child);

    if (nextArgAction === "skip") {
      nextArgAction = null;
      continue;
    }
    if (nextArgAction === "extract") {
      tokens.push(text);
      nextArgAction = null;
      continue;
    }

    if (!pastEndOfFlags && child.type === "word" && text.startsWith("-") && text.length > 1) {
      const directive = classifyPatternCommandFlag(text, config);
      switch (directive.kind) {
        case "end-of-flags":
          pastEndOfFlags = true;
          break;
        case "consume-arg":
          nextArgAction = directive.nextArgAction;
          if (directive.setsExplicitScript) hasExplicitScript = true;
          break;
        case "regular-flag":
          break;
      }
      continue;
    }

    if (!hasExplicitScript && positionalsSeen < patternPositionals) {
      positionalsSeen++;
      continue;
    }

    tokens.push(text);
  }

  return tokens;
}

function collectGenericCommandTokens(node: TSNode): string[] {
  const tokens: string[] = [];
  let seenCommandName = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "command_name") {
      seenCommandName = true;
      continue;
    }
    if (child.type === "variable_assignment") continue;

    if (!seenCommandName && ARG_NODE_TYPES.has(child.type)) {
      seenCommandName = true;
      continue;
    }

    if (ARG_NODE_TYPES.has(child.type)) {
      tokens.push(resolveNodeText(child));
      continue;
    }

    tokens.push(...collectPathCandidateTokens(child));
  }

  return tokens;
}
