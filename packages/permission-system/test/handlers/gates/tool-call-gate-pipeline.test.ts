// Pipeline composition test: the 5 gates are evaluated and aggregated into a
// single most-restrictive decision (deny > ask > allow); ask routes to the UI
// once (headless fail-closed).

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => {
  const homedir = vi.fn(() => "/mock/home");
  return {
    homedir,
    default: { homedir },
  };
});

import { DEFAULT_PERMISSION_CONFIG } from "../../../src/config-loader.ts";
import { runGatePipeline } from "../../../src/handlers/gates/tool-call-gate-pipeline.ts";
import { PathNormalizer } from "../../../src/path-normalizer.ts";
import { PermissionResolver } from "../../../src/permission-resolver.ts";
import { normalizeFlatConfig } from "../../../src/rule.ts";
import type { FlatPermissionConfig, ScopedPermissionResolver, ToolCallContext } from "../../../src/types.ts";

import { makeResolver, makeTcc } from "../../helpers/gate-fixtures.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

const ALLOW_ALL: FlatPermissionConfig = { "*": "allow" };

function makeResolverFromConfig(permission: FlatPermissionConfig = ALLOW_ALL): ScopedPermissionResolver {
  return new PermissionResolver(normalizeFlatConfig(permission));
}

/** Resolver backed by the real dev-friendly default policy (read=allow,
 * write/bash=ask, path denies .env/~/.ssh, external_directory=ask). */
function makeDefaultResolver(): ScopedPermissionResolver {
  return new PermissionResolver(normalizeFlatConfig(DEFAULT_PERMISSION_CONFIG));
}

function makeUi() {
  const confirm = vi.fn<(...args: unknown[]) => Promise<boolean>>();
  const notify = vi.fn<(...args: unknown[]) => void>();
  return { confirm, notify };
}

async function run(
  tcc: ToolCallContext,
  resolver: ScopedPermissionResolver,
  ui: ReturnType<typeof makeUi>,
  hasUI = true,
) {
  return runGatePipeline(tcc, {
    resolver,
    normalizer: new PathNormalizer(process.platform, tcc.cwd),
    ui,
    hasUI,
  });
}

