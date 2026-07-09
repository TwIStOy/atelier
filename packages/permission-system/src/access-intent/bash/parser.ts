import { createRequire } from "node:module";
import { memoizeAsyncWithRetry } from "../../async-cache.ts";

export interface TSNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly childCount: number;
  readonly isNamed: boolean;
  child(index: number): TSNode | null;
}

export interface TSTree {
  readonly rootNode: TSNode;
  delete(): void;
}

interface TSParser {
  parse(input: string): TSTree | null;
  delete(): void;
}

async function initParser(): Promise<TSParser> {
  const { Parser, Language } = await import("web-tree-sitter");
  const req = createRequire(import.meta.url);
  const treeSitterWasm = req.resolve("web-tree-sitter/web-tree-sitter.wasm");
  await Parser.init({ locateFile: () => treeSitterWasm });

  const parser = new Parser();
  const bashWasm = req.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
  const bash = await Language.load(bashWasm);
  parser.setLanguage(bash);
  return parser;
}

export const getParser = memoizeAsyncWithRetry(initParser);
