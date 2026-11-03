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

const WALK_SKIP_KEYS = new Set(["type", "start", "end", "range", "loc"]);

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";
}

function walkValue(value: unknown, parent: AstNode, cb: (node: AstNode, parent: AstNode | null) => void): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      if (isAstNode(child)) walk(child, parent, cb);
    }
    return;
  }
  if (isAstNode(value)) walk(value, parent, cb);
}

function walk(node: AstNode, parent: AstNode | null, cb: (node: AstNode, parent: AstNode | null) => void): void {
  cb(node, parent);
  for (const key of Object.keys(node)) {
    if (WALK_SKIP_KEYS.has(key)) continue;
    walkValue(node[key], node, cb);
  }
}

function isMemberPropertyAccess(node: AstNode, parent: AstNode): boolean {
  return parent.type === "MemberExpression" && parent.property === node && parent.computed === false;
}

function isKeyHolderType(type: string): boolean {
  return type === "Property" || type === "MethodDefinition" || type === "PropertyDefinition";
}

function isNonComputedKey(node: AstNode, parent: AstNode): boolean {
  if (!isKeyHolderType(parent.type)) return false;
  return parent.key === node && parent.computed === false && parent.value !== node;
}

function isJumpLabel(node: AstNode, parent: AstNode): boolean {
  const isJump = parent.type === "BreakStatement" || parent.type === "ContinueStatement";
  return isJump && parent.label === node;
}

function isLabelUse(node: AstNode, parent: AstNode): boolean {
  if (parent.type === "LabeledStatement" && parent.label === node) return true;
  return isJumpLabel(node, parent);
}

function isIdentifierReference(node: AstNode, parent: AstNode | null): boolean {
  if (!parent) return true;
  return !isMemberPropertyAccess(node, parent) && !isNonComputedKey(node, parent) && !isLabelUse(node, parent);
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

function evalTemplateLiteral(node: AstNode, path: string): unknown {
  if ((node.expressions as unknown[]).length > 0) {
    throw new Error(`${path}: template literals with interpolations are not allowed in meta`);
  }
  const quasis = node.quasis as Array<{ value: { cooked: string | null } }>;
  return quasis.map((q) => q.value.cooked ?? "").join("");
}

function evalSignedNumber(operator: string, argument: AstNode, path: string): unknown {
  const v = (argument as unknown as { value: unknown }).value;
  if (typeof v === "number") return operator === "-" ? -v : v;
  throw new Error(`${path}: only numeric -/+ unary values are allowed in meta`);
}

function evalUnaryExpression(node: AstNode, path: string): unknown {
  const operator = node.operator as string;
  const argument = node.argument as AstNode;
  if ((operator === "-" || operator === "+") && argument.type === "Literal") {
    return evalSignedNumber(operator, argument, path);
  }
  throw new Error(`${path}: only numeric -/+ unary values are allowed in meta`);
}

function evalArrayElement(el: AstNode | null, path: string): unknown {
  if (el === null) throw new Error(`${path}: holes are not allowed in meta`);
  if (el.type === "SpreadElement") throw new Error(`${path}: spread is not allowed in meta`);
  return evalLiteral(el, path);
}

function evalArrayExpression(node: AstNode, path: string): unknown {
  const elements = node.elements as Array<AstNode | null>;
  return elements.map((el, i) => evalArrayElement(el, `${path}[${i}]`));
}

function assertPlainProperty(prop: AstNode, path: string): void {
  if (prop.type === "SpreadElement") throw new Error(`${path}: spread is not allowed in meta`);
  if (prop.computed === true) throw new Error(`${path}: computed keys are not allowed in meta`);
  if (prop.method === true) throw new Error(`${path}: methods are not allowed in meta`);
}

function rawObjectKey(keyNode: AstNode): string | null {
  if (keyNode.type === "Identifier") return keyNode.name as string;
  if (keyNode.type === "Literal") return String((keyNode as unknown as { value: unknown }).value);
  return null;
}

function evalObjectKey(prop: AstNode, path: string): string {
  assertPlainProperty(prop, path);
  const key = rawObjectKey(prop.key as AstNode);
  if (key === null) throw new Error(`${path}: unsupported key in meta`);
  if (key === "__proto__") throw new Error(`${path}: __proto__ keys are not allowed in meta`);
  return key;
}

function evalObjectExpression(node: AstNode, path: string): unknown {
  const out: Record<string, unknown> = {};
  const properties = node.properties as AstNode[];
  for (const prop of properties) {
    const key = evalObjectKey(prop, path);
    out[key] = evalLiteral(prop.value as AstNode, `${path}.${key}`);
  }
  return out;
}

type LiteralEvaluator = (node: AstNode, path: string) => unknown;

const LITERAL_EVALUATORS: Record<string, LiteralEvaluator> = {
  Literal: (node) => (node as unknown as { value: unknown }).value,
  TemplateLiteral: evalTemplateLiteral,
  UnaryExpression: evalUnaryExpression,
  ArrayExpression: evalArrayExpression,
  ObjectExpression: evalObjectExpression,
};

function evalLiteral(node: AstNode, path: string): unknown {
  const evaluator = LITERAL_EVALUATORS[node.type];
  if (!evaluator) {
    throw new Error(`${path}: only literal values are allowed in meta (found ${node.type})`);
  }
  return evaluator(node, path);
}

function metaDeclaration(statement: AstNode): AstNode {
  const declaration = statement.declaration as AstNode | undefined;
  const valid = declaration !== undefined && declaration.type === "VariableDeclaration" && declaration.kind === "const";
  if (!valid) {
    throw new Error("meta export must be `export const meta = { ... }`");
  }
  return declaration;
}

function soleDeclarator(declaration: AstNode): AstNode {
  const declarations = declaration.declarations as AstNode[];
  if (declarations.length !== 1) {
    throw new Error("meta export must declare exactly one variable");
  }
  return declarations[0] as AstNode;
}

function assertMetaName(declarator: AstNode): void {
  const id = declarator.id as AstNode;
  if (id.type !== "Identifier" || id.name !== "meta") {
    throw new Error("the exported const must be named `meta`");
  }
}

function metaInit(declarator: AstNode): AstNode {
  assertMetaName(declarator);
  const init = declarator.init as AstNode | undefined;
  if (init === undefined || init.type !== "ObjectExpression") {
    throw new Error("meta must be an object literal");
  }
  return init;
}

function requireMetaString(value: Record<string, unknown>, key: "name" | "description"): string {
  const raw = value[key];
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`meta.${key} must be a non-empty string literal`);
  }
  return raw.trim();
}

