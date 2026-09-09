export type FieldType = "string" | "number" | "boolean" | "array" | "object";

export interface SchemaField {
  type: FieldType;
  required?: boolean;
}

export type ToolSchema = Readonly<Record<string, SchemaField>>;

export const TOOL_SCHEMAS: Readonly<Record<string, ToolSchema>> = {
  read: {
    path: { type: "string", required: true },
    offset: { type: "number" },
    limit: { type: "number" },
  },
  edit: {
    path: { type: "string", required: true },
    edits: { type: "array", required: true },
  },
  write: {
    path: { type: "string", required: true },
    content: { type: "string", required: true },
  },
  bash: {
    command: { type: "string", required: true },
    description: { type: "string", required: true },
    timeout: { type: "number" },
  },
  grep: {
    pattern: { type: "string", required: true },
    path: { type: "string" },
    include: { type: "string" },
  },
  glob: {
    pattern: { type: "string", required: true },
    path: { type: "string" },
  },
  ls: {
    path: { type: "string" },
    limit: { type: "number" },
  },
};

export type ValidationIssueCode = "missing_field" | "invalid_type";

export interface ValidationIssue {
  code: ValidationIssueCode;
  expected?: FieldType;
  received?: string;
  path: (string | number)[];
  message: string;
}

export function getToolSchema(toolName: string): ToolSchema | undefined {
  return TOOL_SCHEMAS[toolName];
}

export function validateToolInput(schema: ToolSchema, input: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [field, def] of Object.entries(schema)) {
    const value = input[field];
    if (value === undefined || value === null) {
      if (def.required) {
        issues.push({ code: "missing_field", path: [field], message: `Required field "${field}" is missing` });
      } else if (value === null) {
        issues.push({
          code: "invalid_type",
          expected: def.type,
          received: "null",
          path: [field],
          message: `Optional field "${field}" is null`,
        });
      }
      continue;
    }
    const actual: string = Array.isArray(value) ? "array" : typeof value;
    if (actual !== def.type) {
      issues.push({
        code: "invalid_type",
        expected: def.type,
        received: actual,
        path: [field],
        message: `Field "${field}" expected ${def.type}, got ${actual}`,
      });
    }
  }
  return issues;
}
