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

  it("applies configured persona models between call arguments and file defaults", () => {
    const file = { model: "cheap", thinking: "medium" };
    const defaults = { model: "default-model" };
    expect(resolveEffectiveChildOptions({}, file, defaults, "middle").model).toBe("middle");
    expect(resolveEffectiveChildOptions({ model: "call-model" }, file, defaults, "middle").model).toBe("call-model");
    expect(resolveEffectiveChildOptions({}, file, defaults, "").model).toBe("");
    expect(resolveEffectiveChildOptions({ model: "" }, file, defaults, "middle").model).toBe("");
    expect(resolveEffectiveChildOptions({}, file, defaults, "middle").thinking).toBe("medium");
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
