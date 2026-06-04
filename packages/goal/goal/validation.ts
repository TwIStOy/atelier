export function validateObjective(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("Goal objective cannot be empty.");
  }
  if (normalized.length > 4000) {
    throw new Error("Goal objective must be at most 4000 characters.");
  }
  return normalized;
}

export function validateTokenBudget(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("Goal token budget must be a positive integer.");
  }
  const normalized = Math.floor(value);
  if (normalized <= 0 || normalized !== value) {
    throw new Error("Goal token budget must be a positive integer.");
  }
  return normalized;
}
