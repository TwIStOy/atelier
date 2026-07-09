// Ported + trimmed from @gotgenes/pi-permission-system test/handlers/gates/bash-path.test.ts.
// Gates return { state, action, trigger, reason? } | null.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});

import { BashProgram } from "../../../src/access-intent/bash/program.ts";
import { describeBashPathGate } from "../../../src/handlers/gates/bash-path.ts";
import { PathNormalizer } from "../../../src/path-normalizer.ts";
import type { GateResult, ScopedPermissionResolver, ToolCallContext } from "../../../src/types.ts";

import {
  makeGateCheckResult as makeCheckResult,
  makePathDispatchResolver,
  makeResolver,
  makeTcc,
} from "../../helpers/gate-fixtures.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

async function gate(tcc: ToolCallContext, resolver: ScopedPermissionResolver): Promise<GateResult | null> {
  const command = (tcc.input as { command?: string }).command;
  const bashProgram =
    tcc.toolName === "bash" && command
      ? await BashProgram.parse(command, new PathNormalizer(process.platform, tcc.cwd))
      : null;
  return describeBashPathGate(tcc, bashProgram, resolver);
}

describe("describeBashPathGate", () => {
  it("returns null for non-bash tools", async () => {
    expect(await gate(makeTcc({ toolName: "read", input: { path: ".env" } }), makeResolver())).toBeNull();
  });

  it("returns null when no tokens are extracted", async () => {
    expect(await gate(makeTcc({ input: { command: "echo hello" } }), makeResolver())).toBeNull();
  });

  it("returns null when all tokens evaluate to allow", async () => {
    expect(await gate(makeTcc(), makeResolver(makeCheckResult({ state: "allow" })))).toBeNull();
  });

  it("returns deny when a token evaluates to deny", async () => {
    const result = await gate(makeTcc(), makeResolver(makeCheckResult({ state: "deny", matchedPattern: "*.env" })));
    expect(result?.state).toBe("deny");
    expect(result?.action).toBe("read");
    expect(result?.trigger).toMatchObject({ kind: "path", display: ".env" });
    expect(result?.reason).toContain("*.env");
  });

  it("returns ask when a token evaluates to ask", async () => {
    const result = await gate(makeTcc(), makeResolver(makeCheckResult({ state: "ask", matchedPattern: "*" })));
    expect(result?.state).toBe("ask");
    expect(result?.reason).toBeUndefined();
  });

  it("returns allow (null) when a session rule covers the path", async () => {
    expect(await gate(makeTcc(), makeResolver(makeCheckResult({ state: "allow", source: "session" })))).toBeNull();
  });

  it("returns null when command is missing", async () => {
    expect(await gate(makeTcc({ input: {} }), makeResolver())).toBeNull();
  });

  it("deny wins across multiple tokens", async () => {
    const resolver = makePathDispatchResolver(
      { "src/foo.ts": makeCheckResult({ state: "allow" }) },
      makeCheckResult({ state: "deny", matchedPattern: "*.env" }),
    );
    const result = await gate(makeTcc({ input: { command: "cat src/foo.ts .env" } }), resolver);
    expect(result?.state).toBe("deny");
  });

  it("deny wins in multi-token: cp .env README.md", async () => {
    const resolver = makePathDispatchResolver(
      { ".env": makeCheckResult({ state: "deny", matchedPattern: "*.env" }) },
      makeCheckResult({ state: "allow" }),
    );
    const result = await gate(makeTcc({ input: { command: "cp .env README.md" } }), resolver);
    expect(result?.state).toBe("deny");
  });

  it("extracts redirect target: echo test > .env triggers deny", async () => {
    const resolver = makePathDispatchResolver(
      { ".env": makeCheckResult({ state: "deny", matchedPattern: "*.env" }) },
      makeCheckResult({ state: "allow" }),
    );
    const result = await gate(makeTcc({ input: { command: "echo test > .env" } }), resolver);
    expect(result?.state).toBe("deny");
  });

  it("returns null when all tokens match only the universal default", async () => {
    expect(
      await gate(
        makeTcc(),
        makeResolver(
          makeCheckResult({
            state: "ask",
            matchedPattern: undefined,
            source: "special",
            origin: "builtin",
          }),
        ),
      ),
    ).toBeNull();
  });

  it("ignores universal-default tokens but fires for an explicit rule", async () => {
    const resolver = makePathDispatchResolver(
      { ".env": makeCheckResult({ state: "deny", matchedPattern: "*.env" }) },
      makeCheckResult({
        state: "ask",
        matchedPattern: undefined,
        source: "special",
        origin: "builtin",
      }),
    );
    const result = await gate(makeTcc({ input: { command: "cat src/foo.ts .env" } }), resolver);
    expect(result?.state).toBe("deny");
  });

  it("resolves cd-aware policy values", async () => {
    const resolver = makeResolver(makeCheckResult({ state: "deny", matchedPattern: "*" }));
    const result = await gate(
      makeTcc({
        input: { command: "cd nested && cat src/file.txt" },
        cwd: "/test/project",
      }),
      resolver,
    );
    expect(result?.state).toBe("deny");
  });

  it("does not resolve relative policy values through an unknown cd", async () => {
    const resolver = makeResolver(makeCheckResult({ state: "deny", matchedPattern: "*" }));
    const result = await gate(
      makeTcc({
        input: { command: 'cd "$DIR" && cat src/foo.ts' },
        cwd: "/test/project",
      }),
      resolver,
    );
    // literal-only — the deny:* rule matches the literal "src/foo.ts" form.
    expect(result?.state).toBe("deny");
  });
});

