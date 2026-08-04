import { describe, expect, it } from "vitest";
import { resolveEffectiveChildOptions } from "../../src/agents/child-agent.ts";

describe("resolveEffectiveChildOptions", () => {
  it("prefers the call input over persona frontmatter over defaults", () => {
    const opts = resolveEffectiveChildOptions(
      { model: "call-model", thinking: "low" },
      { model: "file-model", thinking: "medium" },
      { model: "defs-model", thinking: "high" },
    );
    expect(opts.model).toBe("call-model");
    expect(opts.thinking).toBe("low");
  });

  it("falls back to frontmatter then defaults then undefined", () => {
    expect(resolveEffectiveChildOptions({}, { model: "file-model" }, { model: "defs-model" }).model).toBe("file-model");
    expect(resolveEffectiveChildOptions({}, {}, { model: "defs-model" }).model).toBe("defs-model");
    expect(resolveEffectiveChildOptions({}, {}, {}).model).toBeUndefined();
  });

  it("defaults isolated to true and inherit_context to false, honoring frontmatter", () => {
    const base = resolveEffectiveChildOptions({}, {}, {});
    expect(base.isolated).toBe(true);
    expect(base.inherit_context).toBe(false);

    const fromFile = resolveEffectiveChildOptions({}, { isolated: false, inherit_context: true }, {});
    expect(fromFile.isolated).toBe(false);
    expect(fromFile.inherit_context).toBe(true);

    const explicit = resolveEffectiveChildOptions({ isolated: true }, { isolated: false }, {});
    expect(explicit.isolated).toBe(true);
  });

  it("resolves max_turns from input then frontmatter", () => {
    expect(resolveEffectiveChildOptions({}, { max_turns: 10 }, {}).max_turns).toBe(10);
    expect(resolveEffectiveChildOptions({ max_turns: 3 }, { max_turns: 10 }, {}).max_turns).toBe(3);
    expect(resolveEffectiveChildOptions({}, {}, {}).max_turns).toBeUndefined();
  });
});
