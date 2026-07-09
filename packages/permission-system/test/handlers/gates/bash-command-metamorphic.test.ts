import { describe, expect, it } from "vitest";
import { BashProgram } from "../../../src/access-intent/bash/program.ts";
import { resolveBashCommandCheck } from "../../../src/handlers/gates/bash-command.ts";
import { PathNormalizer } from "../../../src/path-normalizer.ts";
import type { PermissionState, ScopedPermissionResolver } from "../../../src/types.ts";

import { makeCheckResult } from "../../helpers/gate-fixtures.ts";

const STRENGTH: Record<PermissionState, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

function makeKeyedResolver(rules: { match: string; state: PermissionState }[]): ScopedPermissionResolver {
  return {
    resolve: (intent) => {
      const command = (intent as any).kind === "tool" ? ((intent as any).input?.command ?? "") : "";
      const rule = rules.find((r) => command.includes(r.match));
      const state: PermissionState = rule?.state ?? "allow";
      return makeCheckResult({ state, source: "bash", command });
    },
  };
}

async function decide(command: string, resolver: ScopedPermissionResolver): Promise<PermissionState> {
  const program = await BashProgram.parse(command, new PathNormalizer(process.platform, "/cwd"));
  return resolveBashCommandCheck(command, program.commands(), undefined, resolver).state;
}

describe("bash command gate — metamorphic totality", () => {
  const cases: { bare: string; state: PermissionState }[] = [
    { bare: "git push", state: "ask" },
    { bare: "git commit -m wip", state: "ask" },
    { bare: "rm -rf build", state: "deny" },
    { bare: "npm install pkg", state: "deny" },
    { bare: "gh pr create", state: "ask" },
  ];

  for (const { bare, state } of cases) {
    it(`wrapping "${bare}" in a cd prefix does not weaken its ${state} decision`, async () => {
      const resolver = makeKeyedResolver([{ match: bare.split(" ")[0] ?? bare, state }]);

      const bareDecision = await decide(bare, resolver);
      const wrappedDecision = await decide(`cd /repo && ${bare}`, resolver);

      expect(STRENGTH[wrappedDecision]).toBeGreaterThanOrEqual(STRENGTH[bareDecision]);
      expect(wrappedDecision).toBe(state);
    });
  }
});
