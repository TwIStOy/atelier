import type { TSNode } from "./parser.ts";

export const SKIP_SUBTREE_TYPES = new Set(["heredoc_body", "heredoc_end", "comment"]);

export const ARG_NODE_TYPES = new Set(["word", "concatenation", "string", "raw_string"]);

export function resolveNodeText(node: TSNode): string {
  switch (node.type) {
    case "word":
      return node.text;
    case "raw_string": {
      const t = node.text;
      if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
        return t.slice(1, -1);
      }
      return t;
    }
    case "string": {
      let result = "";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        if (child.type === '"') continue;
        result += resolveNodeText(child);
      }
      return result;
    }
    case "string_content":
    case "simple_expansion":
    case "expansion":
      return node.text;
    case "concatenation": {
      let result = "";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        result += resolveNodeText(child);
      }
      return result;
    }
    default:
      return node.text;
  }
}
