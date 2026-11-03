export type ParsedGoalCommand =
  | { kind: "show" }
  | { kind: "setObjective"; objective: string }
  | { kind: "setStatus"; status: "paused" | "active" }
  | { kind: "clear" };

export function parseGoalCommand(rawArgs: string): ParsedGoalCommand {
  const trimmed = rawArgs.trim();
  if (!trimmed) return { kind: "show" };
  const goalStatusCommand = matchGoalStatusKeyword(trimmed.toLowerCase());
  if (goalStatusCommand) return goalStatusCommand;
  return { kind: "setObjective", objective: trimmed };
}

function matchGoalStatusKeyword(lower: string): ParsedGoalCommand | undefined {
  if (lower === "pause") return { kind: "setStatus", status: "paused" };
  if (lower === "resume") return { kind: "setStatus", status: "active" };
  if (lower === "clear") return { kind: "clear" };
  return undefined;
}
