import type {
  AssignmentPrefix,
  Command,
  CommandArgument,
  CommandExpansionPart,
  DoubleQuotedPart,
  Pipeline,
  Redirect,
  Redirection,
  Script,
  Statement,
  Word,
  WordPart,
} from "unbash";
import { parse } from "unbash";

type NodeLike = {
  type?: string;
  commands?: readonly unknown[];
  body?: unknown;
  clause?: unknown;
  then?: unknown;
  else?: unknown;
  command?: unknown;
  redirects?: readonly Redirection[];
};

export const DEFAULT_PROTECTED_PATHS: readonly string[] = ["/run/agenix"];

const FILE_READ_CMDS = new Set([
  "cat",
  "head",
  "tail",
  "tac",
  "rev",
  "nl",
  "less",
  "more",
  "bat",
  "pager",
  "sort",
  "uniq",
  "base64",
  "base32",
  "xxd",
  "hexdump",
  "od",
  "strings",
  "cut",
  "paste",
  "diff",
  "comm",
  "tee",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "sed",
  "awk",
  "gawk",
  "sh",
  "bash",
  "zsh",
  "dash",
  "source",
  ".",
]);

const OUTPUT_CMDS = new Set(["echo", "printf", "yes"]);

const SAFE_CMDS = new Set([
  "ls",
  "stat",
  "file",
  "test",
  "[",
  "[[",
  "md5sum",
  "sha1sum",
  "sha256sum",
  "sha512sum",
  "cksum",
  "b3sum",
  "chmod",
  "chown",
  "chgrp",
  "rm",
  "cp",
  "mv",
  "ln",
  "install",
  "mkdir",
  "rmdir",
  "touch",
  "find",
  "which",
  "type",
  "command",
  "env",
  "wc",
  "tr",
]);

function isStdoutRedirect(op: string): boolean {
  return [">", ">>", "&>", "&>>", ">|"].includes(op);
}

function redirectsToStdout(redirects: readonly Redirection[] | undefined): boolean {
  return redirects?.some((r) => r.type === "Redirect" && isStdoutRedirect(r.operator)) ?? false;
}

function getCmdName(cmd: Command): string | null {
  return cmd.name?.text ?? null;
}

function isFileReadCmd(name: string | null): boolean {
  return name !== null && FILE_READ_CMDS.has(name);
}

function isOutputCmd(name: string | null): boolean {
  return name !== null && OUTPUT_CMDS.has(name);
}

function isSafeCmd(name: string | null): boolean {
  return name !== null && SAFE_CMDS.has(name);
}

type BashChecker = (command: string) => string | null;

