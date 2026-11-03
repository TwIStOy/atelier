import type { Command, CommandExpansionPart, Node, Pipeline, Script, Statement, Word, WordPart } from "unbash";
import { parse } from "unbash";

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

function getCmdName(cmd: Command): string | null {
  return cmd.name?.text ?? null;
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
    if (p.type === "DoubleQuoted") {
      return p.parts?.some((pp) => partHas(pp as WordPart)) ?? false;
    }
    return false;
  }

  function expansionReadsProtected(w: Word): boolean {
    return w.parts?.some(expansionPartReads) ?? false;
  }

  function expansionPartReads(p: WordPart): boolean {
    switch (p.type) {
      case "DoubleQuoted":
        return p.parts?.some((pp) => expansionPartReads(pp as WordPart)) ?? false;
      case "CommandExpansion": {
        const ce = p as CommandExpansionPart;
        if (ce.script) return scriptReadsProtected(ce.script);
        return has(ce.text);
      }
      default:
        return false;
    }
  }

  function scriptReadsProtected(script: Script): boolean {
    return script.commands.some((s) => nodeReadsProtected(s));
  }

  function nodeReadsProtected(node: Node): boolean {
    switch (node.type) {
      case "Command":
        return cmdReadsProtected(node);
      case "Pipeline":
        return (node as Pipeline).commands.some((c) => nodeReadsProtected(c));
      case "AndOr":
        return ((node as unknown as { commands: Node[] }).commands ?? []).some((c) => nodeReadsProtected(c));
      case "Statement":
        return nodeReadsProtected((node as Statement).command);
      case "If": {
        const n = node as unknown as {
          clause: unknown;
          then: unknown;
          else: unknown;
        };
        return [n.clause, n.then, n.else].some((l) => l != null && listReadsProtected(l));
      }
      case "For":
      case "Select":
        return listReadsProtected((node as unknown as { body: unknown }).body);
      case "While": {
        const n = node as unknown as { clause: unknown; body: unknown };
        return [n.clause, n.body].some((l) => l != null && listReadsProtected(l));
      }
      case "Subshell":
      case "BraceGroup":
        return listReadsProtected((node as unknown as { body: unknown }).body);
      case "Function":
        return nodeReadsProtected((node as unknown as { body: Node }).body);
      case "CompoundList":
        return listReadsProtected(node);
      default:
        return false;
    }
  }

  function listReadsProtected(list: unknown): boolean {
    if (list == null) return false;
    const l = list as { type?: string; commands?: Statement[] };
    if (l.type === "CompoundList") {
      return l.commands?.some((s) => nodeReadsProtected(s)) ?? false;
    }
    return nodeReadsProtected(list as Node);
  }

  function cmdReadsProtected(cmd: Command): boolean {
    const name = getCmdName(cmd);

    if (name && FILE_READ_CMDS.has(name)) {
      if (cmd.suffix?.some((w) => wordHas(w))) return true;
      if (cmd.name && wordHas(cmd.name)) return true;
    }

    for (const w of cmd.suffix ?? []) {
      if (expansionReadsProtected(w)) return true;
    }

    return false;
  }

  function analyzeScript(script: Script, exposed: boolean): string | null {
    for (const stmt of script.commands) {
      const r = analyzeStmt(stmt, exposed);
      if (r) return r;
    }
    return null;
  }

  function analyzeStmt(stmt: Statement, exposed: boolean): string | null {
    const redirected = stmt.redirects?.some((r) => isStdoutRedirect(r.operator)) ?? false;
    return analyzeNode(stmt.command, redirected ? false : exposed);
  }

  function analyzeNode(node: Node, exposed: boolean): string | null {
    switch (node.type) {
      case "Command":
        return analyzeCmd(node, exposed);
      case "Pipeline":
        return analyzePipe(node, exposed);
      case "AndOr": {
        const cmds = (node as unknown as { commands: Node[] }).commands ?? [];
        for (const c of cmds) {
          const r = analyzeNode(c, exposed);
          if (r) return r;
        }
        return null;
      }
      case "Statement":
        return analyzeStmt(node, exposed);
      case "If": {
        const n = node as unknown as {
          clause: unknown;
          then: unknown;
          else: unknown;
        };
        for (const l of [n.clause, n.then, n.else]) {
          if (l) {
            const r = analyzeList(l, exposed);
            if (r) return r;
          }
        }
        return null;
      }
      case "For":
      case "Select":
        return analyzeList((node as unknown as { body: unknown }).body, exposed);
      case "While": {
        const n = node as unknown as { clause: unknown; body: unknown };
        for (const l of [n.clause, n.body]) {
          if (l) {
            const r = analyzeList(l, exposed);
            if (r) return r;
          }
        }
        return null;
      }
      case "Subshell":
      case "BraceGroup":
        return analyzeList((node as unknown as { body: unknown }).body, exposed);
      case "Function":
        return analyzeNode((node as unknown as { body: Node }).body, exposed);
      case "CompoundList":
        return analyzeList(node, exposed);
      default:
        return null;
    }
  }

  function analyzeList(list: unknown, exposed: boolean): string | null {
    if (list == null) return null;
    const l = list as { type?: string; commands?: Statement[] };
    if (l.type === "CompoundList") {
      for (const s of l.commands ?? []) {
        const r = analyzeStmt(s, exposed);
        if (r) return r;
      }
    }
    return null;
  }

  function analyzePipe(pipe: Pipeline, exposed: boolean): string | null {
    const anyReads = pipe.commands.some((c) => nodeReadsProtected(c));

    if (anyReads && exposed) {
      const last = pipe.commands[pipe.commands.length - 1];
      let lastRedirected = false;
      if (last.type === "Command") {
        lastRedirected = (last as Command).redirects?.some((r) => isStdoutRedirect(r.operator)) ?? false;
      } else if (last.type === "Statement") {
        lastRedirected = (last as Statement).redirects?.some((r) => isStdoutRedirect(r.operator)) ?? false;
      }
      if (!lastRedirected) {
        return "Pipeline reads from protected path and output reaches stdout";
      }
    }

    for (const c of pipe.commands) {
      const r = analyzeNodeExpansions(c);
      if (r) return r;
    }

    return null;
  }

  function analyzeCmd(cmd: Command, exposed: boolean): string | null {
    const name = getCmdName(cmd);

    const redirected = cmd.redirects?.some((r) => isStdoutRedirect(r.operator)) ?? false;
    const eff = redirected ? false : exposed;

    for (const prefix of cmd.prefix ?? []) {
      if (prefix.value) {
        const r = analyzeWordSubs(prefix.value, false);
        if (r) return r;
      }
    }

    if (name && SAFE_CMDS.has(name)) {
      return analyzeSuffixSubs(cmd, eff);
    }

    if (name && FILE_READ_CMDS.has(name)) {
      const argsRef = cmd.suffix?.some((w) => wordHas(w)) ?? false;
      const nameRef = cmd.name ? wordHas(cmd.name) : false;
      if ((argsRef || nameRef) && eff) {
        return `Command "${name}" would output content from protected path`;
      }
    }

    if (name && OUTPUT_CMDS.has(name)) {
      for (const w of cmd.suffix ?? []) {
        if (expansionReadsProtected(w) && eff) {
          return `Command "${name}" would output secret content`;
        }
        if (wordHas(w) && eff) {
          return `Command "${name}" references protected path in arguments`;
        }
      }
    }

    return analyzeSuffixSubs(cmd, eff);
  }

  function analyzeSuffixSubs(cmd: Command, exposed: boolean): string | null {
    for (const w of cmd.suffix ?? []) {
      const r = analyzeWordSubs(w, exposed);
      if (r) return r;
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
        for (const pp of p.parts ?? []) {
          const r = analyzePartSubs(pp as WordPart);
          if (r) return r;
        }
        return null;
      case "CommandExpansion": {
        const ce = p as CommandExpansionPart;
        if (ce.script) {
          const r = analyzeScript(ce.script, false);
          if (r) return r;
        }
        return null;
      }
      default:
        return null;
    }
  }

  function analyzeNodeExpansions(node: Node): string | null {
    switch (node.type) {
      case "Command":
        return analyzeCmdExpansions(node);
      case "Statement":
        return analyzeNodeExpansions((node as Statement).command);
      case "Pipeline":
        for (const c of (node as Pipeline).commands) {
          const r = analyzeNodeExpansions(c);
          if (r) return r;
        }
        return null;
      default:
        return null;
    }
  }

  function analyzeCmdExpansions(cmd: Command): string | null {
    for (const prefix of cmd.prefix ?? []) {
      if (prefix.value) {
        const r = analyzeWordSubs(prefix.value, false);
        if (r) return r;
      }
    }
    for (const w of cmd.suffix ?? []) {
      const r = analyzeWordSubs(w, false);
      if (r) return r;
    }
    return null;
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
