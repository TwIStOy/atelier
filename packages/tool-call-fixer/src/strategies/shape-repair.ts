import { getToolSchema, type ValidationIssue, validateToolInput } from "../schemas.ts";
import type { Strategy } from "../strategy.ts";
import { REPAIR_RULES, type RepairContext } from "./shape-repair-rules.ts";

export const shapeRepair: Strategy = {
  id: "shape-repair",
  description:
    "Validate-then-repair: drops null/empty-placeholder fields, parses JSON-stringified arrays, and wraps bare strings as arrays at the exact paths that fail schema validation.",
  apply: (toolName, input) => {
    const schema = getToolSchema(toolName);
    if (!schema) {
      return { applied: false };
    }
    const issues: ValidationIssue[] = validateToolInput(schema, input);
    if (issues.length === 0) {
      return { applied: false };
    }
    const notes: string[] = [];
    for (const issue of issues) {
      const key = issue.path[0];
      if (typeof key !== "string") continue;
      if (!(key in input)) continue;
      const ctx: RepairContext = { toolName, parent: input, key, value: input[key], issue };
      for (const rule of REPAIR_RULES) {
        const result = rule(ctx);
        if (result !== null) {
          notes.push(result.note);
          break;
        }
      }
    }
    if (notes.length === 0) {
      return { applied: false };
    }
    return { applied: true, note: notes.join("; ") };
  },
};
