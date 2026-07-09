import { z } from "zod";

/**
 * Single source of truth for the permission-system config file shape.
 *
 * Runtime validation (config-loader.ts) consumes this; the generated JSON
 * Schema for editor autocomplete can be derived from it later.
 */

export const PERMISSIONS_SCHEMA_URL =
  "https://raw.githubusercontent.com/TwIStOy/pi-extensions/main/packages/permission-system/schemas/permissions.schema.json";

export const permissionStateSchema = z.union([z.literal("allow"), z.literal("deny"), z.literal("ask")]);

export const denyWithReasonSchema = z.strictObject({
  action: z.literal("deny"),
  reason: z.string().max(500).optional(),
});

/** A pattern value: a PermissionState string OR a DenyWithReason object. */
export const patternValueSchema = z.union([permissionStateSchema, denyWithReasonSchema]);

/** A map of wildcard patterns → permission values. Last matching pattern wins. */
export const permissionMapSchema = z.record(z.string().min(1), patternValueSchema);

/**
 * Flat permission policy. Each key is a surface name (`*` universal fallback,
 * tool names like `read`/`write`/`bash`, or cross-cutting `path` /
 * `external_directory`). A string value is shorthand for `{ "*": action }`;
 * an object value maps wildcard patterns → actions.
 */
export const permissionSchema = z.record(z.string().min(1), z.union([permissionStateSchema, permissionMapSchema]));

/** The on-disk config file. `permission` is the only policy field in v1. */
export const unifiedConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  permission: permissionSchema.optional(),
});

export type PermissionState = z.infer<typeof permissionStateSchema>;
export type DenyWithReason = z.infer<typeof denyWithReasonSchema>;
export type PatternValue = z.infer<typeof patternValueSchema>;
export type FlatPermissionConfig = z.infer<typeof permissionSchema>;
export type UnifiedPermissionConfig = z.infer<typeof unifiedConfigSchema>;

export function isPermissionState(value: unknown): value is PermissionState {
  return value === "allow" || value === "deny" || value === "ask";
}

export function isDenyWithReason(value: unknown): value is DenyWithReason {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as { action?: unknown; reason?: unknown };
  return v.action === "deny" && (v.reason === undefined || typeof v.reason === "string");
}
