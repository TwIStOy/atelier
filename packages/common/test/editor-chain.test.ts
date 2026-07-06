import { describe, expect, test } from "vitest";
import { chainEditorFactory, getEditorFactoryParent } from "../src/editor-chain.ts";

type Thing = { builtBy: string };
type Factory = (tag: string) => Thing;

describe("chainEditorFactory", () => {
  test("wrap receives the immediate parent factory and builds the inner editor through it", () => {
    const base: Factory = (tag) => ({ builtBy: `base:${tag}` });
    const seen: string[] = [];

    const wrapped = chainEditorFactory<Factory>(base, (parent) => (tag) => {
      const inner = parent ? parent(tag) : { builtBy: "fallback" };
      seen.push(inner.builtBy);
      return { builtBy: `wrap:${inner.builtBy}` };
    });

    const result = wrapped("x");
    expect(result.builtBy).toBe("wrap:base:x");
    expect(seen).toEqual(["base:x"]);
  });

  test("falls back when no current factory is registered", () => {
    const wrapped = chainEditorFactory<Factory>(undefined, (parent) => (tag) => {
      expect(parent).toBeUndefined();
      const inner = parent ? parent(tag) : { builtBy: "default" };
      return { builtBy: `wrap:${inner.builtBy}` };
    });
    expect(wrapped("y").builtBy).toBe("wrap:default");
  });

  test("multiple wrappers compose regardless of registration order", () => {
    const base: Factory = (tag) => ({ builtBy: `base:${tag}` });

    const innerWrap = chainEditorFactory<Factory>(base, (parent) => (tag) => ({
      builtBy: `inner:${parent!(tag).builtBy}`,
    }));
    const outerWrap = chainEditorFactory<Factory>(innerWrap, (parent) => (tag) => ({
      builtBy: `outer:${parent!(tag).builtBy}`,
    }));

    expect(outerWrap("z").builtBy).toBe("outer:inner:base:z");
  });

  test("records the immediate parent for introspection", () => {
    const base: Factory = () => ({ builtBy: "base" });
    const wrapped = chainEditorFactory<Factory>(base, (_parent) => () => ({ builtBy: "wrap" }));
    expect(getEditorFactoryParent(wrapped)).toBe(base);
    expect(getEditorFactoryParent(base)).toBeUndefined();
  });
});
