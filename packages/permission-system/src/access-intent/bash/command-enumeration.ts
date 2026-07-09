import type { BashCommand, BashCommandContext } from "../../types.ts";
import type { TSNode } from "./parser.ts";

export type { BashCommand };

const COMMAND_ENUM_DESCEND = new Set(["program", "list", "pipeline", "redirected_statement"]);

const COMMAND_ENUM_SKIP = new Set([
  "file_redirect",
  "heredoc_redirect",
  "herestring_redirect",
  "comment",
  "heredoc_body",
  "heredoc_end",
]);

const NESTED_EXECUTION_CONTEXTS = new Map<string, BashCommandContext>([
  ["command_substitution", "command_substitution"],
  ["process_substitution", "process_substitution"],
]);

export function collectCommands(node: TSNode): BashCommand[] {
  const out: BashCommand[] = [];
  collectCommandsInto(node, undefined, out);
  return out;
}

function collectCommandsInto(node: TSNode, context: BashCommandContext | undefined, out: BashCommand[]): void {
  if (!node.isNamed) return;
  if (COMMAND_ENUM_SKIP.has(node.type)) return;

  if (node.type === "command") {
    out.push(makeUnit(commandUnitText(node), context, isOpaqueWrapperCommand(node)));
    collectSubstitutionCommands(node, out);
    return;
  }

  if (node.type === "subshell") {
    out.push(makeUnit(node.text, context));
    descendCommandChildren(node, "subshell", out);
    return;
  }

  if (COMMAND_ENUM_DESCEND.has(node.type)) {
    descendCommandChildren(node, context, out);
    return;
  }

  out.push(makeUnit(node.text, context));
}

function makeUnit(text: string, context: BashCommandContext | undefined, opaque = false): BashCommand {
  const unit: BashCommand = context ? { text, context } : { text };
  return opaque ? { ...unit, opaque } : unit;
}

const SHELL_WRAPPER_NAMES = new Set(["bash", "sh", "dash", "zsh", "ksh"]);

function isOpaqueWrapperCommand(node: TSNode): boolean {
  let commandName: string | undefined;
  let sawShortFlagC = false;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child?.isNamed) continue;
    if (child.type === "variable_assignment") continue;
    if (commandName === undefined) {
      commandName = basename(child.text);
      continue;
    }
    const text = child.text;
    if (text === "--") break;
    if (text.startsWith("-") && !text.startsWith("--") && text.includes("c")) {
      sawShortFlagC = true;
    }
  }
  if (commandName === undefined) return false;
  if (commandName === "eval") return true;
  return SHELL_WRAPPER_NAMES.has(commandName) && sawShortFlagC;
}

function basename(name: string): string {
  const slash = name.lastIndexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

function commandUnitText(node: TSNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child?.isNamed && child.type !== "variable_assignment") {
      return node.text.slice(child.startIndex - node.startIndex);
    }
  }
  return node.text;
}

function descendCommandChildren(node: TSNode, context: BashCommandContext | undefined, out: BashCommand[]): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) collectCommandsInto(child, context, out);
  }
}

function collectSubstitutionCommands(node: TSNode, out: BashCommand[]): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    const nestedContext = NESTED_EXECUTION_CONTEXTS.get(child.type);
    if (nestedContext) {
      descendCommandChildren(child, nestedContext, out);
    } else {
      collectSubstitutionCommands(child, out);
    }
  }
}