function extractMeta(statement: AstNode): WorkflowMeta {
  const init = metaInit(soleDeclarator(metaDeclaration(statement)));
  const value = evalLiteral(init, "meta") as Record<string, unknown>;
  return { name: requireMetaString(value, "name"), description: requireMetaString(value, "description") };
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

function parseAst(src: string): { ok: true; ast: AstNode } | { ok: false; error: string } {
  try {
    const ast = acorn.parse(src, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
    }) as unknown as AstNode;
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: `workflow script does not parse: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function checkStatement(stmt: AstNode): string | null {
  if (stmt.type === "ImportDeclaration" || stmt.type === "ImportExpression") {
    return "import is not allowed in workflow scripts";
  }
  if (stmt.type.startsWith("Export")) {
    return "only the single `export const meta` statement may be exported";
  }
  return null;
}

function checkStatementShapes(first: AstNode, body: AstNode[]): string | null {
  if (first.type !== "ExportNamedDeclaration") {
    return "the first statement must be `export const meta = { name, description }`";
  }
  for (let i = 1; i < body.length; i++) {
    const error = checkStatement(body[i] as AstNode);
    if (error) return error;
  }
  return null;
}

function tryExtractMeta(first: AstNode): { ok: true; meta: WorkflowMeta } | { ok: false; error: string } {
  try {
    return { ok: true, meta: extractMeta(first) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

type PreparedScript = { ok: true; src: string; ast: AstNode; first: AstNode } | { ok: false; error: string };

function normalizedSource(raw: string): { ok: true; src: string } | { ok: false; error: string } {
  const src = normalizeWorkflowScript(raw);
  if (!src) return { ok: false, error: "workflow script is empty" };
  return { ok: true, src };
}

function checkBody(src: string, ast: AstNode): PreparedScript {
  const body = ast.body as AstNode[];
  if (body.length === 0) {
    return { ok: false, error: "workflow script is empty" };
  }
  const first = body[0] as AstNode;
  const shapeError = checkStatementShapes(first, body);
  if (shapeError) return { ok: false, error: shapeError };
  return { ok: true, src, ast, first };
}

function prepareScript(raw: string): PreparedScript {
  const source = normalizedSource(raw);
  if (!source.ok) return source;
  const parsed = parseAst(source.src);
  if (!parsed.ok) return parsed;
  return checkBody(source.src, parsed.ast);
}

function validateMeta(first: AstNode, ast: AstNode): { ok: true; meta: WorkflowMeta } | { ok: false; error: string } {
  const meta = tryExtractMeta(first);
  if (!meta.ok) return meta;
  const banned = checkBannedReferences(ast);
  if (banned) return { ok: false, error: banned };
  return { ok: true, meta: meta.meta };
}

export function parseWorkflowScript(raw: string): ParseWorkflowResult {
  const prepared = prepareScript(raw);
  if (!prepared.ok) return prepared;
  const { src, ast, first } = prepared;
  const meta = validateMeta(first, ast);
  if (!meta.ok) return meta;
  const declaration = first.declaration as AstNode;
  const executable = src.slice(0, first.start) + src.slice(declaration.start, declaration.end) + src.slice(first.end);
  return { ok: true, script: { meta: meta.meta, body: executable } };
}