describe("runGatePipeline", () => {
  describe("allow / null results", () => {
    it("proceeds when every gate is allow (allow-all config)", async () => {
      const tcc = makeTcc({ input: { command: "ls -la" } });
      const result = await run(tcc, makeResolverFromConfig(), makeUi());
      expect(result).toBeUndefined();
    });

    it("proceeds for a read tool on an allowed path", async () => {
      const tcc = makeTcc({ toolName: "read", input: { path: "/test/project/src/index.ts" } });
      const result = await run(tcc, makeResolverFromConfig(), makeUi());
      expect(result).toBeUndefined();
    });

    it("proceeds for unknown / non-gated tools with no explicit deny", async () => {
      const tcc = makeTcc({ toolName: "todo_create", input: {} });
      const result = await run(tcc, makeResolverFromConfig(), makeUi());
      expect(result).toBeUndefined();
    });
  });

  describe("deny", () => {
    it("blocks a bash deny rule without calling ui.confirm", async () => {
      const tcc = makeTcc({ input: { command: "rm -rf /" } });
      const ui = makeUi();
      const result = await run(tcc, makeResolverFromConfig({ "*": "allow", bash: { "rm *": "deny" } }), ui);
      expect(result).toEqual({ block: true, reason: expect.stringContaining("rm") });
      expect(ui.confirm).not.toHaveBeenCalled();
    });

    it("blocks a path deny rule (tools) on .env", async () => {
      const tcc = makeTcc({ toolName: "read", input: { path: "/test/project/.env" } });
      const ui = makeUi();
      const result = await run(tcc, makeResolverFromConfig({ "*": "allow", path: { "*.env": "deny" } }), ui);
      expect(result?.block).toBe(true);
      expect(ui.confirm).not.toHaveBeenCalled();
    });

    it("blocks a bash path deny rule on a .env token", async () => {
      const tcc = makeTcc({ input: { command: "cat .env" } });
      const ui = makeUi();
      const result = await run(tcc, makeResolverFromConfig({ "*": "allow", path: { "*.env": "deny" } }), ui);
      expect(result?.block).toBe(true);
      expect(ui.confirm).not.toHaveBeenCalled();
    });
  });

  describe("ask", () => {
    it("asks via ui.confirm and proceeds when the user accepts", async () => {
      const tcc = makeTcc({ input: { command: "npm test" } });
      const ui = makeUi();
      ui.confirm.mockResolvedValue(true);
      const result = await run(tcc, makeResolverFromConfig({ "*": "allow", bash: { "npm *": "ask" } }), ui);
      expect(ui.confirm).toHaveBeenCalledTimes(1);
      expect(ui.confirm.mock.calls[0]?.[0]).toBe("Permission required");
      expect(result).toBeUndefined();
    });

    it("asks via ui.confirm and blocks when the user rejects", async () => {
      const tcc = makeTcc({ input: { command: "npm test" } });
      const ui = makeUi();
      ui.confirm.mockResolvedValue(false);
      const result = await run(tcc, makeResolverFromConfig({ "*": "allow", bash: { "npm *": "ask" } }), ui);
      expect(ui.confirm).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ block: true, reason: expect.any(String) });
    });
  });

  describe("headless fail-closed", () => {
    it("denies an ask result when hasUI is false (no silent allow)", async () => {
      const tcc = makeTcc({ input: { command: "npm test" } });
      const ui = makeUi();
      const result = await run(tcc, makeResolverFromConfig({ "*": "allow", bash: { "npm *": "ask" } }), ui, false);
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(result).toEqual({ block: true, reason: expect.any(String) });
    });
  });

  describe("ordering / short-circuit", () => {
    it("deny on an earlier gate short-circuits before a later ask gate (no confirm)", async () => {
      // bash-path deny (.env) should fire before the tool-level ask on bash.
      const tcc = makeTcc({ input: { command: "cat .env" } });
      const ui = makeUi();
      const result = await run(
        tcc,
        makeResolverFromConfig({ "*": "allow", path: { "*.env": "deny" }, bash: { "*": "ask" } }),
        ui,
      );
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(result?.block).toBe(true);
    });
  });

  describe("unparseable bash", () => {
    it("parses a trivial command and proceeds under allow", async () => {
      const tcc = makeTcc({ input: { command: "echo hi" } });
      const result = await run(tcc, makeResolverFromConfig(), makeUi());
      expect(result).toBeUndefined();
    });
  });

  describe("mocked resolver behavior", () => {
    it("blocks when the resolver mock returns deny for a tool intent", async () => {
      const tcc = makeTcc({ toolName: "read", input: { path: "/test/project/secret" } });
      const resolver = makeResolver({
        state: "deny",
        toolName: "path",
        source: "special",
        matchedPattern: "*/secret",
        reason: "secret is off-limits",
      });
      const result = await run(tcc, resolver, makeUi());
      expect(result?.block).toBe(true);
    });
  });

  // Regression: an external write used to prompt twice (external_directory ask
  // + tool ask). Aggregation must collapse both into a single confirmation.
  describe("single prompt per call (aggregation)", () => {
    it("prompts once for a write outside the working directory", async () => {
      const tcc = makeTcc({
        toolName: "write",
        input: { path: "/tmp/outside.txt" },
        cwd: "/test/project",
      });
      const ui = makeUi();
      ui.confirm.mockResolvedValue(true);
      const result = await run(tcc, makeDefaultResolver(), ui);
      expect(result).toBeUndefined();
      expect(ui.confirm).toHaveBeenCalledTimes(1);
    });

    it("the single prompt carries the path", async () => {
      const tcc = makeTcc({
        toolName: "write",
        input: { path: "/tmp/outside.txt" },
        cwd: "/test/project",
      });
      const ui = makeUi();
      ui.confirm.mockResolvedValue(true);
      await run(tcc, makeDefaultResolver(), ui);
      const message = ui.confirm.mock.calls[0]?.[1];
      expect(message).toContain("/tmp/outside.txt");
    });
  });

  // Regression: a bash `rm` prompt used to show only the subcommand prefix
  // ("execute: rm") with no target. The prompt must show the tool + full command.
  describe("bash command prompt shows the full command", () => {
    it("includes the full rm command, not just the prefix", async () => {
      const tcc = makeTcc({
        input: { command: "rm /tmp/pi-test-tmpfile.txt && echo removed" },
        cwd: "/test/project",
      });
      const ui = makeUi();
      ui.confirm.mockResolvedValue(true);
      await run(tcc, makeDefaultResolver(), ui);
      const message = ui.confirm.mock.calls[0]?.[1];
      expect(message).toBe("bash: rm /tmp/pi-test-tmpfile.txt && echo removed");
    });
  });

  // Regression: a non-path custom tool (e.g. memory-read) used to prompt as a
  // vague "read (no specific path or command)". The prompt must name the tool
  // so the user knows what they are approving.
  describe("prompt names the tool", () => {
    it("shows the tool name for a non-path custom tool", async () => {
      const tcc = makeTcc({
        toolName: "memory-read",
        input: { uri: "system://boot" },
        cwd: "/test/project",
      });
      const ui = makeUi();
      ui.confirm.mockResolvedValue(true);
      const result = await run(tcc, makeDefaultResolver(), ui);
      expect(result).toBeUndefined();
      const message = ui.confirm.mock.calls[0]?.[1];
      expect(message).toBe("memory-read");
    });
  });
});