function createBashChecker(protectedPaths: readonly string[]): BashChecker {
  const has = (text: string): boolean => protectedPaths.some((p) => p !== "" && text.includes(p));

  function wordHas(w: Word): boolean {
    if (has(w.text)) return true;
    return w.parts?.some(partHas) ?? false;
  }

  function partHas(p: WordPart): boolean {
    if (has(p.text)) return true;
    if (p.type !== "DoubleQuoted") return false;
    return doubleQuotedHas(p);
  }

  function doubleQuotedHas(p: DoubleQuotedPart): boolean {
    return p.parts?.some((pp) => partHas(pp as WordPart)) ?? false;
  }

  function expansionReadsProtected(w: Word): boolean {
    return w.parts?.some(expansionPartReads) ?? false;
  }

  function expansionPartReads(p: WordPart): boolean {
    switch (p.type) {
      case "DoubleQuoted":
        return expansionDoubleQuotedReads(p);
      case "CommandExpansion":
        return commandExpansionReads(p as CommandExpansionPart);
      default:
        return false;
    }
  }

  function expansionDoubleQuotedReads(p: DoubleQuotedPart): boolean {
    return p.parts?.some((pp) => expansionPartReads(pp as WordPart)) ?? false;
  }

  function commandExpansionReads(ce: CommandExpansionPart): boolean {
    if (ce.script) return scriptReadsProtected(ce.script);
    return has(ce.text);
  }

  function scriptReadsProtected(script: Script): boolean {
    return script.commands.some((s) => nodeReadsProtected(s));
  }

  function nodeReadsProtected(node: unknown): boolean {
    if (node == null || typeof node !== "object") return false;
    const n = node as NodeLike;
    switch (n.type) {
      case "Command":
        return cmdReadsProtected(node as Command);
      case "Pipeline":
        return pipelineReadsProtected(node as Pipeline);
      case "AndOr":
        return andOrReadsProtected(n);
      default:
        return controlFlowReadsProtected(n);
    }
  }

  function pipelineReadsProtected(pipe: Pipeline): boolean {
    return pipe.commands.some((c) => nodeReadsProtected(c));
  }

  function andOrReadsProtected(node: NodeLike): boolean {
    return (node.commands ?? []).some((c) => nodeReadsProtected(c as never));
  }

  function controlFlowReadsProtected(node: NodeLike): boolean {
    switch (node.type) {
      case "Statement":
        return nodeReadsProtected((node as Statement).command);
      case "If":
        return ifReadsProtected(node);
      default:
        return loopReadsProtected(node);
    }
  }

  function ifReadsProtected(node: NodeLike): boolean {
    return [node.clause, node.then, node.else].some((l) => l != null && listReadsProtected(l));
  }

  function loopReadsProtected(node: NodeLike): boolean {
    switch (node.type) {
      case "For":
      case "Select":
        return listReadsProtected(node.body);
      case "While":
        return whileReadsProtected(node);
      default:
        return scopeReadsProtected(node);
    }
  }

  function whileReadsProtected(node: NodeLike): boolean {
    return [node.clause, node.body].some((l) => l != null && listReadsProtected(l));
  }

  function scopeReadsProtected(node: NodeLike): boolean {
    switch (node.type) {
      case "Subshell":
      case "BraceGroup":
        return listReadsProtected(node.body);
      case "Function":
        return nodeReadsProtected((node as { body: unknown }).body as never);
      default:
        return compoundListReadsProtected(node);
    }
  }

  function compoundListReadsProtected(node: NodeLike): boolean {
    if (node.type === "CompoundList") {
      return listReadsProtected(node);
    }
    return false;
  }

  function stmtListReadsProtected(stmts: readonly Statement[] | undefined): boolean {
    return stmts?.some((s) => nodeReadsProtected(s)) ?? false;
  }

  function listReadsProtected(list: unknown): boolean {
    if (list == null) return false;
    const l = list as { type?: string; commands?: readonly Statement[] };
    if (l.type !== "CompoundList") return nodeReadsProtected(list as unknown);
    return stmtListReadsProtected(l.commands);
  }

  function fileCmdMentionsProtected(cmd: Command): boolean {
    if (cmd.suffix?.some((w) => isWordNode(w) && wordHas(w))) return true;
    return cmd.name !== undefined && wordHas(cmd.name);
  }

  function cmdSuffixReadsProtected(cmd: Command): boolean {
    for (const w of cmd.suffix ?? []) {
      if (isWordNode(w) && expansionReadsProtected(w)) return true;
    }
    return false;
  }

  function isWordNode(value: CommandArgument | Redirection): value is Word {
    return value.type === "Word";
  }

  function isAssignmentNode(value: CommandArgument | Redirection): value is AssignmentPrefix {
    return value.type === "Assignment";
  }

  function cmdReadsProtected(cmd: Command): boolean {
    if (isFileReadCmd(getCmdName(cmd))) {
      if (fileCmdMentionsProtected(cmd)) return true;
    }
    return cmdSuffixReadsProtected(cmd);
  }

  function analyzeScript(script: Script, exposed: boolean): string | null {
    for (const stmt of script.commands) {
      const r = analyzeStmt(stmt, exposed);
      if (r) return r;
    }
    return null;
  }

  function analyzeStmt(stmt: Statement, exposed: boolean): string | null {
    const command = stmt.command;
    const redirected =
      command && typeof command === "object" && "redirects" in command && command.redirects
        ? redirectsToStdout(command.redirects as readonly Redirect[])
        : false;
    return analyzeNode(command, redirected ? false : exposed);
  }

  function analyzeNode(node: unknown, exposed: boolean): string | null {
    if (node == null || typeof node !== "object") return null;
    const n = node as NodeLike;
    switch (n.type) {
      case "Command":
        return analyzeCmd(node as Command, exposed);
      case "Pipeline":
        return analyzePipe(node as Pipeline, exposed);
      case "AndOr":
        return analyzeAndOr(n, exposed);
      default:
        return analyzeControlFlowNode(n, exposed);
    }
  }

  function analyzeAndOr(node: NodeLike, exposed: boolean): string | null {
    const cmds = node.commands ?? [];
    for (const c of cmds) {
      const r = analyzeNode(c, exposed);
      if (r) return r;
    }
    return null;
  }

  function analyzeControlFlowNode(node: NodeLike, exposed: boolean): string | null {
    switch (node.type) {
      case "Statement":
        return analyzeStmt(node as Statement, exposed);
      case "If":
        return analyzeIf(node, exposed);
      default:
        return analyzeLoopNode(node, exposed);
    }
  }

  function analyzeIf(node: NodeLike, exposed: boolean): string | null {
    for (const l of [node.clause, node.then, node.else]) {
      if (l) {
        const r = analyzeList(l, exposed);
        if (r) return r;
      }
    }
    return null;
  }

  function analyzeLoopNode(node: NodeLike, exposed: boolean): string | null {
    switch (node.type) {
      case "For":
      case "Select":
        return analyzeList(node.body, exposed);
      case "While":
        return analyzeWhile(node, exposed);
      default:
        return analyzeScopeNode(node, exposed);
    }
  }

  function analyzeWhile(node: NodeLike, exposed: boolean): string | null {
    for (const l of [node.clause, node.body]) {
      if (l) {
        const r = analyzeList(l, exposed);
        if (r) return r;
      }
    }
    return null;
  }

  function analyzeScopeNode(node: NodeLike, exposed: boolean): string | null {
    switch (node.type) {
      case "Subshell":
      case "BraceGroup":
        return analyzeList(node.body, exposed);
      case "Function":
        return analyzeNode((node as { body: unknown }).body, exposed);
      default:
        return analyzeCompoundListNode(node, exposed);
    }
  }

  function analyzeCompoundListNode(node: NodeLike, exposed: boolean): string | null {
    if (node.type === "CompoundList") {
      return analyzeList(node, exposed);
    }
    return null;
  }

  function analyzeStmtList(stmts: readonly Statement[] | undefined, exposed: boolean): string | null {
    for (const s of stmts ?? []) {
      const r = analyzeStmt(s, exposed);
      if (r) return r;
    }
    return null;
  }

  function analyzeList(list: unknown, exposed: boolean): string | null {
    if (list == null) return null;
    const l = list as { type?: string; commands?: Statement[] };
    if (l.type !== "CompoundList") return null;
    return analyzeStmtList(l.commands, exposed);
  }

  function analyzePipe(pipe: Pipeline, exposed: boolean): string | null {
    const anyReads = pipe.commands.some((c) => nodeReadsProtected(c));

    if (anyReads && exposed) {
      if (!pipeLastRedirected(pipe)) {
        return "Pipeline reads from protected path and output reaches stdout";
      }
    }

    return analyzePipeExpansions(pipe);
  }

  function pipeLastRedirected(pipe: Pipeline): boolean {
    const last = pipe.commands[pipe.commands.length - 1];
    if (last.type === "Command") {
      return redirectsToStdout((last as Command).redirects);
    }
    return false;
  }

  function analyzePipeExpansions(pipe: Pipeline): string | null {
    for (const c of pipe.commands) {
      const r = analyzeNodeExpansions(c);
      if (r) return r;
    }
    return null;
  }

  function analyzeCmd(cmd: Command, exposed: boolean): string | null {
    const redirected = redirectsToStdout(cmd.redirects);
    const eff = redirected ? false : exposed;
    return analyzeCmdBody(cmd, eff);
  }

  function analyzeCmdBody(cmd: Command, eff: boolean): string | null {
    const r = analyzePrefixSubs(cmd);
    if (r) return r;
    return analyzeCmdTail(cmd, getCmdName(cmd), eff);
  }

  function analyzeCmdTail(cmd: Command, name: string | null, eff: boolean): string | null {
    if (isSafeCmd(name)) {
      return analyzeSuffixSubs(cmd, eff);
    }
    const finding = analyzeCmdFindings(cmd, name, eff);
    if (finding) return finding;
    return analyzeSuffixSubs(cmd, eff);
  }

  function analyzeCmdFindings(cmd: Command, name: string | null, eff: boolean): string | null {
    const fileFinding = fileCmdFinding(cmd, name, eff);
    if (fileFinding) return fileFinding;
    return outputCmdFinding(cmd, name, eff);
  }

  function fileCmdFinding(cmd: Command, name: string | null, eff: boolean): string | null {
    if (!isFileReadCmd(name)) return null;
    if (fileCmdMentionsProtected(cmd) && eff) {
      return `Command "${name}" would output content from protected path`;
    }
    return null;
  }

  function outputCmdFinding(cmd: Command, name: string | null, eff: boolean): string | null {
    if (!isOutputCmd(name)) return null;
    return outputSuffixFinding(cmd, name, eff);
  }

  function outputSuffixFinding(cmd: Command, name: string | null, eff: boolean): string | null {
    for (const w of cmd.suffix ?? []) {
      if (isWordNode(w)) {
        const r = outputWordFinding(w, name, eff);
        if (r) return r;
      }
    }
    return null;
  }

  function outputWordFinding(w: Word, name: string | null, eff: boolean): string | null {
    if (!eff) return null;
    if (expansionReadsProtected(w)) {
      return `Command "${name}" would output secret content`;
    }
    if (wordHas(w)) {
      return `Command "${name}" references protected path in arguments`;
    }
    return null;
  }

  function analyzePrefixSubs(cmd: Command): string | null {
    for (const prefix of cmd.prefix ?? []) {
      if (isAssignmentNode(prefix)) {
        const r = analyzeAssignmentSubs(prefix);
        if (r) return r;
      }
    }
    return null;
  }

  function analyzeAssignmentSubs(prefix: AssignmentPrefix): string | null {
    if (!prefix.value) return null;
    if (prefix.value.type === "ArrayValue") {
      return prefix.value.elements.some((element) => isWordNode(element) && analyzeWordSubs(element, false) !== null)
        ? "Assignment references protected path"
        : null;
    }
    return isWordNode(prefix.value) ? analyzeWordSubs(prefix.value, false) : null;
  }

  function analyzeSuffixSubs(cmd: Command, exposed: boolean): string | null {
    for (const w of cmd.suffix ?? []) {
      if (isWordNode(w)) {
        const r = analyzeWordSubs(w, exposed);
        if (r) return r;
      }
    }
    return null;
  }

  function analyzeWordSubs(w: Word, _exposed: boolean): string | null {
    for (const p of w.parts ?? []) {
      const r = analyzePartSubs(p);
      if (r) return r;
    }
    return null;
  }

  function analyzePartSubs(p: WordPart): string | null {
    switch (p.type) {
      case "DoubleQuoted":
        return analyzeDoubleQuotedSubs(p);
      case "CommandExpansion":
        return analyzeCommandExpansionSubs(p as CommandExpansionPart);
      default:
        return null;
    }
  }

  function analyzeDoubleQuotedSubs(p: DoubleQuotedPart): string | null {
    for (const pp of p.parts ?? []) {
      const r = analyzePartSubs(pp as WordPart);
      if (r) return r;
    }
    return null;
  }

  function analyzeCommandExpansionSubs(ce: CommandExpansionPart): string | null {
    if (ce.script) {
      return analyzeScript(ce.script, false);
    }
    return null;
  }

  function analyzeNodeExpansions(node: unknown): string | null {
    if (node == null || typeof node !== "object") return null;
    const n = node as NodeLike;
    switch (n.type) {
      case "Command":
        return analyzeCmdExpansions(node as Command);
      case "Statement":
        return analyzeNodeExpansions((node as Statement).command);
      case "Pipeline":
        return analyzePipelineExpansions(node as Pipeline);
      default:
        return null;
    }
  }

  function analyzePipelineExpansions(pipe: Pipeline): string | null {
    for (const c of pipe.commands) {
      const r = analyzeNodeExpansions(c);
      if (r) return r;
    }
    return null;
  }

  function analyzeCmdExpansions(cmd: Command): string | null {
    const r = analyzePrefixSubs(cmd);
    if (r) return r;
    return analyzeSuffixSubs(cmd, false);
  }

  return (command: string): string | null => {
    let script: Script;
    try {
      script = parse(command);
    } catch {
      if (has(command)) {
        return "Command references protected path but could not be parsed for analysis";
      }
      return null;
    }

    return analyzeScript(script, true);
  };
}

export function checkBashCommand(
  command: string,
  protectedPaths: readonly string[] = DEFAULT_PROTECTED_PATHS,
): string | null {
  return createBashChecker(protectedPaths)(command);
}
