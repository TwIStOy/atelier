export function validateObjective(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Objective must be a string.");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Objective must not be empty.");
  }
  if (trimmed.length > 4000) {
    throw new Error(`Objective must be ≤ 4000 characters (got ${trimmed.length}).`);
  }
  return trimmed;
}

export function validateTokenBudget(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!isValidTokenBudget(value)) {
    throw new Error("Token budget must be a positive integer.");
  }
  return Math.floor(value as number);
}

function isValidTokenBudget(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
