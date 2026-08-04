import * as acorn from "acorn";

export type WorkflowMeta = {
  name: string;
  description: string;
};

export type ParsedWorkflowScript = {
  meta: WorkflowMeta;
  body: string;
};

export type ParseWorkflowResult = { ok: true; script: ParsedWorkflowScript } | { ok: false; error: string };

const BANNED_IDENTIFIERS = new Set([
  "require",
  "process",
  "globalThis",
  "global",
  "eval",
  "Function",
  "WebAssembly",
  "module",
  "exports",
  "__dirname",
  "__filename",
]);

type AstNode = {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
};

function walk(node: AstNode, parent: AstNode | null, cb: (node: AstNode, parent: AstNode | null) => void): void {
  cb(node, parent);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "range" || key === "loc") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === "object" && typeof (child as AstNode).type === "string") {
          walk(child as AstNode, node, cb);
        }
      }
    } else if (value && typeof value === "object" && typeof (value as AstNode).type === "string") {
      walk(value as AstNode, node, cb);
    }
  }
}

function isIdentifierReference(node: AstNode, parent: AstNode | null): boolean {
  if (!parent) return true;
  if (parent.type === "MemberExpression" && parent.property === node && parent.computed === false) return false;
  if (
    (parent.type === "Property" || parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") &&
    parent.key === node &&
    parent.computed === false &&
    parent.value !== node
  ) {
    return false;
  }
  if (parent.type === "LabeledStatement" && parent.label === node) return false;
  if ((parent.type === "BreakStatement" || parent.type === "ContinueStatement") && parent.label === node) return false;
  return true;
}

export function normalizeWorkflowScript(raw: string): string {
  let src = raw.trim();
  const fence = /^```(?:js|javascript|ts|typescript)?\s*\n/.exec(src);
  if (fence) {
    src = src.slice(fence[0].length);
    const closing = /\n```\s*$/.exec(src);
    if (closing) src = src.slice(0, closing.index);
  }
  return src.trim();
}

function evalLiteral(node: AstNode, path: string): unknown {
  switch (node.type) {
    case "Literal":
      return (node as unknown as { value: unknown }).value;
    case "TemplateLiteral": {
      if ((node.expressions as unknown[]).length > 0) {
        throw new Error(`${path}: template literals with interpolations are not allowed in meta`);
      }
      const quasis = node.quasis as Array<{ value: { cooked: string | null } }>;
      return quasis.map((q) => q.value.cooked ?? "").join("");
    }
    case "UnaryExpression": {
      const operator = node.operator as string;
      const argument = node.argument as AstNode;
      if ((operator === "-" || operator === "+") && argument.type === "Literal") {
        const v = (argument as unknown as { value: unknown }).value;
        if (typeof v === "number") return operator === "-" ? -v : v;
      }
      throw new Error(`${path}: only numeric -/+ unary values are allowed in meta`);
    }
    case "ArrayExpression": {
      const elements = node.elements as Array<AstNode | null>;
      return elements.map((el, i) => {
        if (el === null) throw new Error(`${path}[${i}]: holes are not allowed in meta`);
        if (el.type === "SpreadElement") throw new Error(`${path}[${i}]: spread is not allowed in meta`);
        return evalLiteral(el, `${path}[${i}]`);
      });
    }
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      const properties = node.properties as AstNode[];
      for (const prop of properties) {
        if (prop.type === "SpreadElement") throw new Error(`${path}: spread is not allowed in meta`);
        if (prop.computed === true) throw new Error(`${path}: computed keys are not allowed in meta`);
        if (prop.method === true) throw new Error(`${path}: methods are not allowed in meta`);
        const keyNode = prop.key as AstNode;
        const key =
          keyNode.type === "Identifier"
            ? (keyNode.name as string)
            : keyNode.type === "Literal"
              ? String((keyNode as unknown as { value: unknown }).value)
              : null;
        if (key === null) throw new Error(`${path}: unsupported key in meta`);
        if (key === "__proto__") throw new Error(`${path}: __proto__ keys are not allowed in meta`);
        out[key] = evalLiteral(prop.value as AstNode, `${path}.${key}`);
      }
      return out;
    }
    default:
      throw new Error(`${path}: only literal values are allowed in meta (found ${node.type})`);
  }
}

function extractMeta(statement: AstNode): WorkflowMeta {
  const declaration = statement.declaration as AstNode | undefined;
  if (declaration?.type !== "VariableDeclaration" || declaration?.kind !== "const") {
    throw new Error("meta export must be `export const meta = { ... }`");
  }
  const declarations = declaration.declarations as AstNode[];
  if (declarations.length !== 1) {
    throw new Error("meta export must declare exactly one variable");
  }
  const declarator = declarations[0] as AstNode;
  const id = declarator.id as AstNode;
  if (id.type !== "Identifier" || id.name !== "meta") {
    throw new Error("the exported const must be named `meta`");
  }
  const init = declarator.init as AstNode | undefined;
  if (init?.type !== "ObjectExpression") {
    throw new Error("meta must be an object literal");
  }
  const value = evalLiteral(init, "meta") as Record<string, unknown>;
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error("meta.name must be a non-empty string literal");
  }
  if (typeof value.description !== "string" || !value.description.trim()) {
    throw new Error("meta.description must be a non-empty string literal");
  }
  return { name: value.name.trim(), description: value.description.trim() };
}

function checkBannedReferences(ast: AstNode): string | null {
  let found: string | null = null;
  walk(ast, null, (node, parent) => {
    if (found) return;
    if (node.type === "ImportExpression") {
      found = "dynamic import() is not allowed in workflow scripts";
      return;
    }
    if (
      node.type === "Identifier" &&
      BANNED_IDENTIFIERS.has(node.name as string) &&
      isIdentifierReference(node, parent)
    ) {
      found = `\`${String(node.name)}\` is not available in workflow scripts`;
    }
  });
  return found;
}

export function parseWorkflowScript(raw: string): ParseWorkflowResult {
  const src = normalizeWorkflowScript(raw);
  if (!src) {
    return { ok: false, error: "workflow script is empty" };
  }

  let ast: AstNode;
  try {
    ast = acorn.parse(src, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
    }) as unknown as AstNode;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `workflow script does not parse: ${msg}` };
  }

  const body = ast.body as AstNode[];
  if (body.length === 0) {
    return { ok: false, error: "workflow script is empty" };
  }

  const first = body[0] as AstNode;
  if (first.type !== "ExportNamedDeclaration") {
    return {
      ok: false,
      error: "the first statement must be `export const meta = { name, description }`",
    };
  }

  for (let i = 1; i < body.length; i++) {
    const stmt = body[i] as AstNode;
    if (stmt.type === "ImportDeclaration" || stmt.type === "ImportExpression") {
      return { ok: false, error: "import is not allowed in workflow scripts" };
    }
    if (stmt.type.startsWith("Export")) {
      return { ok: false, error: "only the single `export const meta` statement may be exported" };
    }
  }

  let meta: WorkflowMeta;
  try {
    meta = extractMeta(first);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const banned = checkBannedReferences(ast);
  if (banned) {
    return { ok: false, error: banned };
  }

  const declaration = first.declaration as AstNode;
  const executable = src.slice(0, first.start) + src.slice(declaration.start, declaration.end) + src.slice(first.end);

  return { ok: true, script: { meta, body: executable } };
}