describe("describeBashPathGate — home-relative paths", () => {
  it("extracts ~/... token and denies on a matching rule", async () => {
    const resolver = makePathDispatchResolver(
      {
        "/mock/home/.ssh/config": makeCheckResult({
          state: "deny",
          matchedPattern: "~/.ssh/*",
        }),
      },
      makeCheckResult({ state: "allow" }),
    );
    const result = await gate(makeTcc({ input: { command: "cat ~/.ssh/config" } }), resolver);
    expect(result?.state).toBe("deny");
  });

  it("extracts $HOME/... token and denies on a matching rule", async () => {
    const resolver = makePathDispatchResolver(
      {
        "/mock/home/.ssh/config": makeCheckResult({
          state: "deny",
          matchedPattern: "$HOME/.ssh/*",
        }),
      },
      makeCheckResult({ state: "allow" }),
    );
    const result = await gate(makeTcc({ input: { command: "cat $HOME/.ssh/config" } }), resolver);
    expect(result?.state).toBe("deny");
  });
});

describe("describeBashPathGate — win32 backslash-relative paths", () => {
  async function gateOnPlatform(platform: NodeJS.Platform, tcc: ToolCallContext, resolver: ScopedPermissionResolver) {
    const command = (tcc.input as { command?: string }).command;
    const bashProgram =
      tcc.toolName === "bash" && command
        ? await BashProgram.parse(command, new PathNormalizer(platform, tcc.cwd))
        : null;
    return describeBashPathGate(tcc, bashProgram, resolver);
  }

  it("denies a backslash-relative token matching a path rule on win32", async () => {
    const resolver = makePathDispatchResolver(
      {
        "dir\\file": makeCheckResult({ state: "deny", matchedPattern: "dir/file" }),
      },
      makeCheckResult({ state: "allow" }),
    );
    const result = await gateOnPlatform(
      "win32",
      makeTcc({ input: { command: "cat dir\\file" }, cwd: "C:\\Projects\\App" }),
      resolver,
    );
    expect(result?.state).toBe("deny");
  });

  it("does not gate a backslash-relative token on posix (stays bare)", async () => {
    const resolver = makePathDispatchResolver(
      {
        "dir\\file": makeCheckResult({ state: "deny", matchedPattern: "dir/file" }),
      },
      makeCheckResult({ state: "allow" }),
    );
    const result = await gateOnPlatform(
      "linux",
      makeTcc({ input: { command: "cat dir\\file" }, cwd: "/projects/app" }),
      resolver,
    );
    expect(result).toBeNull();
  });
});
