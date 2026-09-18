import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHILD_EXTENSION_FACTORIES_STATE_KEY,
  getChildExtensionFactories,
  registerChildExtensionFactory,
} from "../../src/agents/child-extensions.ts";
import { clearGlobalState } from "../../src/global-state.ts";

const factoryA: ExtensionFactory = () => {};
const factoryB: ExtensionFactory = () => {};
const factoryC: ExtensionFactory = () => {};

describe("child extension factory registry", () => {
  afterEach(() => {
    clearGlobalState(CHILD_EXTENSION_FACTORIES_STATE_KEY);
  });

  it("starts empty", () => {
    expect(getChildExtensionFactories()).toEqual([]);
  });

  it("returns registered factories in registration order", () => {
    registerChildExtensionFactory("a", factoryA);
    registerChildExtensionFactory("b", factoryB);
    expect(getChildExtensionFactories()).toEqual([factoryA, factoryB]);
  });

  it("replaces the factory when the same id registers again", () => {
    registerChildExtensionFactory("ext", factoryA);
    registerChildExtensionFactory("ext", factoryB);
    expect(getChildExtensionFactories()).toEqual([factoryB]);
  });

  it("keeps the registration position when an id re-registers", () => {
    registerChildExtensionFactory("a", factoryA);
    registerChildExtensionFactory("b", factoryB);
    registerChildExtensionFactory("a", factoryC);
    expect(getChildExtensionFactories()).toEqual([factoryC, factoryB]);
  });

  it("unregister removes the registered factory", () => {
    const unregister = registerChildExtensionFactory("ext", factoryA);
    unregister();
    expect(getChildExtensionFactories()).toEqual([]);
  });

  it("a stale unregister does not remove a factory re-registered under the same id", () => {
    const unregisterFirst = registerChildExtensionFactory("ext", factoryA);
    registerChildExtensionFactory("ext", factoryB);
    unregisterFirst();
    expect(getChildExtensionFactories()).toEqual([factoryB]);
  });
});
