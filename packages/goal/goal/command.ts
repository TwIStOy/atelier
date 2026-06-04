export type ParsedGoalCommand =
  | { kind: "show" }
  | { kind: "setObjective"; objective: string }
  | { kind: "setStatus"; status: "paused" | "active" }
  | { kind: "clear" };

export function parseGoalCommand(rawArgs: string): ParsedGoalCommand {
  const args = rawArgs.trim();
  if (!args) return { kind: "show" };

  const normalized = args.toLowerCase();
  if (normalized === "clear") return { kind: "clear" };
  if (normalized === "pause") {
    return { kind: "setStatus", status: "paused" };
  }
  if (normalized === "resume") {
    return { kind: "setStatus", status: "active" };
  }

  return { kind: "setObjective", objective: args };
}

export function goalCommandUsage(): string {
  return "Usage: /goal <objective> | /goal pause | /goal resume | /goal clear";
}
