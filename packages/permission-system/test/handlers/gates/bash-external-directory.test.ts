// Ported + trimmed from @gotgenes/pi-permission-system test/handlers/gates/bash-external-directory.test.ts.
// Gates return { state, action, trigger, reason? } | null.

import { describe, expect, it } from "vitest";

import { BashProgram } from "../../../src/access-intent/bash/program.ts";
import { describeBashExternalDirectoryGate } from "../../../src/handlers/gates/bash-external-directory.ts";
import { PathNormalizer } from "../../../src/path-normalizer.ts";
import type {
  GateResult,
  PermissionCheckResult,
  ScopedPermissionResolver,
  ToolCallContext,
} from "../../../src/types.ts";

import { makeResolver } from "../../helpers/gate-fixtures.ts";

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "bash",
    agentName: null,
    input: { command: "cat /outside/project/file.ts" },
    cwd: "/test/project",
    ...overrides,
  };
}

function makeCheckResult(
  state: "allow" | "deny" | "ask",
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    state,
    toolName: "external_directory",
    source: "special",
    origin: "builtin",
    ...overrides,
  };
}

function intentValues(intent: unknown): readonly string[] {
  if (
    typeof intent === "object" &&
    intent !== null &&
    "kind" in intent &&
    (intent as { kind: string }).kind === "access-path"
  ) {
    const path = (intent as { path?: { matchValues?: () => string[] } }).path;
    return path?.matchValues?.() ?? [];
  }
  return [];
}

async function gate(
  tcc: ToolCallContext,
  resolver: ScopedPermissionResolver,
  platform: NodeJS.Platform = process.platform,
): Promise<GateResult | null> {
  const command = (tcc.input as { command?: string }).command;
  const bashProgram =
    tcc.toolName === "bash" && command ? await BashProgram.parse(command, new PathNormalizer(platform, tcc.cwd)) : null;
  return describeBashExternalDirectoryGate(tcc, bashProgram, resolver);
}

describe("describeBashExternalDirectoryGate", () => {
  it("returns null when tool is not bash", async () => {
    expect(await gate(makeTcc({ toolName: "read" }), makeResolver(makeCheckResult("ask")))).toBeNull();
  });

  it("returns null when command has no external paths", async () => {
    expect(await gate(makeTcc({ input: { command: "ls -la" } }), makeResolver(makeCheckResult("ask")))).toBeNull();
  });

  it("resolves each external path on the external_directory surface via an access-path intent", async () => {
    const resolver = makeResolver(makeCheckResult("ask"));
    await gate(makeTcc({ input: { command: "cat /outside/a.ts" } }), resolver);
    const intent = resolver.resolve.mock.calls[0]?.[0];
    expect(intent).toMatchObject({
      kind: "access-path",
      surface: "external_directory",
      agentName: undefined,
    });
    expect(intentValues(intent)).toEqual(["/outside/a.ts"]);
  });

  it("returns allow (null) when all external paths are session-covered", async () => {
    expect(await gate(makeTcc(), makeResolver(makeCheckResult("allow", { source: "session" })))).toBeNull();
  });

  it("returns ask for uncovered paths", async () => {
    const result = await gate(
      makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }),
      makeResolver(makeCheckResult("ask")),
    );
    expect(result?.state).toBe("ask");
  });

  it("returns allow (null) when all external paths are config-level allowed", async () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).length > 0 ? makeCheckResult("allow", { source: "special" }) : makeCheckResult("ask"),
    );
    expect(await gate(makeTcc(), resolver)).toBeNull();
  });

  it("uses worst-check state from uncovered paths (config deny > catch-all ask)", async () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).length > 0 ? makeCheckResult("deny", { source: "special" }) : makeCheckResult("ask"),
    );
    const result = await gate(makeTcc(), resolver);
    expect(result?.state).toBe("deny");
    expect(result?.action).toBe("execute");
    expect(result?.trigger).toMatchObject({
      kind: "command",
      command: "cat /outside/project/file.ts",
      prefix: "cat",
    });
  });

  it("config-allowed path is excluded; remaining ask path yields ask", async () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).includes("/outside/a.ts")
        ? makeCheckResult("allow", { source: "special" })
        : makeCheckResult("ask"),
    );
    const result = await gate(makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }), resolver);
    expect(result?.state).toBe("ask");
  });

  it("config-denied path makes the result deny even when another path is ask", async () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).includes("/outside/a.ts")
        ? makeCheckResult("deny", { source: "special" })
        : makeCheckResult("ask"),
    );
    const result = await gate(makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }), resolver);
    expect(result?.state).toBe("deny");
  });

  it("only counts uncovered paths when some are session-covered", async () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).includes("/outside/a.ts")
        ? makeCheckResult("allow", { source: "session" })
        : makeCheckResult("ask"),
    );
    const result = await gate(makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }), resolver);
    expect(result?.state).toBe("ask");
  });
});

describe("describeBashExternalDirectoryGate — Git Bash semantics (win32)", () => {
  it("does not prompt for a /dev/null redirect target", async () => {
    const result = await gate(
      makeTcc({ cwd: "C:/projects/app", input: { command: "echo hi > /dev/null" } }),
      makeResolver(makeCheckResult("ask")),
      "win32",
    );
    expect(result).toBeNull();
  });

  it("prompts for a /tmp path on win32", async () => {
    const result = await gate(
      makeTcc({ cwd: "C:/projects/app", input: { command: "ls /tmp" } }),
      makeResolver(makeCheckResult("ask")),
      "win32",
    );
    expect(result?.state).toBe("ask");
  });
});
