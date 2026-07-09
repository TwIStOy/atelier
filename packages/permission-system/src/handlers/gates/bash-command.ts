import type { BashCommand, PermissionCheckResult, ScopedPermissionResolver } from "../../types.ts";
import { pickMostRestrictive } from "./candidate-check.ts";

export function resolveBashCommandCheck(
  command: string,
  commands: BashCommand[],
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  if (commands.length === 0) {
    if (isTriviallyEmptyCommand(command)) {
      return resolver.resolve({
        kind: "tool",
        surface: "bash",
        input: { command },
        agentName,
      });
    }
    return {
      state: "ask",
      toolName: "bash",
      source: "bash",
      origin: "builtin",
      command,
      matchedPattern: "<unparseable-bash-command>",
    };
  }

  const results = commands.map((cmd) => {
    const base = resolver.resolve({
      kind: "tool",
      surface: "bash",
      input: { command: cmd.text },
      agentName,
    });
    const result =
      cmd.opaque && base.state === "allow"
        ? {
            ...base,
            state: "ask" as const,
            matchedPattern: "<opaque-bash-wrapper>",
          }
        : base;
    return cmd.context ? { ...result, commandContext: cmd.context } : result;
  });
  return (
    pickMostRestrictive(results) ??
    resolver.resolve({
      kind: "tool",
      surface: "bash",
      input: { command },
      agentName,
    })
  );
}

function isTriviallyEmptyCommand(command: string): boolean {
  const lines = command
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.every((line) => line.startsWith("#"));
}
